import { prisma } from '../database/prisma.js';
import { AppError } from '../utils/app-error.js';
import { ok } from '../utils/response.js';
import { normalizeEthiopianPhone } from '../utils/phone.js';

const include = {
  favoriteService: true,
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
  const customer = await prisma.customer.upsert({
    where: { businessId_normalizedPhone: { businessId: req.businessId, normalizedPhone } },
    create: { ...req.body, phone: normalizedPhone, normalizedPhone, businessId: req.businessId },
    update: { fullName: req.body.fullName, ...(req.body.gender !== undefined ? { gender: req.body.gender } : {}) },
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
  const customer = await prisma.customer.update({ where: { id: found.id }, data: { ...req.body, ...phoneData }, include });
  return ok(res, { customer }, 'Customer updated');
}

export async function remove(req, res) {
  const found = await prisma.customer.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!found) throw new AppError('Customer not found', 404);
  await prisma.customer.delete({ where: { id: found.id } });
  return ok(res, {}, 'Customer deleted');
}
