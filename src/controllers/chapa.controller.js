import { prisma } from '../database/prisma.js';
import { AppError } from '../utils/app-error.js';
import { ok } from '../utils/response.js';
import { normalizeEthiopianPhone } from '../utils/phone.js';
import { assertSuccessfulChapaPayment, initializeChapaTransaction, newChapaReference, verifyChapaTransaction } from '../services/chapa.service.js';
import { env } from '../config/env.js';

const publicBusinessWhere = () => ({
  isActive: true,
  isApproved: true,
  isSuspended: false,
  deletedAt: null,
  subscriptionStatus: 'ACTIVE',
  AND: [{ OR: [{ subscriptionExpiresAt: null }, { subscriptionExpiresAt: { gt: new Date() } }] }],
});

export async function initializeBooking(req, res) {
  const normalizedPhone = normalizeEthiopianPhone(req.body.customerPhone);
  const [business, service] = await Promise.all([
    prisma.business.findFirst({
      where: { id: req.body.businessId, ...publicBusinessWhere() },
      select: { id: true, name: true, phone: true, owner: { select: { phone: true } } },
    }),
    prisma.service.findFirst({
      where: { id: req.body.serviceId, businessId: req.body.businessId, isActive: true },
      select: { id: true, name: true, price: true },
    }),
  ]);
  if (!business || !service) throw new AppError('Business or service is unavailable', 404);
  if ([business.phone, business.owner.phone].some((phone) => {
    try { return normalizeEthiopianPhone(phone) === normalizedPhone; } catch { return false; }
  })) throw new AppError('You cannot book your own business', 409);

  const amount = Math.round(Number(service.price) * 15) / 100;
  const [firstName, ...lastParts] = req.body.customerName.trim().split(/\s+/);
  const txRef = newChapaReference('booking');
  const checkoutUrl = await initializeChapaTransaction({
    amount, txRef, firstName, lastName: lastParts.join(' '),
    phoneNumber: normalizedPhone,
    title: `Booking at ${business.name}`,
    description: `15% deposit for ${service.name}`,
  });
  await prisma.chapaPaymentIntent.create({ data: {
    txRef, purpose: 'BOOKING', businessId: business.id, serviceId: service.id,
    customerName: req.body.customerName.trim(), normalizedPhone, amount,
    checkoutUrl, expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  } });
  return ok(res, { txRef, checkoutUrl, returnUrl: env.chapaReturnUrl, amount, currency: 'ETB' });
}

export async function callback(req, res) {
  const intent = await prisma.chapaPaymentIntent.findUnique({ where: { txRef: req.params.txRef } });
  if (!intent) throw new AppError('Payment session not found', 404);
  try {
    const verified = assertSuccessfulChapaPayment(await verifyChapaTransaction(intent.txRef), intent);
    if (intent.status !== 'CONSUMED') {
      await prisma.chapaPaymentIntent.update({
        where: { id: intent.id },
        data: { status: 'PAID', providerReference: verified.reference },
      });
    }
    return ok(res, { txRef: intent.txRef, status: 'PAID' });
  } catch (error) {
    if (intent.status === 'PENDING') {
      await prisma.chapaPaymentIntent.update({ where: { id: intent.id }, data: { status: 'FAILED' } });
    }
    throw error;
  }
}

export function returnPage(_req, res) {
  res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payment complete</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 20px;color:#172033">
<h1>Payment received</h1><p>You can return to Suppercall. Your payment is being verified securely.</p>
</body></html>`);
}
