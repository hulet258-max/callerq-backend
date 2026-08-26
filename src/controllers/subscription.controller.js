import { prisma } from '../database/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';
import { ok } from '../utils/response.js';
import { extractAmount, extractReceiptCode, extractTransactionId, verifyPayment } from '../services/deposit.js';

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
  const used = await prisma.subscriptionPayment.findUnique({ where: { transactionId } });
  if (used) throw new AppError('This transaction has already been used', 409);

  const current = await prisma.business.findUnique({ where: { id: req.businessId } });
  const now = new Date();
  const startsAt = activeSubscription(current) ? current.subscriptionExpiresAt : now;
  const expiresAt = addMonths(startsAt, plan.months);
  await prisma.$transaction([
    prisma.subscriptionPayment.create({ data: {
      businessId: req.businessId,
      interval: plan.interval,
      amount,
      transactionId,
      receiptCode,
      receiptInput,
      startsAt,
      expiresAt,
    } }),
    prisma.business.update({
      where: { id: req.businessId },
      data: {
        subscriptionStatus: 'ACTIVE',
        subscriptionInterval: plan.interval,
        subscriptionExpiresAt: expiresAt,
      },
    }),
  ]);
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { business: true } });
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
