import jwt from 'jsonwebtoken';
import { prisma } from '../database/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';
import { asyncHandler } from '../utils/async-handler.js';

export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new AppError('Authentication required', 401);

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw new AppError('Invalid or expired token', 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: {
      business: {
        select: {
          id: true,
          name: true,
          subscriptionStatus: true,
          subscriptionInterval: true,
          subscriptionExpiresAt: true,
        },
      },
    },
  });
  if (!user || !user.isActive) throw new AppError('User account is unavailable', 401);

  req.user = user;
  req.businessId = user.business?.id || null;
  next();
});

export const requireBusiness = (req, _res, next) => {
  if (!req.businessId) return next(new AppError('Create a business profile first', 409));
  next();
};

export const requireActiveSubscription = (req, _res, next) => {
  const business = req.user.business;
  const graceDays = business?.subscriptionInterval === 'YEARLY' ? 10 : 5;
  const accessEndsAt = business?.subscriptionExpiresAt instanceof Date
    ? new Date(business.subscriptionExpiresAt.getTime() + graceDays * 24 * 60 * 60 * 1000)
    : null;
  const active = business?.subscriptionStatus === 'ACTIVE'
    && (accessEndsAt == null || accessEndsAt > new Date());
  if (!active) return next(new AppError('An active business subscription is required', 402));
  next();
};

export const allowRoles = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) return next(new AppError('Forbidden', 403));
  next();
};
