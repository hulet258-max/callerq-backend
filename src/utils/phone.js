import { AppError } from './app-error.js';

/** Normalize Ethiopian mobile numbers to E.164 (+2517/9XXXXXXXX). */
export function normalizeEthiopianPhone(value) {
  const input = String(value ?? '').trim();
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('00251')) digits = digits.slice(2);
  if (/^0[79]\d{8}$/.test(digits)) digits = `251${digits.slice(1)}`;
  else if (/^[79]\d{8}$/.test(digits)) digits = `251${digits}`;
  if (!/^251[79]\d{8}$/.test(digits)) {
    throw new AppError('Enter a valid Ethiopian mobile phone number', 400);
  }
  return `+${digits}`;
}

export function tryNormalizeEthiopianPhone(value) {
  try { return normalizeEthiopianPhone(value); } catch { return String(value ?? '').trim(); }
}
