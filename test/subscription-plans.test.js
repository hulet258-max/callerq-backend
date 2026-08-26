import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'test-secret-that-is-long-enough';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@localhost:5432/callerq?schema=public';

const { buildSubscriptionPlans } = await import('../src/controllers/subscription.controller.js');
const { subscriptionPaymentSchema } = await import('../src/validators/index.js');

test('subscription plans apply the configured term discounts', () => {
  const plans = buildSubscriptionPlans(150);
  assert.deepEqual(
    plans.map(({ interval, amount, discountPercent }) => ({ interval, amount, discountPercent })),
    [
      { interval: 'MONTHLY', amount: 150, discountPercent: 0 },
      { interval: 'THREE_MONTHS', amount: 423, discountPercent: 6 },
      { interval: 'SIX_MONTHS', amount: 810, discountPercent: 10 },
      { interval: 'YEARLY', amount: 1530, discountPercent: 15 },
    ],
  );
});

test('payment validation accepts every offered term', () => {
  for (const interval of ['MONTHLY', 'THREE_MONTHS', 'SIX_MONTHS', 'YEARLY']) {
    assert.equal(subscriptionPaymentSchema.safeParse({
      interval,
      receiptTextOrLink: 'transaction-12345',
    }).success, true);
  }
});
