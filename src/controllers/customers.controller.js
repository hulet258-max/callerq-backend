import { prisma } from '../database/prisma.js';
import { AppError } from '../utils/app-error.js';
import { ok } from '../utils/response.js';

const include = { favoriteService: true, favoriteStaff: true };

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
  const customer = await prisma.customer.findUnique({ where: { businessId_phone: { businessId: req.businessId, phone: req.params.phone } }, include });
  if (!customer) throw new AppError('Customer not found', 404);
  return ok(res, { customer });
}

export async function create(req, res) {
  const customer = await prisma.customer.create({ data: { ...req.body, businessId: req.businessId }, include });
  return ok(res, { customer }, 'Customer created', 201);
}

export async function get(req, res) {
  const customer = await prisma.customer.findFirst({ where: { id: req.params.id, businessId: req.businessId }, include: { ...include, queueEntries: { include: { service: true, staff: true }, orderBy: { createdAt: 'desc' }, take: 10 }, appointments: { include: { service: true, staff: true }, orderBy: { appointmentDate: 'desc' }, take: 10 } } });
  if (!customer) throw new AppError('Customer not found', 404);
  return ok(res, { customer });
}

export async function update(req, res) {
  const found = await prisma.customer.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!found) throw new AppError('Customer not found', 404);
  const customer = await prisma.customer.update({ where: { id: found.id }, data: req.body, include });
  return ok(res, { customer }, 'Customer updated');
}

export async function remove(req, res) {
  const found = await prisma.customer.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!found) throw new AppError('Customer not found', 404);
  await prisma.customer.delete({ where: { id: found.id } });
  return ok(res, {}, 'Customer deleted');
}
