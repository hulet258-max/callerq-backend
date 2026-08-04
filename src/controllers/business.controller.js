import { prisma } from '../database/prisma.js';
import { AppError } from '../utils/app-error.js';
import { ok } from '../utils/response.js';
import { templateRows } from '../services/template.service.js';

export async function getMine(req, res) {
  if (!req.businessId) throw new AppError('Business profile not found', 404);
  const business = await prisma.business.findUnique({ where: { id: req.businessId } });
  return ok(res, { business });
}

export async function create(req, res) {
  if (req.businessId) throw new AppError('This user already owns a business', 409);
  const business = await prisma.$transaction(async (tx) => {
    const created = await tx.business.create({ data: { ...req.body, ownerId: req.user.id } });
    await tx.messageTemplate.createMany({ data: templateRows(created.id) });
    return created;
  });
  return ok(res, { business }, 'Business created', 201);
}

export async function update(req, res) {
  if (req.params.id !== req.businessId) throw new AppError('Business not found', 404);
  const business = await prisma.business.update({ where: { id: req.businessId }, data: req.body });
  return ok(res, { business }, 'Business updated');
}
