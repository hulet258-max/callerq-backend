import { prisma } from '../database/prisma.js';
import { AppError } from '../utils/app-error.js';
import { renderTemplate } from './template.service.js';
import { emitBusiness } from '../sockets/index.js';

export async function notifyQueueEntry(businessId, queueEntryId, io) {
  const entry = await prisma.queueEntry.findFirst({ where: { id: queueEntryId, businessId }, include: { customer: true, business: true, service: true } });
  if (!entry) throw new AppError('Queue entry not found', 404);
  const template = await prisma.messageTemplate.findFirst({ where: { businessId, type: 'NEXT_CUSTOMER', isActive: true } });
  if (!template) throw new AppError('NEXT_CUSTOMER template not found', 404);
  const message = renderTemplate(template.body, {
    customer_name: entry.customer.fullName,
    business_name: entry.business.name,
    queue_number: entry.queueNumber,
    wait_minutes: entry.estimatedWaitMinutes,
    service_name: entry.service.name,
  });
  const notification = await prisma.notification.create({
    data: { businessId, customerId: entry.customerId, queueEntryId: entry.id, type: 'QUEUE', channel: 'SMS', title: template.title, message },
    include: { customer: true, queueEntry: true },
  });
  if (io) emitBusiness(io, businessId, 'notification_created', { notification });
  return notification;
}
