import { prisma } from '../database/prisma.js';
import { AppError } from '../utils/app-error.js';
import { ok } from '../utils/response.js';
import { normalizeEthiopianPhone } from '../utils/phone.js';
import { createScheduledAppointment } from '../services/appointment.service.js';
import { authorizeCustomerLookup } from '../services/public-booking.service.js';
import { emitBusiness } from '../sockets/index.js';
import { pushAppointmentRequest } from '../services/push.service.js';

const publicBusinessWhere = () => ({
  isActive: true,
  isApproved: true,
  isSuspended: false,
  deletedAt: null,
  subscriptionStatus: 'ACTIVE',
  AND: [{
    OR: [
      { subscriptionExpiresAt: null },
      { subscriptionExpiresAt: { gt: new Date() } },
    ],
  }],
  owner: { isActive: true },
});

const serviceSelect = {
  id: true, name: true, category: true, price: true, durationMinutes: true, isActive: true,
  images: { orderBy: { sortOrder: 'asc' }, select: { id: true, url: true, caption: true, sortOrder: true, isCover: true } },
  reviews: { select: { rating: true } },
};
const businessSelect = {
  id: true, name: true, type: true, city: true, address: true, phone: true, description: true,
  profileImageUrl: true,
  latitude: true, longitude: true, openingTime: true, closingTime: true,
  socialLinks: true, isOpen: true,
  reviews: { select: { rating: true } },
};

function serviceSummary(service) {
  const ratings = service.reviews || [];
  const ratingAverage = ratings.length ? ratings.reduce((sum, item) => sum + item.rating, 0) / ratings.length : 0;
  const { reviews, ...value } = service;
  return { ...value, price: Number(service.price), ratingAverage, ratingCount: ratings.length };
}

function businessSummary(business) {
  return {
    id: business.id,
    name: business.name,
    businessName: business.name,
    type: business.type,
    businessType: business.type,
    city: business.city || '',
    address: business.address || '',
    phone: business.phone,
    description: business.description || '',
    profileImageUrl: business.profileImageUrl || null,
    latitude: business.latitude,
    longitude: business.longitude,
    openingTime: business.openingTime,
    closingTime: business.closingTime,
    isOpen: business.isOpen,
    socialLinks: business.socialLinks || {},
    ratingAverage: business.reviews?.length
      ? business.reviews.reduce((sum, item) => sum + item.rating, 0) / business.reviews.length
      : 0,
    ratingCount: business.reviews?.length || 0,
    services: (business.services || []).map(serviceSummary),
  };
}

function appointmentSummary(appointment, detailedBusiness = false) {
  return {
    id: appointment.id,
    appointmentDate: appointment.appointmentDate.toISOString().slice(0, 10),
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    status: appointment.status,
    responseReason: appointment.responseReason || null,
    responseNote: appointment.responseNote || null,
    respondedAt: appointment.respondedAt || null,
    business: detailedBusiness ? {
      id: appointment.business.id,
      name: appointment.business.name,
      businessName: appointment.business.name,
      city: appointment.business.city || '',
      address: appointment.business.address || '',
      latitude: appointment.business.latitude,
      longitude: appointment.business.longitude,
    } : { id: appointment.business.id, name: appointment.business.name },
    service: {
      id: appointment.service.id,
      name: appointment.service.name,
      ...(detailedBusiness ? {
        price: Number(appointment.service.price),
        durationMinutes: appointment.service.durationMinutes,
      } : {}),
    },
    ...(appointment.queueEntry ? { queueEntry: appointment.queueEntry } : {}),
    canReview: appointment.status === 'COMPLETED' && !appointment.review,
  };
}

export async function listBusinesses(req, res) {
  const query = String(req.query.query || '').trim().slice(0, 120);
  const businesses = await prisma.business.findMany({
    where: {
      ...publicBusinessWhere(),
      ...(query ? { OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { city: { contains: query, mode: 'insensitive' } },
        { address: { contains: query, mode: 'insensitive' } },
      ] } : {}),
    },
    select: {
      ...businessSelect,
      services: { where: { isActive: true }, select: serviceSelect, orderBy: { name: 'asc' } },
    },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  });
  return ok(res, { businesses: businesses.map(businessSummary) });
}

