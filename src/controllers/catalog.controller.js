import { prisma } from '../database/prisma.js';
import { AppError } from '../utils/app-error.js';
import { ok } from '../utils/response.js';

function controller(model, label) {
  return {
    list: async (req, res) => ok(res, { [`${model}s`]: await prisma[model].findMany({ where: { businessId: req.businessId }, orderBy: { createdAt: 'desc' } }) }),
    create: async (req, res) => ok(res, { [model]: await prisma[model].create({ data: { ...req.body, businessId: req.businessId } }) }, `${label} created`, 201),
    get: async (req, res) => {
      const record = await prisma[model].findFirst({ where: { id: req.params.id, businessId: req.businessId } });
      if (!record) throw new AppError(`${label} not found`, 404);
      return ok(res, { [model]: record });
    },
    update: async (req, res) => {
      const found = await prisma[model].findFirst({ where: { id: req.params.id, businessId: req.businessId } });
      if (!found) throw new AppError(`${label} not found`, 404);
      return ok(res, { [model]: await prisma[model].update({ where: { id: found.id }, data: req.body }) }, `${label} updated`);
    },
    remove: async (req, res) => {
      const found = await prisma[model].findFirst({ where: { id: req.params.id, businessId: req.businessId } });
      if (!found) throw new AppError(`${label} not found`, 404);
      await prisma[model].delete({ where: { id: found.id } });
      return ok(res, {}, `${label} deleted`);
    },
  };
}

export const services = controller('service', 'Service');
export const staff = controller('staff', 'Staff');

export async function updateStaffStatus(req, res) {
  const found = await prisma.staff.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!found) throw new AppError('Staff not found', 404);
  const record = await prisma.staff.update({ where: { id: found.id }, data: { status: req.body.status } });
  return ok(res, { staff: record }, 'Staff status updated');
}
