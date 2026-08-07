import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { errorHandler, notFound } from './middleware/error.js';

export const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.clientUrl === '*' ? true : env.clientUrl.split(',').map((value) => value.trim()), credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(env.uploadDir, { fallthrough: false, maxAge: '7d' }));

app.get('/health', (_req, res) => res.json({ success: true, message: 'ምኞት API is healthy', data: { timestamp: new Date().toISOString() } }));
app.use('/api/v1', routes);
app.use(notFound);
app.use(errorHandler);
