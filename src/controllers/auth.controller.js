import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getAuth } from 'firebase-admin/auth';
import { prisma } from '../database/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';
import { ok } from '../utils/response.js';
import { templateRows } from '../services/template.service.js';
import { firebaseAdminApp } from '../services/firebase-admin.service.js';

const publicUser = (user) => ({ id: user.id, fullName: user.fullName, phone: user.phone, email: user.email, role: user.role, business: user.business || null });
const signToken = (user) => jwt.sign({ role: user.role }, env.jwtSecret, { subject: user.id, expiresIn: env.jwtExpiresIn });

export async function register(req, res) {
  const { password, businessName, businessType = 'BARBER_SHOP', city, ...userData } = req.body;
  const existing = await prisma.user.findFirst({ where: { OR: [{ phone: userData.phone }, ...(userData.email ? [{ email: userData.email }] : [])] } });
  if (existing) throw new AppError('Phone or email is already registered', 409);

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({ data: { ...userData, passwordHash } });
    if (businessName) {
      const business = await tx.business.create({ data: { ownerId: created.id, name: businessName, type: businessType, phone: created.phone, city } });
      await tx.messageTemplate.createMany({ data: templateRows(business.id) });
    }
    return tx.user.findUnique({ where: { id: created.id }, include: { business: true } });
  });

  return ok(res, { token: signToken(user), user: publicUser(user) }, 'Registration successful', 201);
}

export async function login(req, res) {
  const user = await prisma.user.findUnique({ where: { phone: req.body.phone }, include: { business: true } });
  if (!user || !user.isActive || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
    throw new AppError('Invalid phone or password', 401);
  }
  return ok(res, { token: signToken(user), user: publicUser(user) }, 'Login successful');
}

export async function googleLogin(req, res) {
  const app = firebaseAdminApp();
  if (!app) throw new AppError('Google sign-in is not configured on the server', 503);

  let identity;
  try {
    identity = await getAuth(app).verifyIdToken(req.body.idToken);
  } catch {
    throw new AppError('Invalid or expired Google sign-in', 401);
  }

  const email = identity.email?.trim();
  if (!email || identity.email_verified !== true) {
    throw new AppError('Google must provide a verified email address', 401);
  }

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    include: { business: true },
  });
  if (!user || !user.isActive) {
    throw new AppError('No active CallerQ business account uses this Google email', 404);
  }

  return ok(res, { token: signToken(user), user: publicUser(user) }, 'Google login successful');
}

export async function me(req, res) {
  return ok(res, { user: publicUser(req.user) });
}
