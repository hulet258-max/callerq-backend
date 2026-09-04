import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';

const API_URL = 'https://api.chapa.co/v1';
const TIMEOUT_MS = 20_000;

export function chapaErrorMessage(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    return value.map(chapaErrorMessage).filter(Boolean).join(', ');
  }
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([field, detail]) => {
        const message = chapaErrorMessage(detail);
        return message ? `${field}: ${message}` : '';
      })
      .filter(Boolean)
      .join('; ');
  }
  return value == null ? '' : String(value);
}

function assertConfigured() {
  if (!env.chapaConfigured) {
    throw new AppError('Chapa is not configured yet. Add CHAPA_SECRET_KEY on the server.', 503);
  }
  if (env.nodeEnv === 'production'
      && (!env.publicBaseUrl.startsWith('https://') || !env.chapaReturnUrl.startsWith('https://'))) {
    throw new AppError('Chapa production URLs must use public HTTPS addresses.', 503);
  }
}

async function chapaRequest(path, options = {}) {
  assertConfigured();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${env.chapaSecretKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.status === 'failed') {
      const detail = chapaErrorMessage(body.message || body.errors || body.data);
      throw new AppError(
        detail ? `Chapa: ${detail}` : 'Chapa could not process this request',
        response.status >= 400 ? response.status : 502,
      );
    }
    return body;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(error?.name === 'AbortError'
      ? 'Chapa took too long to respond. Please try again.'
      : 'Could not connect to Chapa. Please try again.', 503);
  } finally {
    clearTimeout(timeout);
  }
}

export function newChapaReference(prefix) {
  return `callerq-${prefix}-${Date.now()}-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

export async function initializeChapaTransaction({
  amount, txRef, firstName, lastName, email, phoneNumber, title, description,
}) {
  const chapaPhone = phoneNumber
    ? String(phoneNumber).replace(/\s+/g, '').replace(/^\+251/, '0')
    : '';
  const payload = {
    amount: Number(amount).toFixed(2),
    currency: 'ETB',
    tx_ref: txRef,
    return_url: `${env.chapaReturnUrl}${env.chapaReturnUrl.includes('?') ? '&' : '?'}tx_ref=${encodeURIComponent(txRef)}`,
    customization: { title, description },
  };
  if (firstName) payload.first_name = firstName;
  if (lastName) payload.last_name = lastName;
  if (email) payload.email = email;
  if (chapaPhone) payload.phone_number = chapaPhone;
  if (env.publicBaseUrl) payload.callback_url = `${env.publicBaseUrl}/api/v1/public/chapa/callback/${encodeURIComponent(txRef)}`;

  const response = await chapaRequest('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const checkoutUrl = response?.data?.checkout_url;
  if (!checkoutUrl) throw new AppError('Chapa did not return a checkout URL', 502);
  return checkoutUrl;
}

export async function verifyChapaTransaction(txRef) {
  const response = await chapaRequest(`/transaction/verify/${encodeURIComponent(txRef)}`, { method: 'GET' });
  return response?.data || {};
}

export function assertSuccessfulChapaPayment(data, intent) {
  const paidAmount = Number(data.amount);
  if (data.status !== 'success'
      || data.tx_ref !== intent.txRef
      || data.currency !== intent.currency
      || !Number.isFinite(paidAmount)
      || Math.abs(paidAmount - Number(intent.amount)) > 0.009) {
    throw new AppError('Chapa payment is not complete or does not match this order', 402);
  }
  return { amount: paidAmount, reference: String(data.reference || intent.txRef) };
}
