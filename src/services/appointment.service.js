import { AppError } from '../utils/app-error.js';
import { dateOnly } from '../utils/dates.js';

export const appointmentInclude = { customer: true, service: true, staff: true };
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
  const [customer, service, staff] = await Promise.all([
    db.customer.findFirst({ where: { id: input.customerId, businessId }, select: { id: true } }),
    db.service.findFirst({ where: { id: input.serviceId, businessId, isActive: true }, select: { id: true, durationMinutes: true } }),
    input.staffId
      ? db.staff.findFirst({ where: { id: input.staffId, businessId }, select: { id: true, status: true } })
      : Promise.resolve(null),
  ]);
  if (!customer) throw new AppError('Customer not found', 404);
  if (!service) throw new AppError('Active service not found for this business', 404);
  if (input.staffId && !staff) throw new AppError('Staff not found for this business', 404);
  if (source === 'CUSTOMER_APP' && staff?.status === 'OFF_DUTY') throw new AppError('Selected staff member is not bookable', 409);

  const startMinutes = clockMinutes(input.startTime);
  const endMinutes = startMinutes + service.durationMinutes;
  if (endMinutes >= 24 * 60) throw new AppError('Appointment must finish on the selected date', 400);
  const endTime = minuteClock(endMinutes);
  const instant = bookingInstant(input.appointmentDate, input.startTime);
  if (Number.isNaN(instant.getTime()) || instant <= now) throw new AppError('Appointment must be in the future', 400);

  if (input.staffId) {
    // Serialize bookings for one staff member and day. PostgreSQL advisory locks
    // close the race between the overlap check and insert.
    if (typeof db.$executeRaw === 'function') {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.staffId}:${input.appointmentDate}`}))`;
    }
    const conflict = await db.appointment.findFirst({
      where: {
        staffId: input.staffId,
        appointmentDate: dateOnly(input.appointmentDate),
        status: { in: blockingStatuses },
        startTime: { lt: endTime },
        endTime: { gt: input.startTime },
      },
      select: { id: true },
    });
    if (conflict) throw new AppError('The selected staff member is unavailable at that time', 409);
  }

  const { appointmentDate, endTime: _clientEndTime, ...data } = input;
  return db.appointment.create({
    data: { ...data, businessId, appointmentDate: dateOnly(appointmentDate), endTime, source },
    include: appointmentInclude,
  });
}
