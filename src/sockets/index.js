import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../database/prisma.js';

export function configureSockets(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const payload = jwt.verify(token, env.jwtSecret);
      const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: { business: true } });
      if (!user || !user.business) return next(new Error('Unauthorized'));
      socket.data.userId = user.id;
      socket.data.businessId = user.business.id;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('join_business', (businessId) => {
      if (businessId === socket.data.businessId) socket.join(`business:${businessId}`);
    });
    socket.on('leave_business', (businessId) => socket.leave(`business:${businessId}`));
  });
}

export function emitBusiness(io, businessId, event, data) {
  io.to(`business:${businessId}`).emit(event, { businessId, event, data });
}
