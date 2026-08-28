import { prisma } from '../database/prisma.js';
import { AppError } from '../utils/app-error.js';
import { ok } from '../utils/response.js';
import { normalizeEthiopianPhone } from '../utils/phone.js';
import { pushManualCustomerReminder } from '../services/push.service.js';

const include = {
  favoriteService: true,
  customerNotes: { orderBy: { createdAt: 'desc' } },
  queueEntries: {
    where: { status: 'COMPLETED' },
    include: { service: true },
    orderBy: { completedAt: 'desc' },
    take: 1,
  },
};

export async function list(req, res) {
  const query = String(req.query.query || '').trim();
  const customers = await prisma.customer.findMany({
    where: { businessId: req.businessId, ...(query ? { OR: [{ fullName: { contains: query, mode: 'insensitive' } }, { phone: { contains: query } }] } : {}) },
    include,
    orderBy: { createdAt: 'desc' },
  });
  return ok(res, { customers });
}

export const search = list;

export async function byPhone(req, res) {
  const normalizedPhone = normalizeEthiopianPhone(req.params.phone);
  const customer = await prisma.customer.findUnique({ where: { businessId_normalizedPhone: { businessId: req.businessId, normalizedPhone } }, include });
  if (!customer) throw new AppError('Customer not found', 404);
  return ok(res, { customer });
}

export async function create(req, res) {
  const normalizedPhone = normalizeEthiopianPhone(req.body.phone);
  const interval = req.body.serviceIntervalDays;
  const nextServiceReminderAt = interval
    ? new Date(Date.now() + interval * 86_400_000)
    : null;
  const customer = await prisma.customer.upsert({
    where: { businessId_normalizedPhone: { businessId: req.businessId, normalizedPhone } },
    create: { ...req.body, nextServiceReminderAt, phone: normalizedPhone, normalizedPhone, businessId: req.businessId },
    update: { fullName: req.body.fullName, ...(req.body.gender !== undefined ? { gender: req.body.gender } : {}), ...(interval !== undefined ? { serviceIntervalDays: interval, nextServiceReminderAt } : {}) },
    include,
  });
  return ok(res, { customer }, 'Customer saved', 201);
}

export async function importContacts(req, res) {
  const unique = new Map();
  for (const contact of req.body.contacts) {
    try {
      let normalizedPhone;
      try {
        normalizedPhone = normalizeEthiopianPhone(contact.phone);
      } catch {
        const raw = String(contact.phone).trim();
        const digits = raw.replace(/\D/g, '');
        if (digits.length < 7 || digits.length > 15) continue;
        normalizedPhone = raw.startsWith('+') ? `+${digits}` : digits;
      }
      unique.set(normalizedPhone, { fullName: contact.fullName.trim() || normalizedPhone, normalizedPhone });
    } catch {
      // Ignore device contacts that are not valid callable phone numbers.
    }
  }
  await prisma.$transaction([...unique.values()].map((contact) => prisma.customer.upsert({
    where: { businessId_normalizedPhone: { businessId: req.businessId, normalizedPhone: contact.normalizedPhone } },
    create: { businessId: req.businessId, fullName: contact.fullName, phone: contact.normalizedPhone, normalizedPhone: contact.normalizedPhone },
    update: {},
  })));
  return ok(res, { importedCount: unique.size }, 'Phone contacts imported');
}

export async function get(req, res) {
  const customer = await prisma.customer.findFirst({ where: { id: req.params.id, businessId: req.businessId }, include: { ...include, queueEntries: { include: { service: true }, orderBy: { createdAt: 'desc' }, take: 10 }, appointments: { include: { service: true }, orderBy: { appointmentDate: 'desc' }, take: 10 } } });
  if (!customer) throw new AppError('Customer not found', 404);
  return ok(res, { customer });
}

export async function update(req, res) {
  const found = await prisma.customer.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!found) throw new AppError('Customer not found', 404);
  const phoneData = req.body.phone ? { phone: normalizeEthiopianPhone(req.body.phone), normalizedPhone: normalizeEthiopianPhone(req.body.phone) } : {};
  const scheduleData = req.body.serviceIntervalDays === undefined
    ? {}
    : {
        nextServiceReminderAt: req.body.serviceIntervalDays
          ? new Date((found.lastVisitAt || new Date()).getTime() + req.body.serviceIntervalDays * 86_400_000)
          : null,
        lastServiceReminderSentAt: null,
      };
  const customer = await prisma.customer.update({ where: { id: found.id }, data: { ...req.body, ...phoneData, ...scheduleData }, include });
  return ok(res, { customer }, 'Customer updated');
}

export async function addNote(req, res) {
  const customer = await prisma.customer.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!customer) throw new AppError('Customer not found', 404);
  const note = await prisma.customerNote.create({ data: { customerId: customer.id, ...req.body } });
  return ok(res, { note }, 'Customer note added', 201);
}

export async function removeNote(req, res) {
  const note = await prisma.customerNote.findFirst({
    where: { id: req.params.noteId, customerId: req.params.id, customer: { businessId: req.businessId } },
  });
  if (!note) throw new AppError('Customer note not found', 404);
  await prisma.customerNote.delete({ where: { id: note.id } });
  return ok(res, {}, 'Customer note deleted');
}

export async function remind(req, res) {
  const customer = await prisma.customer.findFirst({
    where: { id: req.params.id, businessId: req.businessId },
    include: { favoriteService: true, queueEntries: { where: { status: 'COMPLETED' }, include: { service: true }, orderBy: { completedAt: 'desc' }, take: 1 } },
  });
  if (!customer) throw new AppError('Customer not found', 404);
  const serviceName = customer.queueEntries[0]?.service?.name || customer.favoriteService?.name;
  const notification = await prisma.notification.create({
    data: {
      businessId: req.businessId,
      customerId: customer.id,
      type: 'CUSTOMER_REMINDER',
      channel: 'APP',
      audience: 'CUSTOMER',
      title: 'Service reminder',
      message: serviceName
        ? `It may be time for your next ${serviceName} visit.`
        : 'It may be time for your next visit.',
    },
    include: { customer: true },
  });
  const delivered = await pushManualCustomerReminder(customer, notification);
  return ok(res, { notification: delivered }, delivered.status === 'SENT' ? 'Customer reminder sent' : 'Customer reminder recorded; use SMS if the customer has no Suppercall device', 201);
}

export async function remove(req, res) {
  const found = await prisma.customer.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!found) throw new AppError('Customer not found', 404);
  await prisma.customer.delete({ where: { id: found.id } });
  return ok(res, {}, 'Customer deleted');
}
