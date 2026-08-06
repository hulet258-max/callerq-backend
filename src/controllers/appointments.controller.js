import { prisma } from '../database/prisma.js';
import { AppError } from '../utils/app-error.js';
import { dateOnly, dayRange } from '../utils/dates.js';
import { ok } from '../utils/response.js';
import { emitBusiness } from '../sockets/index.js';
import { assertQueueLinks, createQueueEntry } from '../services/queue.service.js';
import { appointmentInclude, createScheduledAppointment } from '../services/appointment.service.js';
import { pushAppointmentResponse } from '../services/push.service.js';

const include = appointmentInclude;
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
  const appointment = await prisma.$transaction((tx) => createScheduledAppointment(tx, req.businessId, req.body));
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
  const queueEntry = await createQueueEntry(req.businessId, { customerId: appointment.customerId, serviceId: appointment.serviceId, staffId: appointment.staffId, appointmentId: appointment.id, source: 'APPOINTMENT', notes: `Appointment ${appointment.id}` }, io(req));
  await prisma.appointment.update({ where: { id: appointment.id }, data: { status: 'ADDED_TO_QUEUE' } });
  return ok(res, { queueEntry }, 'Appointment added to queue', 201);
}

function addisDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Addis_Ababa', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function assertStillAvailable(appointment) {
  if (!appointment.staffId) return;
  const staff = await prisma.staff.findFirst({
    where: { id: appointment.staffId, businessId: appointment.businessId },
    select: { status: true },
  });
  if (!staff || staff.status === 'OFF_DUTY') throw new AppError('Selected barber is unavailable', 409);
  const conflict = await prisma.appointment.findFirst({
    where: {
      id: { not: appointment.id },
      staffId: appointment.staffId,
      appointmentDate: appointment.appointmentDate,
      status: { in: ['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'ADDED_TO_QUEUE', 'RESCHEDULED'] },
      startTime: { lt: appointment.endTime },
      endTime: { gt: appointment.startTime },
    },
    select: { id: true },
  });
  if (conflict) throw new AppError('Selected barber is no longer available at that time', 409);
}

export async function respond(req, res) {
  const appointment = await prisma.appointment.findFirst({
    where: { id: req.params.id, businessId: req.businessId },
    include,
  });
  if (!appointment) throw new AppError('Appointment not found', 404);
  if (appointment.status !== 'REQUESTED') throw new AppError('Appointment request has already been handled', 409);

  const responseData = {
    respondedAt: new Date(),
    respondedById: req.user.id,
    responseReason: null,
    responseNote: req.body.note || null,
  };
  let queueEntry = null;

  if (req.body.action === 'ACCEPT') {
    await assertStillAvailable(appointment);
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { ...responseData, status: 'CONFIRMED' },
    });
  } else if (req.body.action === 'ADD_TO_QUEUE') {
    const appointmentDay = appointment.appointmentDate.toISOString().slice(0, 10);
    if (appointmentDay !== addisDate()) {
      throw new AppError('Appointment can only be added to the queue on its booked date', 409);
    }
    queueEntry = await createQueueEntry(req.businessId, {
      customerId: appointment.customerId,
      serviceId: appointment.serviceId,
      staffId: appointment.staffId,
      appointmentId: appointment.id,
      source: 'APPOINTMENT',
      notes: `Appointment ${appointment.id}`,
    }, io(req));
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { ...responseData, status: 'ADDED_TO_QUEUE' },
    });
  } else {
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        ...responseData,
        status: 'DECLINED',
        responseReason: req.body.reason,
      },
    });
  }

  const updated = await prisma.appointment.findUnique({
    where: { id: appointment.id },
    include: { ...include, queueEntry: true },
  });
  if (io(req)) emitBusiness(io(req), req.businessId, 'appointment_updated', { appointment: updated });
  void pushAppointmentResponse(updated, queueEntry).catch((error) => {
    console.error('Appointment response push failed:', error.message);
  });
  return ok(res, { appointment: updated, queueEntry }, 'Appointment request handled');
}