export async function getBusiness(req, res) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(req.params.id)) throw new AppError('Business not found', 404);
  const business = await prisma.business.findFirst({
    where: { id: req.params.id, ...publicBusinessWhere() },
    select: {
      ...businessSelect,
      services: { where: { isActive: true }, select: serviceSelect, orderBy: { name: 'asc' } },
    },
  });
  if (!business) throw new AppError('Business not found', 404);
  return ok(res, { business: businessSummary(business) });
}

export async function createAppointment(req, res) {
  const normalizedPhone = normalizeEthiopianPhone(req.body.customerPhone);
  const business = await prisma.business.findFirst({
    where: { id: req.body.businessId, ...publicBusinessWhere() },
    select: {
      id: true,
      isOpen: true,
      phone: true,
      owner: { select: { phone: true } },
    },
  });
  if (!business) throw new AppError('Business not found or unavailable', 404);
  if (!business.isOpen) throw new AppError('This shop is currently closed', 409);
  if ([business.phone, business.owner.phone].some((value) => {
    try {
      return normalizeEthiopianPhone(value) === normalizedPhone;
    } catch {
      return false;
    }
  })) {
    throw new AppError('You cannot request an appointment from your own business phone', 409);
  }
  const requesterDevice = req.body.installationId
    ? await prisma.pushDevice.findUnique({ where: { installationId: req.body.installationId } })
    : null;

  const appointment = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.upsert({
      where: { businessId_normalizedPhone: { businessId: business.id, normalizedPhone } },
      create: {
        businessId: business.id,
        fullName: req.body.customerName,
        phone: normalizedPhone,
        normalizedPhone,
      },
      update: {},
      select: { id: true },
    });
    return createScheduledAppointment(tx, business.id, {
      customerId: customer.id,
      serviceId: req.body.serviceId,
      appointmentDate: req.body.appointmentDate,
      startTime: req.body.startTime,
      endTime: req.body.endTime,
      notes: req.body.notes,
      status: 'REQUESTED',
      requesterDeviceId: requesterDevice?.id,
    }, { source: 'CUSTOMER_APP' });
  });

  const complete = await prisma.appointment.findUnique({
    where: { id: appointment.id },
    select: {
      id: true, appointmentDate: true, startTime: true, endTime: true, status: true,
      responseReason: true, responseNote: true, respondedAt: true,
      business: { select: { id: true, name: true } },
      service: { select: { id: true, name: true } },
      review: { select: { id: true } },
      queueEntry: { select: { id: true, queueNumber: true, estimatedWaitMinutes: true, status: true } },
    },
  });
  const io = req.app.get('io');
  if (io) emitBusiness(io, business.id, 'appointment_created', { appointment });
  void pushAppointmentRequest(appointment).catch((error) => {
    console.error('Appointment request push failed:', error.message);
  });
  return ok(res, { appointment: appointmentSummary(complete) }, 'Appointment created', 201);
}

export async function listAppointments(req, res) {
  const normalizedPhone = normalizeEthiopianPhone(req.query.phone);
  await authorizeCustomerLookup({ normalizedPhone, req });
  const activeOnly = String(req.query.active || '').toLowerCase() === 'true';
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Addis_Ababa', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const today = new Date(`${localDate}T00:00:00.000Z`);
  const appointments = await prisma.appointment.findMany({
    where: {
      customer: { normalizedPhone },
      ...(activeOnly ? {
        appointmentDate: { gte: today },
        status: { in: ['REQUESTED', 'CONFIRMED', 'ADDED_TO_QUEUE', 'ARRIVED', 'RESCHEDULED'] },
      } : {}),
    },
    include: {
      business: { select: businessSelect },
      service: { select: serviceSelect },
      review: { select: { id: true } },
      queueEntry: { select: { id: true, queueNumber: true, estimatedWaitMinutes: true, status: true } },
    },
  });
  const now = new Date();
  appointments.sort((a, b) => {
    const aTime = new Date(`${a.appointmentDate.toISOString().slice(0, 10)}T${a.startTime}:00+03:00`);
    const bTime = new Date(`${b.appointmentDate.toISOString().slice(0, 10)}T${b.startTime}:00+03:00`);
    const aUpcoming = aTime >= now;
    const bUpcoming = bTime >= now;
    if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
    return aUpcoming ? aTime - bTime : bTime - aTime;
  });
  return ok(res, { appointments: appointments.map((item) => appointmentSummary(item, true)) });
}
