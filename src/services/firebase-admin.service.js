import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../config/env.js';

let cachedApp;

export function firebaseAdminApp() {
  if (cachedApp !== undefined) return cachedApp;
  if (!env.firebaseServiceAccountBase64 && !env.firebaseServiceAccountPath) {
    cachedApp = null;
    return null;
  }

  try {
    const raw = env.firebaseServiceAccountBase64
      ? Buffer.from(env.firebaseServiceAccountBase64, 'base64').toString('utf8')
      : readFileSync(resolve(env.firebaseServiceAccountPath), 'utf8');
    const credentials = JSON.parse(raw);
    cachedApp = getApps()[0] || initializeApp({ credential: cert(credentials) });
  } catch (error) {
    console.error('Firebase initialization failed:', error.message);
    cachedApp = null;
  }
  return cachedApp;
}
