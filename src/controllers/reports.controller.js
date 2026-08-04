import { prisma } from '../database/prisma.js';
import { dayRange } from '../utils/dates.js';
import { ok } from '../utils/response.js';
import { queueSummary, todayQueue } from '../services/queue.service.js';

async function reportData(businessId, query = {}) {
  const { start, end } = query.from ? { start: new Date(query.from), end: query.to ? new Date(query.to) : new Date() } : dayRange();
  const [queue, payments] = await Promise.all([
    prisma.queueEntry.findMany({ where: { businessId, createdAt: { gte: start, lt: end } }, include: { service: true, staff: true } }),
    prisma.payment.findMany({ where: { businessId, paymentStatus: 'PAID', paidAt: { gte: start, lt: end } } }),
  ]);
  const completed = queue.filter((entry) => entry.status === 'COMPLETED');
  const popularMap = completed.reduce((map, entry) => { map[entry.service.name] = (map[entry.service.name] || 0) + 1; return map; }, {});
  const staffMap = completed.reduce((map, entry) => { const name = entry.staff?.fullName || 'Unassigned'; map[name] = (map[name] || 0) + 1; return map; }, {});
  const methodMap = payments.reduce((map, entry) => { map[entry.paymentMethod] = (map[entry.paymentMethod] || 0) + Number(entry.amount); return map; }, {});
  const waits = completed.filter((entry) => entry.actualStartTime).map((entry) => (new Date(entry.actualStartTime) - new Date(entry.createdAt)) / 60000);
  return {
    revenue: payments.reduce((sum, payment) => sum + Number(payment.amount), 0),
    customersServed: completed.length,
    waitingCount: queue.filter((entry) => ['WAITING', 'ARRIVED'].includes(entry.status)).length,
    completedCount: completed.length,
    noShowCount: queue.filter((entry) => entry.status === 'NO_SHOW').length,
    cancelledCount: queue.filter((entry) => entry.status === 'CANCELLED').length,
    averageWaitingTime: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0,
    popularServices: Object.entries(popularMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    staffPerformance: Object.entries(staffMap).map(([name, completedCount]) => ({ name, completedCount })).sort((a, b) => b.completedCount - a.completedCount),
    paymentMethodBreakdown: Object.entries(methodMap).map(([method, amount]) => ({ method, amount })),
  };
}

export async function dashboard(req, res) {
  const [report, summary, queue] = await Promise.all([reportData(req.businessId), queueSummary(req.businessId), todayQueue(req.businessId)]);
  return ok(res, { dashboard: { ...report, queueSummary: summary, queue } });
}
export async function revenue(req, res) { const data = await reportData(req.businessId, req.query); return ok(res, { revenue: data.revenue, paymentMethodBreakdown: data.paymentMethodBreakdown }); }
export async function queue(req, res) { const data = await reportData(req.businessId, req.query); return ok(res, { queue: { waitingCount: data.waitingCount, completedCount: data.completedCount, noShowCount: data.noShowCount, cancelledCount: data.cancelledCount, averageWaitingTime: data.averageWaitingTime } }); }
export async function customers(req, res) { const data = await reportData(req.businessId, req.query); return ok(res, { customers: { customersServed: data.customersServed, popularServices: data.popularServices } }); }
export async function staff(req, res) { const data = await reportData(req.businessId, req.query); return ok(res, { staff: data.staffPerformance }); }
