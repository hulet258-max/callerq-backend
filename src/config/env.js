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
};
