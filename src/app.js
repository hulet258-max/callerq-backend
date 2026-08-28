import http from 'node:http';
import { Server } from 'socket.io';
import { app } from './server.js';
import { env } from './config/env.js';
import { prisma } from './database/prisma.js';
import { configureSockets } from './sockets/index.js';
import { ensureUploadDirectory } from './controllers/service-images.controller.js';
import { runAppointmentJobs } from './services/appointment-jobs.service.js';
import { runCustomerReminderJobs } from './services/customer-reminder-jobs.service.js';

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: env.clientUrl === '*' ? true : env.clientUrl.split(',').map((value) => value.trim()), credentials: true },
});

app.set('io', io);
configureSockets(io);
await ensureUploadDirectory();
void runAppointmentJobs(io).catch((error) => console.error('Appointment jobs failed:', error.message));
setInterval(() => void runAppointmentJobs(io).catch((error) => console.error('Appointment jobs failed:', error.message)), 60_000).unref();
void runCustomerReminderJobs().catch((error) => console.error('Customer reminder jobs failed:', error.message));
setInterval(() => void runCustomerReminderJobs().catch((error) => console.error('Customer reminder jobs failed:', error.message)), 15 * 60_000).unref();

server.listen(env.port, env.host, () => {
  console.log(`ምኞት API listening on http://${env.host}:${env.port}`);
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  io.close();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
