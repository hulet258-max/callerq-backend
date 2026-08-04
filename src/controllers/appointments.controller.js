import { prisma } from '../database/prisma.js';
import { AppError } from '../utils/app-error.js';
import { dateOnly, dayRange } from '../utils/dates.js';
import { ok } from '../utils/response.js';
import { emitBusiness } from '../sockets/index.js';
import { assertQueueLinks, createQueueEntry } from '../services/queue.service.js';

const include = { customer: true, service: true, staff: true };
const io = (req) => req.app.get('io');
const mapDate = (data) => data.appointmentDate ? { ...data, appointmentDate: dateOnly(data.appointmentDate) } : data;

export async function list(req, res) {
  const where = { businessId: req.businessId };
  if (req.query.date) {
    const { start, end } = dayRange(req.query.date);
    where.appointmentDate = { gte: start, lt: end };
  }
  const appointments = await prisma.appointment.findMany({ where, include, orderBy: [{ appointmentDate: 'asc' }, { startTime: 'asc' }] });
  return ok(res, { appointments });
}

export async function create(req, res) {
  await assertQueueLinks(prisma, req.businessId, req.body);
  const appointment = await prisma.appointment.create({ data: { ...mapDate(req.body), businessId: req.businessId }, include });
  if (io(req)) emitBusiness(io(req), req.businessId, 'appointment_created', { appointment });
  return ok(res, { appointment }, 'Appointment created', 201);
}

export async function get(req, res) {
  const appointment = await prisma.appointment.findFirst({ where: { id: req.params.id, businessId: req.businessId }, include: { ...include, notifications: true, payments: true } });
  if (!appointment) throw new AppError('Appointment not found', 404);
  return ok(res, { appointment });
}

export async function update(req, res) {
  const found = await prisma.appointment.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!found) throw new AppError('Appointment not found', 404);
  const links = { customerId: req.body.customerId || found.customerId, serviceId: req.body.serviceId || found.serviceId, staffId: req.body.staffId === undefined ? found.staffId : req.body.staffId };
  await assertQueueLinks(prisma, req.businessId, links);
  const appointment = await prisma.appointment.update({ where: { id: found.id }, data: mapDate(req.body), include });
  return ok(res, { appointment }, 'Appointment updated');
}

export async function cancel(req, res) {
  const found = await prisma.appointment.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!found) throw new AppError('Appointment not found', 404);
  const appointment = await prisma.appointment.update({ where: { id: found.id }, data: { status: 'CANCELLED' }, include });
  return ok(res, { appointment }, 'Appointment cancelled');
}

export async function reschedule(req, res) {
  const found = await prisma.appointment.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!found) throw new AppError('Appointment not found', 404);
  const appointment = await prisma.appointment.update({ where: { id: found.id }, data: { ...mapDate(req.body), status: 'RESCHEDULED' }, include });
  return ok(res, { appointment }, 'Appointment rescheduled');
}

export async function addToQueue(req, res) {
  const appointment = await prisma.appointment.findFirst({ where: { id: req.params.id, businessId: req.businessId }, include });
  if (!appointment) throw new AppError('Appointment not found', 404);
  if (appointment.status === 'ADDED_TO_QUEUE') throw new AppError('Appointment is already in the queue', 409);
  const queueEntry = await createQueueEntry(req.businessId, { customerId: appointment.customerId, serviceId: appointment.serviceId, staffId: appointment.staffId, source: 'APPOINTMENT', notes: `Appointment ${appointment.id}` }, io(req));
  await prisma.appointment.update({ where: { id: appointment.id }, data: { status: 'ADDED_TO_QUEUE' } });
  return ok(res, { queueEntry }, 'Appointment added to queue', 201);
}
