import { z } from 'zod';

const phone = z.string().trim().min(7).max(20);
const uuid = z.string().uuid();
const money = z.coerce.number().nonnegative();

export const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  phone,
  email: z.string().email().optional().nullable(),
  password: z.string().min(6).max(100),
  businessName: z.string().trim().min(2).max(120).optional(),
  businessType: z.enum(['BARBER_SHOP', 'WOMENS_SALON', 'UNISEX_SALON', 'BEAUTY_SPA', 'OTHER']).optional(),
  city: z.string().trim().max(100).optional(),
  address: z.string().trim().max(200).optional().nullable(),
  openingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().nullable(),
  closingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().nullable(),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  services: z.array(z.object({
    name: z.string().trim().min(2).max(100),
    category: z.enum(['HAIR', 'BEARD', 'MAKEUP', 'NAILS', 'FACIAL', 'SPA', 'OTHER']).default('OTHER'),
    price: money,
    durationMinutes: z.coerce.number().int().positive().max(1440),
  })).max(20).optional(),
});

export const loginSchema = z.object({ phone, password: z.string().min(1) });
export const subscriptionPaymentSchema = z.object({
  interval: z.enum(['MONTHLY', 'THREE_MONTHS', 'SIX_MONTHS', 'YEARLY']),
  receiptTextOrLink: z.string().trim().min(10).max(2000),
}).strict();
export const googleLoginSchema = z.object({ idToken: z.string().trim().min(100).max(10000) }).strict();
export const googleRegisterSchema = registerSchema.omit({ password: true, email: true }).extend({
  idToken: z.string().trim().min(100).max(10000),
}).strict();

export const businessSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(['BARBER_SHOP', 'WOMENS_SALON', 'UNISEX_SALON', 'BEAUTY_SPA', 'OTHER']),
  phone,
  city: z.string().trim().max(100).optional().nullable(),
  address: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().max(1000).optional().nullable(),
  openingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().nullable(),
  closingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().nullable(),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  socialLinks: z.object({
    instagram: z.string().url().optional().nullable(),
    facebook: z.string().url().optional().nullable(),
    tiktok: z.string().url().optional().nullable(),
    telegram: z.string().url().optional().nullable(),
    whatsapp: z.string().url().optional().nullable(),
    website: z.string().url().optional().nullable(),
  }).optional().nullable(),
  isOpen: z.boolean().optional(),
});

export const customerSchema = z.object({
  fullName: z.string().trim().min(2).max(100), phone,
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  favoriteServiceId: uuid.optional().nullable(),
    vip: z.boolean().optional(),
    serviceIntervalDays: z.number().int().min(1).max(730).optional().nullable(),
  });

export const customerNoteSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  priority: z.enum(['INFO', 'IMPORTANT', 'DANGER']).default('INFO'),
  icon: z.enum(['NOTE', 'CALL', 'PAYMENT', 'SERVICE', 'WARNING', 'FOLLOW_UP']).default('NOTE'),
}).strict();

export const contactImportSchema = z.object({
  contacts: z.array(z.object({
    fullName: z.string().trim().min(1).max(100),
    phone,
  }).strict()).min(1).max(500),
}).strict();

export const serviceSchema = z.object({
  name: z.string().trim().min(2).max(100),
  category: z.enum(['HAIR', 'BEARD', 'MAKEUP', 'NAILS', 'FACIAL', 'SPA', 'OTHER']).default('OTHER'),
  description: z.string().trim().max(1000).optional().nullable(),
  price: money,
  durationMinutes: z.coerce.number().int().positive().max(1440),
  isActive: z.boolean().optional(),
});

export const queueSchema = z.object({
  customerId: uuid, serviceId: uuid,
  source: z.enum(['SIMULATED_CALL', 'MANUAL_ADD', 'APPOINTMENT', 'WALK_IN']).optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const appointmentSchema = z.object({
  customerId: uuid, serviceId: uuid,
  appointmentDate: z.string().date(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  status: z.enum(['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'ADDED_TO_QUEUE', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED']).optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const publicAppointmentSchema = z.object({
  businessId: uuid,
  customerName: z.string().trim().min(2).max(100),
  customerPhone: phone,
  serviceId: uuid,
  appointmentDate: z.string().date(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
  installationId: z.string().uuid().optional(),
}).strict();

export const pushDeviceSchema = z.object({
  installationId: z.string().uuid(),
  fcmToken: z.string().trim().min(20).max(4096),
  platform: z.enum(['ANDROID', 'IOS']).default('ANDROID'),
}).strict();

export const appointmentResponseSchema = z.object({
  action: z.enum(['ACCEPT', 'ADD_TO_QUEUE', 'DECLINE']),
  reason: z.enum([
    'REQUESTED_TIME_UNAVAILABLE',
    'BARBER_UNAVAILABLE',
    'FULLY_BOOKED',
    'SHOP_CLOSED',
    'OTHER',
  ]).optional(),
  note: z.string().trim().max(300).optional().nullable(),
}).superRefine((value, context) => {
  if (value.action === 'DECLINE' && !value.reason) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'Decline reason is required' });
  }
  if (value.action !== 'DECLINE' && value.reason) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'Reason is only valid when declining' });
  }
});

export const templateSchema = z.object({
  type: z.enum(['QUEUE_CONFIRMATION', 'NEXT_CUSTOMER', 'DELAY', 'APPOINTMENT_REMINDER', 'CANCELLATION', 'THANK_YOU', 'PROMOTION']),
  title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(2000), isActive: z.boolean().optional(),
});

export const notificationSchema = z.object({
  customerId: uuid.optional().nullable(), queueEntryId: uuid.optional().nullable(), appointmentId: uuid.optional().nullable(),
    type: z.enum(['QUEUE', 'APPOINTMENT', 'CUSTOMER_REMINDER', 'PAYMENT', 'PROMOTION', 'GENERAL']).optional(),
  channel: z.enum(['SMS', 'WHATSAPP', 'TELEGRAM', 'MANUAL_CALL', 'APP']).optional(),
  title: z.string().trim().min(1).max(120), message: z.string().trim().min(1).max(2000),
  status: z.enum(['PENDING', 'SENT', 'FAILED']).optional(),
});

export const paymentSchema = z.object({
  customerId: uuid, queueEntryId: uuid.optional().nullable(), appointmentId: uuid.optional().nullable(),
  serviceId: uuid.optional().nullable(), amount: money,
  paymentMethod: z.enum(['CASH', 'TELEBIRR', 'BANK', 'OTHER']),
  paymentStatus: z.enum(['PENDING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED']).optional(),
  referenceNumber: z.string().trim().max(120).optional().nullable(), notes: z.string().trim().max(1000).optional().nullable(),
});

export const reviewSchema = z.object({
  appointmentId: uuid,
  installationId: z.string().uuid(),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional().nullable(),
}).strict();

export const partial = (schema) => schema.partial();
