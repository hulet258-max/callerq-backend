import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'test-secret-that-is-long-enough';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@localhost:5432/callerq?schema=public';
process.env.CHAPA_SECRET_KEY = 'CHASECK_TEST-unit-test-key';
process.env.CHAPA_RETURN_URL = 'https://callerq.app/payment-complete';

const {
  assertSuccessfulChapaPayment,
  chapaCustomerEmail,
  chapaErrorMessage,
  chapaPhoneNumber,
  initializeChapaTransaction,
  newChapaReference,
  verifyChapaTransaction,
} = await import('../src/services/chapa.service.js');

test('Chapa transaction references stay within the 50 character limit', () => {
  for (const prefix of ['booking', 'subscription']) {
    const txRef = newChapaReference(prefix);
    assert.ok(txRef.length <= 50, `${prefix} tx_ref is ${txRef.length} chars`);
    assert.match(txRef, /^cq-[a-z0-9]+-[a-f0-9]+$/);
  }
});

test('Chapa phone and email helpers match checkout requirements', () => {
  assert.equal(chapaPhoneNumber('+251911234567'), '0911234567');
  assert.equal(chapaPhoneNumber('911234567'), '0911234567');
  assert.equal(chapaCustomerEmail('', '+251911234567'), 'c911234567@pay.suppercall.app');
  assert.equal(chapaCustomerEmail('owner@example.com', '+251911234567'), 'owner@example.com');
});

test('Chapa validation objects become readable field messages', () => {
  assert.equal(
    chapaErrorMessage({ email: ['The email must be valid.'], amount: ['The amount is required.'] }),
    'email: The email must be valid.; amount: The amount is required.',
  );
});

test('Chapa initialization keeps the secret server-side and sends an in-app return URL', async (t) => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({
      status: 'success', data: { checkout_url: 'https://checkout.chapa.co/test' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  t.after(() => { global.fetch = originalFetch; });

  const checkoutUrl = await initializeChapaTransaction({
    amount: 150, txRef: 'cq-sub-testref', firstName: 'Test',
    phoneNumber: '+251911234567',
    title: 'Suppercall subscription',
    description: '15% deposit for a very long service name that would exceed Chapa limits',
  });
  assert.equal(checkoutUrl, 'https://checkout.chapa.co/test');
  assert.equal(request.url, 'https://api.chapa.co/v1/transaction/initialize');
  assert.equal(request.options.headers.Authorization, 'Bearer CHASECK_TEST-unit-test-key');
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.amount, '150.00');
  assert.equal(payload.phone_number, '0911234567');
  assert.equal(payload.email, 'c911234567@pay.suppercall.app');
  assert.equal(payload.first_name, 'Test');
  assert.ok(payload.tx_ref.length <= 50);
  assert.ok(payload.customization.title.length <= 16);
  assert.equal(payload.customization.title, 'Suppercall subsc');
  assert.ok(payload.customization.description.length <= 50);
  assert.match(payload.return_url, /^https:\/\/callerq\.app\/payment-complete\?tx_ref=/);
});

test('Chapa verification rejects mismatched amounts and accepts an exact successful payment', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ status: 'success', data: {
    status: 'success', tx_ref: 'callerq-booking-test', amount: 30, currency: 'ETB', reference: 'chapa-ref-1',
  } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  t.after(() => { global.fetch = originalFetch; });

  const data = await verifyChapaTransaction('callerq-booking-test');
  const intent = { txRef: 'callerq-booking-test', amount: 30, currency: 'ETB' };
  assert.deepEqual(assertSuccessfulChapaPayment(data, intent), { amount: 30, reference: 'chapa-ref-1' });
  assert.throws(() => assertSuccessfulChapaPayment(data, { ...intent, amount: 31 }), /does not match/);
});
