import { prisma } from '../database/prisma.js';
import { AppError } from '../utils/app-error.js';
import { ok } from '../utils/response.js';
import { emitBusiness } from '../sockets/index.js';
import { notifyQueueEntry } from '../services/notification.service.js';
import { renderTemplate } from '../services/template.service.js';

export async function listTemplates(req, res) {
  return ok(res, { messageTemplates: await prisma.messageTemplate.findMany({ where: { businessId: req.businessId }, orderBy: { type: 'asc' } }) });
}
export async function createTemplate(req, res) {
  return ok(res, { messageTemplate: await prisma.messageTemplate.create({ data: { ...req.body, businessId: req.businessId } }) }, 'Template created', 201);
}
export async function updateTemplate(req, res) {
  const found = await prisma.messageTemplate.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!found) throw new AppError('Message template not found', 404);
  const messageTemplate = await prisma.messageTemplate.update({ where: { id: found.id }, data: req.body });
  return ok(res, { messageTemplate }, 'Template updated');
}
export async function deleteTemplate(req, res) {
  const found = await prisma.messageTemplate.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!found) throw new AppError('Message template not found', 404);
  await prisma.messageTemplate.delete({ where: { id: found.id } });
  return ok(res, {}, 'Template deleted');
}
export async function previewTemplate(req, res) {
  const found = await prisma.messageTemplate.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!found) throw new AppError('Message template not found', 404);
  return ok(res, { message: renderTemplate(found.body, req.body.variables || {}) }, 'Template rendered');
}

export async function listNotifications(req, res) {
  const notifications = await prisma.notification.findMany({ where: { businessId: req.businessId, audience: 'BUSINESS' }, include: { customer: true, queueEntry: true, appointment: true }, orderBy: { createdAt: 'desc' } });
  return ok(res, { notifications });
}
export async function createNotification(req, res) {
  const notification = await prisma.notification.create({ data: { ...req.body, businessId: req.businessId, sentAt: req.body.status === 'SENT' ? new Date() : null }, include: { customer: true } });
  const io = req.app.get('io');
  if (io) emitBusiness(io, req.businessId, 'notification_created', { notification });
  return ok(res, { notification }, 'Notification created', 201);
}
export async function notifyQueue(req, res) {
  return ok(res, { notification: await notifyQueueEntry(req.businessId, req.params.queueEntryId, req.app.get('io')) }, 'Message preview generated', 201);
}
export async function markNotificationSent(req, res) {
  const found = await prisma.notification.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!found) throw new AppError('Notification not found', 404);
  const notification = await prisma.notification.update({ where: { id: found.id }, data: { status: 'SENT', sentAt: new Date() } });
  return ok(res, { notification }, 'Notification marked as sent');
}
