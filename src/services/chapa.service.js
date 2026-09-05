import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';

const API_URL = 'https://api.chapa.co/v1';
const TIMEOUT_MS = 20_000;
const TX_REF_MAX = 50;
const TITLE_MAX = 16;
const DESCRIPTION_MAX = 50;

function clampChapaText(value, max, fallback = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length <= max ? text : text.slice(0, max).trim();
}

export function chapaPhoneNumber(phoneNumber) {
  if (!phoneNumber) return '';
  let digits = String(phoneNumber).replace(/\D/g, '');
  if (digits.startsWith('251') && digits.length >= 12) digits = `0${digits.slice(3)}`;
  else if (/^[79]\d{8}$/.test(digits)) digits = `0${digits}`;
  return /^0[79]\d{8}$/.test(digits) ? digits : '';
}

export function chapaCustomerEmail(email, phoneNumber) {
  const value = String(email || '').trim();
  if (value.includes('@') && value.length <= 100) return value;
  const local = (chapaPhoneNumber(phoneNumber).slice(-9) || 'guest').replace(/\D/g, '') || 'guest';
  return `c${local}@pay.suppercall.app`;
}

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
  const tag = String(prefix || 'pay').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'pay';
  return `cq-${tag}-${randomUUID().replaceAll('-', '')}`.slice(0, TX_REF_MAX);
}

export async function initializeChapaTransaction({
  amount, txRef, firstName, lastName, email, phoneNumber, title, description,
}) {
  const chapaPhone = chapaPhoneNumber(phoneNumber);
  const safeTxRef = String(txRef || '').trim();
  if (!safeTxRef || safeTxRef.length > TX_REF_MAX) {
    throw new AppError('Chapa tx_ref must be at most 50 characters', 400);
  }
  const payload = {
    amount: Number(amount).toFixed(2),
    currency: 'ETB',
    email: chapaCustomerEmail(email, phoneNumber),
    first_name: clampChapaText(firstName, 50, 'Customer'),
    tx_ref: safeTxRef,
    return_url: `${env.chapaReturnUrl}${env.chapaReturnUrl.includes('?') ? '&' : '?'}tx_ref=${encodeURIComponent(safeTxRef)}`,
    customization: {
      title: clampChapaText(title, TITLE_MAX, 'Suppercall'),
      description: clampChapaText(description, DESCRIPTION_MAX, 'Payment'),
    },
  };
  const last = clampChapaText(lastName, 50);
  if (last) payload.last_name = last;
  if (chapaPhone) payload.phone_number = chapaPhone;
  if (env.publicBaseUrl) payload.callback_url = `${env.publicBaseUrl}/api/v1/public/chapa/callback/${encodeURIComponent(safeTxRef)}`;

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
