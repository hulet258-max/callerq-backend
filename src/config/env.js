import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const backendEnvPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../.env',
);

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || backendEnvPath });

const required = ['JWT_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

if (!process.env.DATABASE_URL) {
  const pgRequired = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];
  for (const key of pgRequired) {
    if (!process.env[key]) {
      throw new Error(`Missing required PostgreSQL environment variable: ${key}`);
    }
  }

  const user = encodeURIComponent(process.env.PGUSER);
  const password = encodeURIComponent(process.env.PGPASSWORD);
  const database = encodeURIComponent(process.env.PGDATABASE);
  process.env.DATABASE_URL = `postgresql://${user}:${password}@${process.env.PGHOST}:${process.env.PGPORT}/${database}?schema=public`;
}

const publicBaseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const chapaReturnUrl = process.env.CHAPA_RETURN_URL
  || (publicBaseUrl.startsWith('https://')
    ? `${publicBaseUrl}/api/v1/public/chapa/return`
    : 'https://callerq-callerq-backend.v3rao3.easypanel.host/api/v1/public/chapa/return');

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 8000),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  clientUrl: process.env.CLIENT_URL || '*',
  firebaseServiceAccountBase64: process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 || '',
  firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '',
  uploadDir: path.resolve(process.env.UPLOAD_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads')),
  publicBaseUrl,
  subscriptionMonthlyBirr: Number(process.env.SUBSCRIPTION_MONTHLY_BIRR || 150),
  subscriptionPaymentInstructions: process.env.SUBSCRIPTION_PAYMENT_INSTRUCTIONS || 'Pay with Telebirr, then paste the receipt link or transaction number.',
  chapaSecretKey: process.env.CHAPA_SECRET_KEY || 'CHASECK_TEST-PLACEHOLDER',
  chapaReturnUrl,
  chapaConfigured: Boolean(process.env.CHAPA_SECRET_KEY)
    && !process.env.CHAPA_SECRET_KEY.includes('PLACEHOLDER')
    && !process.env.CHAPA_SECRET_KEY.includes('REPLACE_WITH'),
};
