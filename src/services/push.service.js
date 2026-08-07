import { getMessaging } from 'firebase-admin/messaging';
import { prisma } from '../database/prisma.js';
import { firebaseAdminApp } from './firebase-admin.service.js';

let messaging;

function firebaseMessaging() {
  if (messaging !== undefined) return messaging;
  try {
    const app = firebaseAdminApp();
    if (!app) {
      messaging = null;
      return null;
    }
    messaging = getMessaging(app);
  } catch (error) {
    console.error('Firebase initialization failed:', error.message);
    messaging = null;
  }
  return messaging;
}

export async function upsertPushDevice({ installationId, fcmToken, platform = 'ANDROID' }) {
  const byInstallation = await prisma.pushDevice.findUnique({ where: { installationId } });
  const byToken = await prisma.pushDevice.findUnique({ where: { fcmToken } });
  const existing = byInstallation || byToken;
  if (existing) {
    return prisma.pushDevice.update({
      where: { id: existing.id },
      data: { installationId, fcmToken, platform, enabled: true, lastSeenAt: new Date() },
    });
  }
  return prisma.pushDevice.create({
    data: { installationId, fcmToken, platform, enabled: true },
  });
}

export async function linkOwnerDevice(userId, input) {
  const device = await upsertPushDevice(input);
  await prisma.userPushDevice.upsert({
    where: { userId_deviceId: { userId, deviceId: device.id } },
    create: { userId, deviceId: device.id },
    update: {},
  });
  return device;
}

export async function unlinkOwnerDevice(userId, installationId) {
  const device = await prisma.pushDevice.findUnique({ where: { installationId } });
  if (!device) return;
  await prisma.userPushDevice.deleteMany({ where: { userId, deviceId: device.id } });
}

async function deliver({ notification, devices, data }) {
  if (!devices.length) {
    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: 'FAILED' },
    });
    return notification;
  }

  await prisma.pushDelivery.createMany({
    data: devices.map((device) => ({ notificationId: notification.id, deviceId: device.id })),
    skipDuplicates: true,
  });

  const firebase = firebaseMessaging();
  if (!firebase) {
    await prisma.$transaction([
      prisma.pushDelivery.updateMany({
        where: { notificationId: notification.id },
        data: { status: 'FAILED', error: 'Firebase is not configured' },
      }),
      prisma.notification.update({
        where: { id: notification.id },
        data: { status: 'FAILED' },
      }),
    ]);
    return notification;
  }

  const responses = await Promise.all(devices.map(async (device) => {
    try {
      const providerMessageId = await firebase.send({
        token: device.fcmToken,
        notification: { title: notification.title, body: notification.message },
        data: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value)])),
        android: {
          priority: 'high',
          notification: {
            channelId: 'appointment_requests',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
            sound: 'default',
          },
        },
      });
      await prisma.pushDelivery.update({
        where: { notificationId_deviceId: { notificationId: notification.id, deviceId: device.id } },
        data: { status: 'SENT', sentAt: new Date(), providerMessageId, error: null },
      });
      return true;
    } catch (error) {
      const code = error?.code || 'messaging/unknown-error';
      await prisma.pushDelivery.update({
        where: { notificationId_deviceId: { notificationId: notification.id, deviceId: device.id } },
        data: { status: 'FAILED', error: `${code}: ${error?.message || 'Push failed'}`.slice(0, 1000) },
      });
      if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(code)) {
        await prisma.pushDevice.update({ where: { id: device.id }, data: { enabled: false } });
      }
      return false;
    }
  }));

  const sent = responses.some(Boolean);
  return prisma.notification.update({
    where: { id: notification.id },
    data: { status: sent ? 'SENT' : 'FAILED', sentAt: sent ? new Date() : null },
  });
}

export async function pushAppointmentRequest(appointment) {
  const business = await prisma.business.findUnique({
    where: { id: appointment.businessId },
    select: {
      name: true,
      owner: {
        select: {
          pushDevices: { where: { device: { enabled: true } }, select: { device: true } },
        },
      },
    },
  });
  if (!business) return null;
  const notification = await prisma.notification.create({
    data: {
      businessId: appointment.businessId,
      customerId: appointment.customerId,
      appointmentId: appointment.id,
      type: 'APPOINTMENT',
      channel: 'APP',
      audience: 'BUSINESS',
      title: 'New appointment request',
      message: `${appointment.customer.fullName} requested ${appointment.service.name} on ${appointment.appointmentDate.toISOString().slice(0, 10)} at ${appointment.startTime}.`,
    },
  });
  return deliver({
    notification,
    devices: business.owner.pushDevices.map((link) => link.device),
    data: {
      type: 'appointment_request',
      appointmentId: appointment.id,
      businessId: appointment.businessId,
    },
  });
}

export async function pushAppointmentResponse(appointment, queueEntry = null) {
  if (!appointment.requesterDeviceId) return null;
  const device = await prisma.pushDevice.findFirst({
    where: { id: appointment.requesterDeviceId, enabled: true },
  });
  const statusText = appointment.status === 'CONFIRMED'
    ? 'confirmed'
    : appointment.status === 'ADDED_TO_QUEUE'
      ? `added to queue #${queueEntry?.queueNumber || ''}`.trim()
      : 'declined';
  const detail = appointment.status === 'DECLINED'
    ? [appointment.responseReason?.replaceAll('_', ' ').toLowerCase(), appointment.responseNote]
        .filter(Boolean).join(' — ')
    : appointment.status === 'ADDED_TO_QUEUE'
      ? `Estimated wait: ${queueEntry?.estimatedWaitMinutes || 0} minutes.`
      : `${appointment.appointmentDate.toISOString().slice(0, 10)} at ${appointment.startTime}.`;
  const notification = await prisma.notification.create({
    data: {
      businessId: appointment.businessId,
      customerId: appointment.customerId,
      appointmentId: appointment.id,
      queueEntryId: queueEntry?.id,
      type: 'APPOINTMENT',
      channel: 'APP',
      audience: 'CUSTOMER',
      title: `Appointment ${statusText}`,
      message: detail,
    },
  });
  return deliver({
    notification,
    devices: device ? [device] : [],
    data: {
      type: 'appointment_response',
      appointmentId: appointment.id,
      businessId: appointment.businessId,
      status: appointment.status,
      queueEntryId: queueEntry?.id || '',
      queueNumber: String(queueEntry?.queueNumber || ''),
      estimatedWaitMinutes: String(queueEntry?.estimatedWaitMinutes || 0),
    },
  });
}

export async function pushAppointmentReminder(appointment, kind) {
  if (!appointment.requesterDeviceId) return null;
  const device = await prisma.pushDevice.findFirst({ where: { id: appointment.requesterDeviceId, enabled: true } });
  const label = kind === 'DAY_BEFORE' ? 'tomorrow' : kind === 'MINUTES_30' ? 'in 30 minutes' : 'in 15 minutes';
  const notification = await prisma.notification.create({ data: {
    businessId: appointment.businessId,
    customerId: appointment.customerId,
    appointmentId: appointment.id,
    type: 'APPOINTMENT', channel: 'APP', audience: 'CUSTOMER',
    title: `Appointment ${label}`,
    message: `${appointment.service.name} at ${appointment.business.name} starts ${label}.`,
  } });
  return deliver({
    notification,
    devices: device ? [device] : [],
    data: { type: 'appointment_reminder', appointmentId: appointment.id, kind },
  });
}
