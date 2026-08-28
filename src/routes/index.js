import { Router } from 'express';
import { z } from 'zod';
import * as auth from '../controllers/auth.controller.js';
import * as business from '../controllers/business.controller.js';
import * as customers from '../controllers/customers.controller.js';
import { services } from '../controllers/catalog.controller.js';
import * as queue from '../controllers/queue.controller.js';
import * as appointments from '../controllers/appointments.controller.js';
import * as communications from '../controllers/communications.controller.js';
import * as payments from '../controllers/payments.controller.js';
import * as reports from '../controllers/reports.controller.js';
import * as publicApi from '../controllers/public.controller.js';
import * as push from '../controllers/push.controller.js';
import * as reviews from '../controllers/reviews.controller.js';
import * as serviceImages from '../controllers/service-images.controller.js';
import * as callerDirectory from '../controllers/caller-directory.controller.js';
import * as subscription from '../controllers/subscription.controller.js';
import { authenticate, requireActiveSubscription, requireBusiness } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { tryNormalizeEthiopianPhone } from '../utils/phone.js';
import { asyncHandler } from '../utils/async-handler.js';
import {
  appointmentResponseSchema, appointmentSchema, businessSchema, contactImportSchema, customerNoteSchema, customerSchema, googleLoginSchema, googleRegisterSchema, loginSchema, notificationSchema, publicAppointmentSchema, pushDeviceSchema,
  partial, paymentSchema, queueSchema, registerSchema, reviewSchema, serviceSchema, subscriptionPaymentSchema, templateSchema,
} from '../validators/index.js';

const router = Router();
const a = asyncHandler;
const statusSchema = z.object({ status: z.enum(['WAITING', 'ARRIVED', 'IN_SERVICE', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'SKIPPED']), notes: z.string().max(1000).optional() });
const rescheduleSchema = z.object({ appointmentDate: z.string().date().optional(), startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), notes: z.string().max(1000).optional().nullable() });
const callerDirectorySyncSchema = z.object({
  contacts: z.array(z.object({
    displayName: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(7).max(40),
  })).max(5000),
});

router.post('/auth/register', validateBody(registerSchema), a(auth.register));
router.post('/auth/login', validateBody(loginSchema), a(auth.login));
router.post('/auth/google', validateBody(googleLoginSchema), a(auth.googleLogin));
router.post('/auth/google/register', validateBody(googleRegisterSchema), a(auth.googleRegister));
router.get('/auth/me', authenticate, a(auth.me));

router.get('/public/businesses', a(publicApi.listBusinesses));
router.get('/public/businesses/:id', a(publicApi.getBusiness));
router.get('/public/businesses/:id/reviews', a(reviews.listForBusiness));
router.post('/public/reviews', validateBody(reviewSchema, 400), a(reviews.create));
router.post('/public/appointments',
  rateLimit({ max: 10, keys: [
    (req) => `public-booking-ip:${req.ip}`,
    (req) => `public-booking-phone:${tryNormalizeEthiopianPhone(req.body?.customerPhone)}`,
  ] }),
  validateBody(publicAppointmentSchema, 400),
  a(publicApi.createAppointment));
router.get('/public/appointments',
  rateLimit({ max: 20, keys: [
    (req) => `public-lookup-ip:${req.ip}`,
    (req) => `public-lookup-phone:${tryNormalizeEthiopianPhone(req.query?.phone)}`,
  ] }),
  a(publicApi.listAppointments));
router.put('/public/push-device',
  rateLimit({ max: 30, keys: [(req) => `public-push-device:${req.ip}`] }),
  validateBody(pushDeviceSchema, 400),
  a(push.registerPublic));
router.get('/public/appointments/:id/status', a(push.status));

router.use(authenticate);
router.get('/subscription/plans', a(subscription.listPlans));
router.post('/subscription/verify', validateBody(subscriptionPaymentSchema, 400), a(subscription.verify));
router.put('/caller-directory/contacts',
  rateLimit({ max: 10, keys: [(req) => `caller-directory-sync:${req.user.id}`] }),
  validateBody(callerDirectorySyncSchema, 400),
  a(callerDirectory.syncContacts));
router.get('/caller-directory/lookup',
  rateLimit({ max: 240, keys: [(req) => `caller-directory-lookup:${req.user.id}`] }),
  a(callerDirectory.lookup));
