import { Router } from 'express';
import { z } from 'zod';
import * as auth from '../controllers/auth.controller.js';
import * as business from '../controllers/business.controller.js';
import * as customers from '../controllers/customers.controller.js';
import { services, staff, updateStaffStatus } from '../controllers/catalog.controller.js';
import * as queue from '../controllers/queue.controller.js';
import * as appointments from '../controllers/appointments.controller.js';
import * as communications from '../controllers/communications.controller.js';
import * as payments from '../controllers/payments.controller.js';
import * as reports from '../controllers/reports.controller.js';
import { authenticate, requireBusiness } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import {
  appointmentSchema, businessSchema, customerSchema, loginSchema, notificationSchema,
  partial, paymentSchema, queueSchema, registerSchema, serviceSchema, staffSchema, templateSchema,
} from '../validators/index.js';

const router = Router();
const a = asyncHandler;
const statusSchema = z.object({ status: z.enum(['WAITING', 'ARRIVED', 'IN_SERVICE', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'SKIPPED']), notes: z.string().max(1000).optional() });
const staffStatusSchema = z.object({ status: z.enum(['AVAILABLE', 'BUSY', 'OFF_DUTY', 'ON_BREAK']) });
const rescheduleSchema = z.object({ appointmentDate: z.string().date().optional(), startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), notes: z.string().max(1000).optional().nullable() });

router.post('/auth/register', validateBody(registerSchema), a(auth.register));
router.post('/auth/login', validateBody(loginSchema), a(auth.login));
router.get('/auth/me', authenticate, a(auth.me));

router.use(authenticate);
router.get('/business/me', a(business.getMine));
router.post('/business', validateBody(businessSchema), a(business.create));
router.patch('/business/:id', requireBusiness, validateBody(partial(businessSchema)), a(business.update));

router.use(requireBusiness);

router.get('/customers/search', a(customers.search));
router.get('/customers/by-phone/:phone', a(customers.byPhone));
router.get('/customers', a(customers.list));
router.post('/customers', validateBody(customerSchema), a(customers.create));
router.get('/customers/:id', a(customers.get));
router.patch('/customers/:id', validateBody(partial(customerSchema)), a(customers.update));
router.delete('/customers/:id', a(customers.remove));

router.get('/services', a(services.list));
router.post('/services', validateBody(serviceSchema), a(services.create));
router.get('/services/:id', a(services.get));
router.patch('/services/:id', validateBody(partial(serviceSchema)), a(services.update));
router.delete('/services/:id', a(services.remove));

router.get('/staff', a(staff.list));
router.post('/staff', validateBody(staffSchema), a(staff.create));
router.get('/staff/:id', a(staff.get));
router.patch('/staff/:id/status', validateBody(staffStatusSchema), a(updateStaffStatus));
router.patch('/staff/:id', validateBody(partial(staffSchema)), a(staff.update));
router.delete('/staff/:id', a(staff.remove));

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

router.get('/appointments', a(appointments.list));
router.post('/appointments', validateBody(appointmentSchema), a(appointments.create));
router.get('/appointments/:id', a(appointments.get));
router.patch('/appointments/:id', validateBody(partial(appointmentSchema)), a(appointments.update));
router.delete('/appointments/:id', a(appointments.cancel));
router.post('/appointments/:id/reschedule', validateBody(rescheduleSchema), a(appointments.reschedule));
router.post('/appointments/:id/add-to-queue', a(appointments.addToQueue));

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
router.get('/reports/staff', a(reports.staff));

export default router;
