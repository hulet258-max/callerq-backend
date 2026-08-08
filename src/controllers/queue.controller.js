import { prisma } from '../database/prisma.js';
import { AppError } from '../utils/app-error.js';
import { ok } from '../utils/response.js';
import { broadcastQueue, createQueueEntry, deleteQueueEntry, moveQueueEntry, queueInclude, queueSummary, setQueueStatus, todayQueue } from '../services/queue.service.js';
import { notifyQueueEntry } from '../services/notification.service.js';

const io = (req) => req.app.get('io');

export async function listToday(req, res) { return ok(res, { queue: await todayQueue(req.businessId) }); }
export async function summary(req, res) { return ok(res, { summary: await queueSummary(req.businessId) }); }
export async function create(req, res) { return ok(res, { queueEntry: await createQueueEntry(req.businessId, req.body, io(req)) }, 'Added to queue', 201); }

export async function get(req, res) {
  const queueEntry = await prisma.queueEntry.findFirst({ where: { id: req.params.id, businessId: req.businessId }, include: { ...queueInclude, history: { orderBy: { createdAt: 'desc' } }, notifications: { orderBy: { createdAt: 'desc' } }, payments: true } });
  if (!queueEntry) throw new AppError('Queue entry not found', 404);
  return ok(res, { queueEntry });
}

export async function changeStatus(req, res) { return ok(res, { queueEntry: await setQueueStatus(req.businessId, req.params.id, req.body.status, io(req), req.body.notes) }, 'Queue status updated'); }
export async function start(req, res) { return ok(res, { queueEntry: await setQueueStatus(req.businessId, req.params.id, 'IN_SERVICE', io(req)) }, 'Service started'); }
export async function complete(req, res) { return ok(res, { queueEntry: await setQueueStatus(req.businessId, req.params.id, 'COMPLETED', io(req)) }, 'Service completed'); }
export async function cancel(req, res) { return ok(res, { queueEntry: await setQueueStatus(req.businessId, req.params.id, 'CANCELLED', io(req), req.body.notes) }, 'Queue entry cancelled'); }
export async function noShow(req, res) { return ok(res, { queueEntry: await setQueueStatus(req.businessId, req.params.id, 'NO_SHOW', io(req)) }, 'Customer marked no-show'); }
export async function moveUp(req, res) { return ok(res, { queueEntry: await moveQueueEntry(req.businessId, req.params.id, 'up', io(req)) }, 'Queue reordered'); }
export async function moveDown(req, res) { return ok(res, { queueEntry: await moveQueueEntry(req.businessId, req.params.id, 'down', io(req)) }, 'Queue reordered'); }
export async function remove(req, res) {
  await deleteQueueEntry(req.businessId, req.params.id, io(req));
  return ok(res, {}, 'Queue entry deleted');
}

export async function notifyNext(req, res) {
  const next = (await todayQueue(req.businessId)).find((entry) => ['WAITING', 'ARRIVED'].includes(entry.status));
  if (!next) throw new AppError('No waiting customer found', 404);
  const notification = await notifyQueueEntry(req.businessId, next.id, io(req));
  return ok(res, { notification }, 'Message preview generated', 201);
}
