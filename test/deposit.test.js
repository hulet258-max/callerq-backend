import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'test-secret-that-is-long-enough';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@localhost:5432/callerq?schema=public';

const {
  extractAmount,
  extractReceiptCode,
  extractTransactionId,
  verifyPayment,
} = await import('../src/services/deposit.js');

test('deposit receipt logic accepts links, codes and verified provider fields', () => {
  assert.equal(
    extractReceiptCode('https://transactioninfo.ethiotelecom.et/receipt/AB12CD34EF'),
    'AB12CD34EF',
  );
  assert.equal(extractReceiptCode('ab12cd34ef'), 'AB12CD34EF');
  assert.equal(extractReceiptCode('not-a-receipt'), null);
  assert.equal(extractTransactionId({ data: { transaction_id: 'TX-42' } }), 'TX-42');
  assert.equal(extractAmount({ receipt: { paidAmount: '500.00' } }), 500);
  assert.equal(extractAmount({ amount: 0 }), null);
});

test('payment verification uses robikcafe payload and retries server errors', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const requests = [];

  t.after(() => {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  });

  console.error = () => {};
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (requests.length === 1) {
      return new Response(JSON.stringify({ message: 'Temporary failure' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ valid: true, amount: 500 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await verifyPayment('receipt-value', 5);

  assert.deepEqual(result, { valid: true, amount: 500 });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://robikcafe.et/verify');
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    userInput: 'receipt-value',
    expectedAmount: 11,
  });
});

test('payment verification returns provider validation errors without retrying', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  let requestCount = 0;

  t.after(() => {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  });

  console.error = () => {};
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({ message: 'Receipt not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await verifyPayment('missing-receipt', 500);

  assert.deepEqual(result, {
    valid: false,
    message: 'Receipt not found',
    status: 404,
  });
  assert.equal(requestCount, 1);
});
