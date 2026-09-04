import { prisma } from '../database/prisma.js';
import { AppError } from '../utils/app-error.js';
import { ok } from '../utils/response.js';
import { normalizeEthiopianPhone } from '../utils/phone.js';
import { createScheduledAppointment } from '../services/appointment.service.js';
import { authorizeCustomerLookup } from '../services/public-booking.service.js';
import { emitBusiness } from '../sockets/index.js';
import { pushAppointmentRequest } from '../services/push.service.js';
import { extractAmount, extractReceiptCode, extractTransactionId, verifyPayment } from '../services/deposit.js';
import { assertSuccessfulChapaPayment, verifyChapaTransaction } from '../services/chapa.service.js';

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

export async function getAvailability(req, res) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(req.params.id)) throw new AppError('Business not found', 404);
  const date = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError('Choose a valid date', 400);
  const business = await prisma.business.findFirst({
    where: { id: req.params.id, ...publicBusinessWhere() },
    select: { id: true },
  });
  if (!business) throw new AppError('Business not found', 404);
  const appointments = await prisma.appointment.findMany({
    where: {
      businessId: business.id,
      appointmentDate: new Date(`${date}T00:00:00.000Z`),
      status: { in: ['REQUESTED', 'SCHEDULED', 'CONFIRMED', 'ARRIVED', 'ADDED_TO_QUEUE', 'RESCHEDULED'] },
    },
    select: { startTime: true, endTime: true },
    orderBy: { startTime: 'asc' },
  });
  return ok(res, { appointments });
}

export async function createAppointment(req, res) {
  const normalizedPhone = normalizeEthiopianPhone(req.body.customerPhone);
  const [business, selectedService] = await Promise.all([
    prisma.business.findFirst({
      where: { id: req.body.businessId, ...publicBusinessWhere() },
      select: {
        id: true,
        isOpen: true,
        phone: true,
        owner: { select: { phone: true } },
      },
    }),
    prisma.service.findFirst({
      where: { id: req.body.serviceId, businessId: req.body.businessId, isActive: true },
      select: { id: true, price: true },
    }),
  ]);
  if (!business) throw new AppError('Business not found or unavailable', 404);
  if (!selectedService) throw new AppError('Service not found or unavailable', 404);
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

  let verifiedPayment = null;
  let chapaIntent = null;
  if (req.body.chapaTxRef) {
    chapaIntent = await prisma.chapaPaymentIntent.findUnique({ where: { txRef: req.body.chapaTxRef } });
    if (!chapaIntent
        || chapaIntent.purpose !== 'BOOKING'
        || chapaIntent.businessId !== business.id
        || chapaIntent.serviceId !== selectedService.id
        || chapaIntent.customerName !== req.body.customerName.trim()
        || chapaIntent.normalizedPhone !== normalizedPhone) {
      throw new AppError('Booking payment session does not match these details', 400);
    }
    if (chapaIntent.status === 'CONSUMED') throw new AppError('This payment has already been used', 409);
    if (chapaIntent.expiresAt < new Date()) throw new AppError('This payment session expired. Start again.', 410);
    const payment = assertSuccessfulChapaPayment(await verifyChapaTransaction(chapaIntent.txRef), chapaIntent);
    const used = await prisma.payment.findFirst({ where: { referenceNumber: payment.reference } });
    if (used) throw new AppError('This payment reference has already been used', 409);
    verifiedPayment = { ...payment, method: 'CHAPA' };
  } else if (req.body.paymentReceipt) {
    const expectedDeposit = Math.round(Number(selectedService.price) * 15) / 100;
    const response = await verifyPayment(req.body.paymentReceipt, expectedDeposit);
    if (response?.valid !== true) {
      const status = response?.status >= 400 && response.status < 500 ? response.status : 503;
      throw new AppError(response?.message || 'Telebirr receipt verification failed', status);
    }
    const referenceNumber = extractReceiptCode(req.body.paymentReceipt) || extractTransactionId(response);
    const amount = extractAmount(response);
    if (!referenceNumber) throw new AppError('Verified receipt has no reference number', 400);
    if (amount == null || amount < expectedDeposit) {
      throw new AppError(`Booking requires a ${expectedDeposit.toFixed(2)} Birr deposit`, 400);
    }
    const used = await prisma.payment.findFirst({ where: { referenceNumber } });
    if (used) throw new AppError('This payment reference has already been used', 409);
    verifiedPayment = { amount, reference: referenceNumber, method: 'TELEBIRR' };
  }

  const appointment = await prisma.$transaction(async (tx) => {
    if (chapaIntent) {
      const consumed = await tx.chapaPaymentIntent.updateMany({
        where: { id: chapaIntent.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { status: 'CONSUMED', providerReference: verifiedPayment.reference, consumedAt: new Date() },
      });
      if (consumed.count !== 1) throw new AppError('This Chapa payment has already been used', 409);
    }
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
    const created = await createScheduledAppointment(tx, business.id, {
      customerId: customer.id,
      serviceId: req.body.serviceId,
      appointmentDate: req.body.appointmentDate,
      startTime: req.body.startTime,
      endTime: req.body.endTime,
      notes: req.body.notes,
      status: 'REQUESTED',
      requesterDeviceId: requesterDevice?.id,
    }, { source: 'CUSTOMER_APP' });
    if (verifiedPayment) {
      await tx.payment.create({ data: {
        businessId: business.id,
        customerId: customer.id,
        appointmentId: created.id,
        serviceId: selectedService.id,
        amount: verifiedPayment.amount,
        paymentMethod: verifiedPayment.method,
        paymentStatus: 'PAID',
        referenceNumber: verifiedPayment.reference,
        notes: verifiedPayment.method === 'CHAPA'
          ? '15% customer booking deposit paid with Chapa'
          : '15% customer booking deposit',
        paidAt: new Date(),
      } });
      await tx.customer.update({
        where: { id: customer.id },
        data: { totalSpending: { increment: verifiedPayment.amount } },
      });
    }
    return created;
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
