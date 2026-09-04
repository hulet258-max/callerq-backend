import { prisma } from '../database/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';
import { ok } from '../utils/response.js';
import { extractAmount, extractReceiptCode, extractTransactionId, verifyPayment } from '../services/deposit.js';
import { assertSuccessfulChapaPayment, initializeChapaTransaction, newChapaReference, verifyChapaTransaction } from '../services/chapa.service.js';

export const buildSubscriptionPlans = (monthly) => {
  const plan = (interval, label, months, discountPercent) => {
    const originalAmount = monthly * months;
    const amount = Math.round(originalAmount * (1 - discountPercent / 100));
    return {
      interval,
      label,
      amount,
      months,
      discountPercent,
      originalAmount,
      monthlyEquivalent: Math.round((amount / months) * 100) / 100,
    };
  };
  return [
    plan('MONTHLY', 'Monthly', 1, 0),
    plan('THREE_MONTHS', '3 months', 3, 6),
    plan('SIX_MONTHS', '6 months', 6, 10),
    plan('YEARLY', 'Yearly', 12, 15),
  ];
};

const plans = () => buildSubscriptionPlans(env.subscriptionMonthlyBirr);

function activeSubscription(business) {
  return business?.subscriptionStatus === 'ACTIVE'
    && (business.subscriptionExpiresAt == null
      || (business.subscriptionExpiresAt instanceof Date
        && business.subscriptionExpiresAt > new Date()));
}

function addMonths(value, months) {
  const result = new Date(value);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

async function activatePlan({ businessId, userId, plan, amount, transactionId, receiptCode = null, receiptInput }) {
  const used = await prisma.subscriptionPayment.findUnique({ where: { transactionId } });
  if (used) throw new AppError('This transaction has already been used', 409);
  const current = await prisma.business.findUnique({ where: { id: businessId } });
  const now = new Date();
  const startsAt = activeSubscription(current) ? current.subscriptionExpiresAt : now;
  const expiresAt = addMonths(startsAt, plan.months);
  await prisma.$transaction([
    prisma.subscriptionPayment.create({ data: {
      businessId, interval: plan.interval, amount, transactionId, receiptCode,
      receiptInput, startsAt, expiresAt,
    } }),
    prisma.business.update({
      where: { id: businessId },
      data: { subscriptionStatus: 'ACTIVE', subscriptionInterval: plan.interval, subscriptionExpiresAt: expiresAt },
    }),
  ]);
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { business: true } });
  return { user, expiresAt };
}

export async function listPlans(req, res) {
  const business = req.businessId
    ? await prisma.business.findUnique({ where: { id: req.businessId } })
    : null;
  return ok(res, {
    plans: plans(),
    instructions: env.subscriptionPaymentInstructions,
    subscription: business ? {
      status: activeSubscription(business)
        ? 'ACTIVE'
        : business.subscriptionStatus === 'ACTIVE'
          ? 'EXPIRED'
          : business.subscriptionStatus,
      interval: business.subscriptionInterval,
      expiresAt: business.subscriptionExpiresAt,
    } : null,
  });
}

export async function verify(req, res) {
  if (!req.businessId) throw new AppError('Create a business profile first', 409);
  const plan = plans().find((item) => item.interval === req.body.interval);
  if (!plan) throw new AppError('Subscription plan not found', 400);
  const receiptInput = req.body.receiptTextOrLink.trim();
  const serviceResponse = await verifyPayment(receiptInput, plan.amount);
  if (serviceResponse?.valid !== true) {
    const status = serviceResponse?.status >= 400 && serviceResponse.status < 500
      ? serviceResponse.status
      : 503;
    throw new AppError(serviceResponse?.message || 'Receipt verification failed', status);
  }
  const receiptCode = extractReceiptCode(receiptInput);
  const transactionId = receiptCode || extractTransactionId(serviceResponse);
  if (!transactionId) throw new AppError('Verified receipt has no transaction number', 400);
  const amount = extractAmount(serviceResponse);
  if (amount == null || amount < plan.amount) {
    throw new AppError(`This plan requires at least ${plan.amount} Birr`, 400);
  }
  const { user, expiresAt } = await activatePlan({
    businessId: req.businessId, userId: req.user.id, plan, amount, transactionId,
    receiptCode, receiptInput,
  });
  return ok(res, {
    user: {
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      email: user.email,
      role: user.role,
      business: user.business,
    },
    transactionId,
    paidBirr: amount,
    expiresAt,
  }, 'Subscription activated');
}

export async function initializeChapa(req, res) {
  if (!req.businessId) throw new AppError('Create a business profile first', 409);
  const plan = plans().find((item) => item.interval === req.body.interval);
  if (!plan) throw new AppError('Subscription plan not found', 400);
  const [firstName, ...lastParts] = req.user.fullName.trim().split(/\s+/);
  const txRef = newChapaReference('subscription');
  const checkoutUrl = await initializeChapaTransaction({
    amount: plan.amount,
    txRef,
    firstName,
    lastName: lastParts.join(' '),
    email: req.user.email,
    phoneNumber: req.user.phone,
    title: 'Suppercall subscription',
    description: `${plan.label} business plan`,
  });
  await prisma.chapaPaymentIntent.create({ data: {
    txRef, purpose: 'SUBSCRIPTION', businessId: req.businessId,
    ownerUserId: req.user.id, interval: plan.interval, amount: plan.amount,
    checkoutUrl, expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  } });
  return ok(res, { txRef, checkoutUrl, returnUrl: env.chapaReturnUrl, amount: plan.amount, currency: 'ETB' });
}

export async function confirmChapa(req, res) {
  const intent = await prisma.chapaPaymentIntent.findUnique({ where: { txRef: req.body.txRef } });
  if (!intent || intent.purpose !== 'SUBSCRIPTION' || intent.ownerUserId !== req.user.id || intent.businessId !== req.businessId) {
    throw new AppError('Subscription payment was not found', 404);
  }
  if (intent.status === 'CONSUMED') {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { business: true } });
    return ok(res, { user }, 'Subscription already activated');
  }
  if (intent.expiresAt < new Date()) throw new AppError('This payment session expired. Start again.', 410);
  const verified = assertSuccessfulChapaPayment(await verifyChapaTransaction(intent.txRef), intent);
  const plan = plans().find((item) => item.interval === intent.interval);
  if (!plan) throw new AppError('Subscription plan not found', 400);
  const { user, expiresAt } = await activatePlan({
    businessId: req.businessId, userId: req.user.id, plan,
    amount: verified.amount, transactionId: verified.reference, receiptInput: intent.txRef,
  });
  await prisma.chapaPaymentIntent.update({
    where: { id: intent.id },
    data: { status: 'CONSUMED', providerReference: verified.reference, consumedAt: new Date() },
  });
  return ok(res, { user, transactionId: verified.reference, paidBirr: verified.amount, expiresAt }, 'Subscription activated');
}
