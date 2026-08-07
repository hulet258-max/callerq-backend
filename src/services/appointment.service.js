import { AppError } from '../utils/app-error.js';
import { dateOnly } from '../utils/dates.js';

export const appointmentInclude = { customer: true, service: true };
const blockingStatuses = ['REQUESTED', 'SCHEDULED', 'CONFIRMED', 'ARRIVED', 'ADDED_TO_QUEUE', 'RESCHEDULED'];

function clockMinutes(value) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function minuteClock(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function bookingInstant(date, time) {
  // Ethiopia uses UTC+03:00 year-round.
  return new Date(`${date}T${time}:00+03:00`);
}

export async function createScheduledAppointment(db, businessId, input, { source = 'OWNER', now = new Date() } = {}) {
  const [customer, service] = await Promise.all([
    db.customer.findFirst({ where: { id: input.customerId, businessId }, select: { id: true } }),
    db.service.findFirst({ where: { id: input.serviceId, businessId, isActive: true }, select: { id: true, durationMinutes: true } }),
  ]);
  if (!customer) throw new AppError('Customer not found', 404);
  if (!service) throw new AppError('Active service not found for this business', 404);

  const startMinutes = clockMinutes(input.startTime);
  const endMinutes = startMinutes + service.durationMinutes;
  if (endMinutes >= 24 * 60) throw new AppError('Appointment must finish on the selected date', 400);
  const endTime = minuteClock(endMinutes);
  const instant = bookingInstant(input.appointmentDate, input.startTime);
  if (Number.isNaN(instant.getTime()) || instant <= now) throw new AppError('Appointment must be in the future', 400);

  // One business has one provider. Serialize every booking for that business/day.
  if (typeof db.$executeRaw === 'function') {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${businessId}:${input.appointmentDate}`}))`;
  }
  const conflict = await db.appointment.findFirst({
    where: {
      businessId,
      appointmentDate: dateOnly(input.appointmentDate),
      status: { in: blockingStatuses },
      startTime: { lt: endTime },
      endTime: { gt: input.startTime },
    },
    select: { id: true },
  });
  if (conflict) throw new AppError('This time is no longer available', 409);

  const { appointmentDate, endTime: _clientEndTime, ...data } = input;
  return db.appointment.create({
    data: { ...data, businessId, appointmentDate: dateOnly(appointmentDate), endTime, source },
    include: appointmentInclude,
  });
}
