import { prisma } from '../database/prisma.js';
import { AppError } from '../utils/app-error.js';
import { ok } from '../utils/response.js';
import { normalizeEthiopianPhone } from '../utils/phone.js';
import { createScheduledAppointment } from '../services/appointment.service.js';
import { authorizeCustomerLookup } from '../services/public-booking.service.js';
import { emitBusiness } from '../sockets/index.js';

const publicBusinessWhere = {
  isActive: true,
  isApproved: true,
  isSuspended: false,
  deletedAt: null,
  owner: { isActive: true },
};

const serviceSelect = {
  id: true, name: true, category: true, price: true, durationMinutes: true, isActive: true,
};
const businessSelect = {
  id: true, name: true, type: true, city: true, address: true, phone: true, description: true,
};

function serviceSummary(service) {
  return { ...service, price: Number(service.price) };
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
    services: (business.services || []).map(serviceSummary),
    ...(business.staff ? {
      staff: business.staff.map((staff) => ({
        id: staff.id, fullName: staff.fullName, phone: '', role: staff.role, status: staff.status,
      })),
    } : {}),
  };
}

function appointmentSummary(appointment, detailedBusiness = false) {
  return {
    id: appointment.id,
    appointmentDate: appointment.appointmentDate.toISOString().slice(0, 10),
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    status: appointment.status,
    business: detailedBusiness ? {
      id: appointment.business.id,
      name: appointment.business.name,
      businessName: appointment.business.name,
      city: appointment.business.city || '',
      address: appointment.business.address || '',
    } : { id: appointment.business.id, name: appointment.business.name },
    service: {
      id: appointment.service.id,
      name: appointment.service.name,
      ...(detailedBusiness ? {
        price: Number(appointment.service.price),
        durationMinutes: appointment.service.durationMinutes,
      } : {}),
    },
    staff: appointment.staff ? { id: appointment.staff.id, fullName: appointment.staff.fullName } : null,
  };
}

export async function listBusinesses(req, res) {
  const query = String(req.query.query || '').trim().slice(0, 120);
  const businesses = await prisma.business.findMany({
    where: {
      ...publicBusinessWhere,
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
    where: { id: req.params.id, ...publicBusinessWhere },
    select: {
      ...businessSelect,
      services: { where: { isActive: true }, select: serviceSelect, orderBy: { name: 'asc' } },
      staff: {
        where: { status: { not: 'OFF_DUTY' } },
        select: { id: true, fullName: true, role: true, status: true },
        orderBy: { fullName: 'asc' },
      },
    },
  });
  if (!business) throw new AppError('Business not found', 404);
  return ok(res, { business: businessSummary(business) });
}

export async function createAppointment(req, res) {
  const normalizedPhone = normalizeEthiopianPhone(req.body.customerPhone);
  const business = await prisma.business.findFirst({
    where: { id: req.body.businessId, ...publicBusinessWhere },
    select: { id: true },
  });
  if (!business) throw new AppError('Business not found or unavailable', 404);

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
      staffId: req.body.staffId,
      appointmentDate: req.body.appointmentDate,
      startTime: req.body.startTime,
      endTime: req.body.endTime,
      notes: req.body.notes,
      status: 'SCHEDULED',
    }, { source: 'CUSTOMER_APP' });
  });

  const complete = await prisma.appointment.findUnique({
    where: { id: appointment.id },
    select: {
      id: true, appointmentDate: true, startTime: true, endTime: true, status: true,
      business: { select: { id: true, name: true } },
      service: { select: { id: true, name: true } },
      staff: { select: { id: true, fullName: true } },
    },
  });
  const io = req.app.get('io');
  if (io) emitBusiness(io, business.id, 'appointment_created', { appointment });
  return ok(res, { appointment: appointmentSummary(complete) }, 'Appointment created', 201);
}

export async function listAppointments(req, res) {
  const normalizedPhone = normalizeEthiopianPhone(req.query.phone);
  await authorizeCustomerLookup({ normalizedPhone, req });
  const appointments = await prisma.appointment.findMany({
    where: { customer: { normalizedPhone } },
    include: {
      business: { select: businessSelect },
      service: { select: serviceSelect },
      staff: { select: { id: true, fullName: true } },
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
