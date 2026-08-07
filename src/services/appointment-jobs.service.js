import { prisma } from '../database/prisma.js';
import { createQueueEntry } from './queue.service.js';
import { pushAppointmentReminder } from './push.service.js';

const reminderOffsets = {
  DAY_BEFORE: 24 * 60,
  MINUTES_30: 30,
  MINUTES_15: 15,
};

function addisDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export async function runAppointmentJobs(io, now = new Date()) {
  const today = addisDate(now);
  const dueQueue = await prisma.appointment.findMany({
    where: { appointmentDate: new Date(`${today}T00:00:00.000Z`), status: 'CONFIRMED', queueEntry: null },
    orderBy: { startTime: 'asc' },
  });
  for (const appointment of dueQueue) {
    try {
      await createQueueEntry(appointment.businessId, {
        customerId: appointment.customerId,
        serviceId: appointment.serviceId,
        appointmentId: appointment.id,
        source: 'APPOINTMENT',
        notes: `Appointment ${appointment.id}`,
      }, io);
      await prisma.appointment.update({ where: { id: appointment.id }, data: { status: 'ADDED_TO_QUEUE' } });
    } catch (error) {
      console.error('Booked-day queue insertion failed:', appointment.id, error.message);
    }
  }

  const upcoming = await prisma.appointment.findMany({
    where: { status: { in: ['CONFIRMED', 'SCHEDULED'] }, requesterDeviceId: { not: null } },
    include: { service: true, business: true, reminders: true },
  });
  for (const appointment of upcoming) {
    const startsAt = new Date(`${appointment.appointmentDate.toISOString().slice(0, 10)}T${appointment.startTime}:00+03:00`);
    const minutesUntil = (startsAt.getTime() - now.getTime()) / 60000;
    for (const [kind, offset] of Object.entries(reminderOffsets)) {
      if (appointment.reminders.some((item) => item.kind === kind)) continue;
      const due = kind === 'DAY_BEFORE'
        ? minutesUntil <= offset && minutesUntil > 30
        : kind === 'MINUTES_30'
          ? minutesUntil <= offset && minutesUntil > 15
          : minutesUntil <= offset && minutesUntil >= 0;
      if (!due) continue;
      try {
        await prisma.appointmentReminder.create({ data: { appointmentId: appointment.id, kind } });
        const delivery = await pushAppointmentReminder(appointment, kind);
        if (delivery?.status === 'SENT') {
          await prisma.appointmentReminder.update({ where: { appointmentId_kind: { appointmentId: appointment.id, kind } }, data: { sentAt: new Date() } });
        } else {
          await prisma.appointmentReminder.delete({ where: { appointmentId_kind: { appointmentId: appointment.id, kind } } });
        }
      } catch (error) {
        if (error?.code !== 'P2002') console.error('Appointment reminder failed:', appointment.id, kind, error.message);
      }
    }
  }
}
