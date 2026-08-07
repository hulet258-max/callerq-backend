import { prisma } from '../database/prisma.js';
import { AppError } from '../utils/app-error.js';
import { ok } from '../utils/response.js';

function controller(model, label, include) {
  return {
    list: async (req, res) => ok(res, { [`${model}s`]: await prisma[model].findMany({ where: { businessId: req.businessId }, include, orderBy: { createdAt: 'desc' } }) }),
    create: async (req, res) => ok(res, { [model]: await prisma[model].create({ data: { ...req.body, businessId: req.businessId }, include }) }, `${label} created`, 201),
    get: async (req, res) => {
      const record = await prisma[model].findFirst({ where: { id: req.params.id, businessId: req.businessId }, include });
      if (!record) throw new AppError(`${label} not found`, 404);
      return ok(res, { [model]: record });
    },
    update: async (req, res) => {
      const found = await prisma[model].findFirst({ where: { id: req.params.id, businessId: req.businessId } });
      if (!found) throw new AppError(`${label} not found`, 404);
      return ok(res, { [model]: await prisma[model].update({ where: { id: found.id }, data: req.body, include }) }, `${label} updated`);
    },
    remove: async (req, res) => {
      const found = await prisma[model].findFirst({ where: { id: req.params.id, businessId: req.businessId } });
      if (!found) throw new AppError(`${label} not found`, 404);
      await prisma[model].delete({ where: { id: found.id } });
      return ok(res, {}, `${label} deleted`);
    },
  };
}

export const services = controller('service', 'Service', { images: { orderBy: { sortOrder: 'asc' } } });
