import { prisma } from '../database/prisma.js';
import { AppError } from '../utils/app-error.js';
import { dayRange } from '../utils/dates.js';
import { emitBusiness } from '../sockets/index.js';

export const queueInclude = { customer: true, service: true };
const activeStatuses = ['WAITING', 'ARRIVED', 'IN_SERVICE'];

export async function assertQueueLinks(db, businessId, { customerId, serviceId }) {
  const [customer, service] = await Promise.all([
    db.customer.findFirst({ where: { id: customerId, businessId } }),
    db.service.findFirst({ where: { id: serviceId, businessId, isActive: true } }),
  ]);
  if (!customer) throw new AppError('Customer not found', 404);
  if (!service) throw new AppError('Active service not found', 404);
}

export async function todayQueue(businessId, db = prisma) {
  const { start, end } = dayRange();
  return db.queueEntry.findMany({ where: { businessId, createdAt: { gte: start, lt: end } }, include: queueInclude, orderBy: { createdAt: 'asc' } });
}

export async function recalculateQueue(businessId, db = prisma) {
  const entries = await todayQueue(businessId, db);
  const ordered = entries.filter((entry) => activeStatuses.includes(entry.status));
  let wait = ordered.some((entry) => entry.status === 'IN_SERVICE') ? ordered.find((entry) => entry.status === 'IN_SERVICE').service.durationMinutes : 0;
  let position = 1;
  for (const entry of ordered) {
    if (entry.status === 'IN_SERVICE') {
      await db.queueEntry.update({ where: { id: entry.id }, data: { queueNumber: position++, estimatedWaitMinutes: 0, estimatedStartTime: entry.actualStartTime || new Date() } });
      continue;
    }
    await db.queueEntry.update({ where: { id: entry.id }, data: { queueNumber: position++, estimatedWaitMinutes: wait, estimatedStartTime: new Date(Date.now() + wait * 60000) } });
    wait += entry.service.durationMinutes;
  }
  return todayQueue(businessId, db);
}

export async function queueSummary(businessId, db = prisma) {
  const queue = await todayQueue(businessId, db);
  const completed = queue.filter((item) => item.status === 'COMPLETED');
  const waits = completed.filter((item) => item.actualStartTime).map((item) => Math.max(0, (new Date(item.actualStartTime) - new Date(item.createdAt)) / 60000));
  const waiting = queue.filter((item) => ['WAITING', 'ARRIVED'].includes(item.status));
  return {
    currentlyServingCustomer: queue.find((item) => item.status === 'IN_SERVICE') || null,
    nextCustomer: waiting[0] || null,
    waitingCount: waiting.length,
    completedCount: completed.length,
    cancelledCount: queue.filter((item) => item.status === 'CANCELLED').length,
    noShowCount: queue.filter((item) => item.status === 'NO_SHOW').length,
    averageWaitingTime: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0,
    estimatedTotalQueueTime: waiting.reduce((sum, item) => sum + item.service.durationMinutes, 0),
  };
}

export async function broadcastQueue(io, businessId, event = 'queue_updated', extra = {}) {
  if (!io) return;
  const [queue, summary] = await Promise.all([todayQueue(businessId), queueSummary(businessId)]);
  emitBusiness(io, businessId, event, { ...extra, queue, summary });
  if (event !== 'queue_updated') emitBusiness(io, businessId, 'queue_updated', { queue, summary });
  emitBusiness(io, businessId, 'queue_summary_updated', { summary });
}

export async function createQueueEntry(businessId, data, io) {
  const queueEntry = await prisma.$transaction(async (tx) => {
    await assertQueueLinks(tx, businessId, data);
    const { start, end } = dayRange();
    const last = await tx.queueEntry.aggregate({ where: { businessId, createdAt: { gte: start, lt: end } }, _max: { queueNumber: true } });
    const entry = await tx.queueEntry.create({ data: { ...data, businessId, queueNumber: (last._max.queueNumber || 0) + 1 }, include: queueInclude });
    await tx.queueStatusHistory.create({ data: { businessId, queueEntryId: entry.id, toStatus: entry.status } });
    await recalculateQueue(businessId, tx);
    return tx.queueEntry.findUnique({ where: { id: entry.id }, include: queueInclude });
  });
  await broadcastQueue(io, businessId, 'customer_added_to_queue', { queueEntry });
  return queueEntry;
}

export async function setQueueStatus(businessId, id, status, io, notes) {
  const entry = await prisma.queueEntry.findFirst({ where: { id, businessId }, include: queueInclude });
  if (!entry) throw new AppError('Queue entry not found', 404);
  const now = new Date();
  const data = { status };
  if (status === 'IN_SERVICE') Object.assign(data, { actualStartTime: now });
  if (status === 'COMPLETED') Object.assign(data, { completedAt: now });
  if (status === 'CANCELLED') Object.assign(data, { cancelledAt: now });
  if (status === 'NO_SHOW') Object.assign(data, { noShowAt: now });

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.queueEntry.update({ where: { id }, data, include: queueInclude });
    await tx.queueStatusHistory.create({ data: { businessId, queueEntryId: id, fromStatus: entry.status, toStatus: status, notes } });
    if (status === 'COMPLETED') {
      const customer = await tx.customer.findUnique({ where: { id: entry.customerId }, select: { serviceIntervalDays: true } });
      await tx.customer.update({
        where: { id: entry.customerId },
        data: {
          totalVisits: { increment: 1 },
          lastVisitAt: now,
          lastServiceReminderSentAt: null,
          nextServiceReminderAt: customer?.serviceIntervalDays
            ? new Date(now.getTime() + customer.serviceIntervalDays * 86_400_000)
            : null,
        },
      });
      if (entry.appointmentId) await tx.appointment.update({ where: { id: entry.appointmentId }, data: { status: 'COMPLETED' } });
    }
    if (status === 'NO_SHOW') await tx.customer.update({ where: { id: entry.customerId }, data: { noShowCount: { increment: 1 } } });
    await recalculateQueue(businessId, tx);
    return result;
  });
  await broadcastQueue(io, businessId, 'queue_status_changed', { queueEntry: updated, fromStatus: entry.status, toStatus: status });
  return updated;
}

export async function moveQueueEntry(businessId, id, direction, io) {
  const queue = (await todayQueue(businessId)).filter((entry) => ['WAITING', 'ARRIVED'].includes(entry.status));
  const index = queue.findIndex((entry) => entry.id === id);
  if (index < 0) throw new AppError('Waiting queue entry not found', 404);
  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= queue.length) return queue[index];
  const current = queue[index];
  const swap = queue[swapIndex];
  await prisma.$transaction(async (tx) => {
    await tx.queueEntry.update({ where: { id: current.id }, data: { queueNumber: swap.queueNumber } });
    await tx.queueEntry.update({ where: { id: swap.id }, data: { queueNumber: current.queueNumber } });
    await recalculateQueue(businessId, tx);
  });
  const updated = await prisma.queueEntry.findUnique({ where: { id }, include: queueInclude });
  await broadcastQueue(io, businessId, 'queue_updated', { queueEntry: updated });
  return updated;
}

export async function deleteQueueEntry(businessId, id, io) {
  const entry = await prisma.queueEntry.findFirst({ where: { id, businessId } });
  if (!entry) throw new AppError('Queue entry not found', 404);
  await prisma.$transaction(async (tx) => {
    await tx.queueEntry.delete({ where: { id } });
    await recalculateQueue(businessId, tx);
  });
  await broadcastQueue(io, businessId, 'queue_updated', { deletedQueueEntryId: id });
}
