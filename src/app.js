import http from 'node:http';
import { Server } from 'socket.io';
import { app } from './server.js';
import { env } from './config/env.js';
import { prisma } from './database/prisma.js';
import { configureSockets } from './sockets/index.js';

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: env.clientUrl === '*' ? true : env.clientUrl.split(',').map((value) => value.trim()), credentials: true },
});

app.set('io', io);
configureSockets(io);

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
