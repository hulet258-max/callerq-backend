import { env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';

// Adapted from the supplied Deposit.js validation flow. Receipt identity comes
// from verified provider data or a valid Telebirr receipt code, never from an
// arbitrary client-provided transaction field.
export function extractReceiptCode(input) {
  if (!input) return null;
  const value = String(input).trim().toUpperCase();
  const url = value.match(/TRANSACTIONINFO\.ETHIOTELECOM\.ET\/RECEIPT\/([A-Z0-9]+)/);
  if (url) return url[1];
  const amharic = value.match(/ቁጥርዎ\s+([A-Z0-9]+)\s+ነው/);
  if (amharic) return amharic[1];
  return /^[A-Z0-9]{10}$/.test(value) ? value : null;
}

export function extractTransactionId(response) {
  for (const source of [response, response?.data, response?.result, response?.receipt]) {
    if (!source || typeof source !== 'object') continue;
    const value = source.transactionId || source.transaction_id || source.txId
      || source.tx_id || source.trxId || source.trx_id || source.reference || source.receiptId;
    if (value && String(value).trim()) return String(value).trim();
  }
  return null;
}

export function extractAmount(response) {
  for (const source of [response, response?.data, response?.result, response?.receipt]) {
    if (!source || typeof source !== 'object') continue;
    const value = source.amount || source.paidAmount || source.verifiedAmount || source.totalAmount;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

export async function verifyPayment(receiptTextOrLink, expectedAmount) {
  if (!env.paymentVerificationUrl) {
    throw new AppError('Payment verification is not configured', 503);
  }
  let response;
  try {
    response = await fetch(env.paymentVerificationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.paymentVerificationApiKey
          ? { Authorization: `Bearer ${env.paymentVerificationApiKey}` }
          : {}),
      },
      body: JSON.stringify({
        receiptTextOrLink: String(receiptTextOrLink).trim(),
        expectedAmount,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AppError('Payment verification service is unavailable', 503);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new AppError('Payment verification returned an invalid response', 502);
  }
  if (!response.ok || body?.valid !== true) {
    throw new AppError(body?.message || body?.error || 'Receipt verification failed', 400);
  }
  return body;
}
