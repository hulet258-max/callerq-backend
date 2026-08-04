import { prisma } from '../database/prisma.js';
import { AppError } from '../utils/app-error.js';
import { dayRange } from '../utils/dates.js';
import { ok } from '../utils/response.js';
import { emitBusiness } from '../sockets/index.js';

const include = { customer: true, service: true, staff: true, queueEntry: true, appointment: true };

async function validateLinks(businessId, data) {
  const checks = [
    ['customer', data.customerId], ['service', data.serviceId], ['staff', data.staffId],
    ['queueEntry', data.queueEntryId], ['appointment', data.appointmentId],
  ].filter(([, id]) => id);
  for (const [model, id] of checks) {
    if (!await prisma[model].findFirst({ where: { id, businessId } })) throw new AppError(`${model} not found`, 404);
  }
}

export async function list(req, res) {
  return ok(res, { payments: await prisma.payment.findMany({ where: { businessId: req.businessId }, include, orderBy: { createdAt: 'desc' } }) });
}

export async function create(req, res) {
  await validateLinks(req.businessId, req.body);
  const paid = req.body.paymentStatus === 'PAID';
  const payment = await prisma.$transaction(async (tx) => {
    const record = await tx.payment.create({ data: { ...req.body, businessId: req.businessId, paidAt: paid ? new Date() : null }, include });
    if (paid) await tx.customer.update({ where: { id: req.body.customerId }, data: { totalSpending: { increment: req.body.amount } } });
    return record;
  });
  const io = req.app.get('io');
  if (io) emitBusiness(io, req.businessId, 'payment_recorded', { payment });
  return ok(res, { payment }, 'Payment recorded', 201);
}

export async function get(req, res) {
  const payment = await prisma.payment.findFirst({ where: { id: req.params.id, businessId: req.businessId }, include });
  if (!payment) throw new AppError('Payment not found', 404);
  return ok(res, { payment });
}

export async function update(req, res) {
  const found = await prisma.payment.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!found) throw new AppError('Payment not found', 404);
  const merged = { ...found, ...req.body };
  await validateLinks(req.businessId, merged);
  const becomingPaid = found.paymentStatus !== 'PAID' && req.body.paymentStatus === 'PAID';
  const leavingPaid = found.paymentStatus === 'PAID' && req.body.paymentStatus && req.body.paymentStatus !== 'PAID';
  const payment = await prisma.$transaction(async (tx) => {
    const record = await tx.payment.update({ where: { id: found.id }, data: { ...req.body, ...(becomingPaid ? { paidAt: new Date() } : {}) }, include });
    if (becomingPaid) await tx.customer.update({ where: { id: record.customerId }, data: { totalSpending: { increment: Number(record.amount) } } });
    if (leavingPaid) await tx.customer.update({ where: { id: found.customerId }, data: { totalSpending: { decrement: Number(found.amount) } } });
    return record;
  });
  return ok(res, { payment }, 'Payment updated');
}

export async function remove(req, res) {
  const found = await prisma.payment.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!found) throw new AppError('Payment not found', 404);
  await prisma.$transaction(async (tx) => {
    await tx.payment.delete({ where: { id: found.id } });
    if (found.paymentStatus === 'PAID') await tx.customer.update({ where: { id: found.customerId }, data: { totalSpending: { decrement: Number(found.amount) } } });
  });
  return ok(res, {}, 'Payment deleted');
}

export async function todaySummary(req, res) {
  const { start, end } = dayRange();
  const payments = await prisma.payment.findMany({ where: { businessId: req.businessId, paymentStatus: 'PAID', paidAt: { gte: start, lt: end } } });
  const byMethod = payments.reduce((result, payment) => { result[payment.paymentMethod] = (result[payment.paymentMethod] || 0) + Number(payment.amount); return result; }, {});
  return ok(res, { summary: { total: payments.reduce((sum, payment) => sum + Number(payment.amount), 0), count: payments.length, byMethod } });
}