router.put('/push-device', validateBody(pushDeviceSchema), a(push.registerOwner));
router.delete('/push-device/:installationId', a(push.unregisterOwner));
router.get('/business/me', a(business.getMine));
router.post('/business', validateBody(businessSchema), a(business.create));
router.patch('/business/:id', requireBusiness, requireActiveSubscription, validateBody(partial(businessSchema)), a(business.update));
router.post('/business/:id/profile-image', requireBusiness, requireActiveSubscription, serviceImages.uploadBusinessProfileImage, a(business.uploadProfileImage));

router.use(requireBusiness);
router.use(requireActiveSubscription);

router.get('/customers/search', a(customers.search));
router.get('/customers/by-phone/:phone', a(customers.byPhone));
router.get('/customers', a(customers.list));
router.post('/customers/import-contacts', validateBody(contactImportSchema), a(customers.importContacts));
router.post('/customers', validateBody(customerSchema), a(customers.create));
router.get('/customers/:id', a(customers.get));
router.patch('/customers/:id', validateBody(partial(customerSchema)), a(customers.update));
router.post('/customers/:id/notes', validateBody(customerNoteSchema), a(customers.addNote));
router.delete('/customers/:id/notes/:noteId', a(customers.removeNote));
router.post('/customers/:id/remind', a(customers.remind));
router.delete('/customers/:id', a(customers.remove));

router.get('/services', a(services.list));
router.post('/services', validateBody(serviceSchema), a(services.create));
router.get('/services/:id', a(services.get));
router.patch('/services/:id', validateBody(partial(serviceSchema)), a(services.update));
router.delete('/services/:id', a(services.remove));
router.post('/services/:id/images', serviceImages.uploadServiceImages, a(serviceImages.create));
router.patch('/services/:id/images/:imageId', a(serviceImages.update));
router.delete('/services/:id/images/:imageId', a(serviceImages.remove));

router.get('/queue/today', a(queue.listToday));
router.get('/queue/summary', a(queue.summary));
router.post('/queue', validateBody(queueSchema), a(queue.create));
router.get('/queue/:id', a(queue.get));
router.patch('/queue/:id/status', validateBody(statusSchema), a(queue.changeStatus));
router.post('/queue/:id/start', a(queue.start));
router.post('/queue/:id/complete', a(queue.complete));
router.post('/queue/:id/cancel', a(queue.cancel));
router.post('/queue/:id/no-show', a(queue.noShow));
router.post('/queue/:id/move-up', a(queue.moveUp));
router.post('/queue/:id/move-down', a(queue.moveDown));
router.post('/queue/:id/notify-next', a(queue.notifyNext));
router.delete('/queue/:id', a(queue.remove));

router.get('/appointments', a(appointments.list));
router.post('/appointments', validateBody(appointmentSchema), a(appointments.create));
router.get('/appointments/:id', a(appointments.get));
router.patch('/appointments/:id', validateBody(partial(appointmentSchema)), a(appointments.update));
router.delete('/appointments/:id', a(appointments.cancel));
router.post('/appointments/:id/reschedule', validateBody(rescheduleSchema), a(appointments.reschedule));
router.post('/appointments/:id/add-to-queue', a(appointments.addToQueue));
router.post('/appointments/:id/respond', validateBody(appointmentResponseSchema), a(appointments.respond));

router.get('/message-templates', a(communications.listTemplates));
router.post('/message-templates', validateBody(templateSchema), a(communications.createTemplate));
router.patch('/message-templates/:id', validateBody(partial(templateSchema)), a(communications.updateTemplate));
router.delete('/message-templates/:id', a(communications.deleteTemplate));
router.post('/message-templates/:id/render', a(communications.previewTemplate));

router.get('/notifications', a(communications.listNotifications));
router.post('/notifications', validateBody(notificationSchema), a(communications.createNotification));
router.post('/notifications/queue/:queueEntryId/notify', a(communications.notifyQueue));
router.patch('/notifications/:id/sent', a(communications.markNotificationSent));

router.get('/payments/summary/today', a(payments.todaySummary));
router.get('/payments', a(payments.list));
router.post('/payments', validateBody(paymentSchema), a(payments.create));
router.get('/payments/:id', a(payments.get));
router.patch('/payments/:id', validateBody(partial(paymentSchema)), a(payments.update));
router.delete('/payments/:id', a(payments.remove));

router.get('/reports/dashboard', a(reports.dashboard));
router.get('/reports/revenue', a(reports.revenue));
router.get('/reports/queue', a(reports.queue));
router.get('/reports/customers', a(reports.customers));

export default router;
