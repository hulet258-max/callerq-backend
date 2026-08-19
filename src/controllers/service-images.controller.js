import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { prisma } from '../database/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';
import { ok } from '../utils/response.js';

const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
const storage = multer.diskStorage({
  destination: (_req, _file, done) => done(null, env.uploadDir),
  filename: (_req, file, done) => {
    const extension = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype] || '';
    done(null, `${crypto.randomUUID()}${extension}`);
  },
});

export const uploadServiceImages = multer({
  storage,
  limits: { files: 10, fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, done) => done(allowed.has(file.mimetype) ? null : new AppError('Only JPG, PNG, and WebP images are allowed', 400), allowed.has(file.mimetype)),
}).array('images', 10);

export const uploadBusinessProfileImage = multer({
  storage,
  limits: { files: 1, fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, done) => done(allowed.has(file.mimetype) ? null : new AppError('Only JPG, PNG, and WebP images are allowed', 400), allowed.has(file.mimetype)),
}).single('images');

export async function ensureUploadDirectory() {
  await fs.mkdir(env.uploadDir, { recursive: true });
}

async function ownedService(req) {
  const service = await prisma.service.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!service) throw new AppError('Service not found', 404);
  return service;
}

export async function create(req, res) {
  await ownedService(req);
  const files = req.files || [];
  if (!files.length) throw new AppError('Choose at least one image', 400);
  const existing = await prisma.serviceImage.count({ where: { serviceId: req.params.id } });
  if (existing + files.length > 10) throw new AppError('A service can have at most 10 images', 400);
  const base = env.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
  const images = await prisma.$transaction(files.map((file, index) => prisma.serviceImage.create({ data: {
    serviceId: req.params.id,
    fileName: file.filename,
    url: `${base}/uploads/${file.filename}`,
    sortOrder: existing + index,
    isCover: existing === 0 && index === 0,
  } })));
  return ok(res, { images }, 'Images uploaded', 201);
}

export async function update(req, res) {
  await ownedService(req);
  const image = await prisma.serviceImage.findFirst({ where: { id: req.params.imageId, serviceId: req.params.id } });
  if (!image) throw new AppError('Image not found', 404);
  const sortOrder = Number(req.body.sortOrder);
  const data = {
    ...(req.body.caption !== undefined ? { caption: String(req.body.caption).trim().slice(0, 300) || null } : {}),
    ...(Number.isInteger(sortOrder) && sortOrder >= 0 ? { sortOrder } : {}),
    ...(req.body.isCover !== undefined ? { isCover: req.body.isCover === true || req.body.isCover === 'true' } : {}),
  };
  if (data.isCover) await prisma.serviceImage.updateMany({ where: { serviceId: req.params.id }, data: { isCover: false } });
  return ok(res, { image: await prisma.serviceImage.update({ where: { id: image.id }, data }) }, 'Image updated');
}

export async function remove(req, res) {
  await ownedService(req);
  const image = await prisma.serviceImage.findFirst({ where: { id: req.params.imageId, serviceId: req.params.id } });
  if (!image) throw new AppError('Image not found', 404);
  await prisma.serviceImage.delete({ where: { id: image.id } });
  await fs.unlink(path.join(env.uploadDir, path.basename(image.fileName))).catch(() => {});
  if (image.isCover) {
    const next = await prisma.serviceImage.findFirst({ where: { serviceId: req.params.id }, orderBy: { sortOrder: 'asc' } });
    if (next) await prisma.serviceImage.update({ where: { id: next.id }, data: { isCover: true } });
  }
  return ok(res, {}, 'Image deleted');
}
