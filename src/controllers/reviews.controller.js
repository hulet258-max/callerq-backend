import { prisma } from '../database/prisma.js';
import { AppError } from '../utils/app-error.js';
import { ok } from '../utils/response.js';

export async function listForBusiness(req, res) {
  const reviews = await prisma.review.findMany({
    where: { businessId: req.params.id },
    select: {
      id: true, rating: true, comment: true, createdAt: true,
      customer: { select: { fullName: true } },
      service: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return ok(res, { reviews });
}

export async function create(req, res) {
  const appointment = await prisma.appointment.findFirst({
    where: {
      id: req.body.appointmentId,
      status: 'COMPLETED',
      requesterDevice: { installationId: req.body.installationId },
    },
    select: { id: true, businessId: true, serviceId: true, customerId: true, review: { select: { id: true } } },
  });
  if (!appointment) throw new AppError('Completed appointment not found for this device', 404);
  if (appointment.review) throw new AppError('This appointment has already been reviewed', 409);
  const review = await prisma.review.create({
    data: {
      appointmentId: appointment.id,
      businessId: appointment.businessId,
      serviceId: appointment.serviceId,
      customerId: appointment.customerId,
      rating: req.body.rating,
      comment: req.body.comment || null,
    },
    include: { service: { select: { id: true, name: true } } },
  });
  return ok(res, { review }, 'Thank you for your review', 201);
}
