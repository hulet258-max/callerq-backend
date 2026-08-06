import { prisma } from '../database/prisma.js';
import { ok } from '../utils/response.js';
import { linkOwnerDevice, unlinkOwnerDevice, upsertPushDevice } from '../services/push.service.js';

export async function registerPublic(req, res) {
  const device = await upsertPushDevice(req.body);
  return ok(res, { device: { installationId: device.installationId, platform: device.platform } }, 'Push device registered');
}

export async function registerOwner(req, res) {
  const device = await linkOwnerDevice(req.user.id, req.body);
  return ok(res, { device: { installationId: device.installationId, platform: device.platform } }, 'Owner push device registered');
}

export async function unregisterOwner(req, res) {
  await unlinkOwnerDevice(req.user.id, req.params.installationId);
  return ok(res, {}, 'Owner push device unregistered');
}

export async function status(req, res) {
  const installationId = String(req.headers['x-callerq-installation-id'] || '').trim();
  const appointment = installationId
    ? await prisma.appointment.findFirst({
        where: { id: req.params.id, requesterDevice: { installationId } },
        include: {
          business: { select: { id: true, name: true, city: true, address: true } },
          service: true,
          staff: { select: { id: true, fullName: true } },
          queueEntry: { select: { id: true, queueNumber: true, estimatedWaitMinutes: true, status: true } },
        },
      })
    : null;
  if (!appointment) return res.status(404).json({ success: false, message: 'Appointment not found' });
  return ok(res, {
    appointment: {
      id: appointment.id,
      appointmentDate: appointment.appointmentDate.toISOString().slice(0, 10),
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      status: appointment.status,
      responseReason: appointment.responseReason,
      responseNote: appointment.responseNote,
      respondedAt: appointment.respondedAt,
      business: appointment.business,
      service: appointment.service,
      staff: appointment.staff,
      queueEntry: appointment.queueEntry,
    },
  });
}
