import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'test-secret-that-is-long-enough';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@localhost:5432/callerq?schema=public';

const { requireActiveSubscription } = await import('../src/middleware/auth.js');

function accessError(interval, expiredDaysAgo) {
  let error;
  requireActiveSubscription({
    user: {
      business: {
        subscriptionStatus: 'ACTIVE',
        subscriptionInterval: interval,
        subscriptionExpiresAt: new Date(
          Date.now() - expiredDaysAgo * 24 * 60 * 60 * 1000,
        ),
      },
    },
  }, {}, (value) => {
    error = value;
  });
  return error;
}

test('subscription middleware allows monthly access for five grace days', () => {
  assert.equal(accessError('MONTHLY', 4), undefined);
  assert.equal(accessError('MONTHLY', 6)?.statusCode, 402);
});

test('subscription middleware allows yearly access for ten grace days', () => {
  assert.equal(accessError('YEARLY', 9), undefined);
  assert.equal(accessError('YEARLY', 11)?.statusCode, 402);
});
