import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'test-secret-that-is-long-enough';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@localhost:5432/callerq?schema=public';

const {
  extractAmount,
  extractReceiptCode,
  extractTransactionId,
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
