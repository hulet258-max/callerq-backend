import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getAuth } from 'firebase-admin/auth';
import { prisma } from '../database/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';
import { ok } from '../utils/response.js';
import { templateRows } from '../services/template.service.js';
import { firebaseAdminApp } from '../services/firebase-admin.service.js';
import { normalizeEthiopianPhone } from '../utils/phone.js';

const publicUser = (user) => ({ id: user.id, fullName: user.fullName, phone: user.phone, email: user.email, role: user.role, business: user.business || null });
const signToken = (user) => jwt.sign({ role: user.role }, env.jwtSecret, { subject: user.id, expiresIn: env.jwtExpiresIn });

export async function register(req, res) {
  const {
    password, businessName, businessType = 'BARBER_SHOP', city, address,
    openingTime, closingTime, latitude, longitude, services = [], ...userData
  } = req.body;
  const phone = normalizeEthiopianPhone(userData.phone);
  const existing = await prisma.user.findFirst({ where: { OR: [{ phone }, { phone: userData.phone }, ...(userData.email ? [{ email: { equals: userData.email, mode: 'insensitive' } }] : [])] } });
  if (existing) throw new AppError('Phone or email is already registered', 409);

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({ data: { ...userData, phone, passwordHash } });
    if (businessName) {
      const business = await tx.business.create({ data: {
        ownerId: created.id, name: businessName, type: businessType, phone: created.phone,
        city, address, openingTime, closingTime, latitude, longitude,
      } });
      await tx.messageTemplate.createMany({ data: templateRows(business.id) });
      if (services.length) await tx.service.createMany({ data: services.map((service) => ({ ...service, businessId: business.id })) });
    }
    return tx.user.findUnique({ where: { id: created.id }, include: { business: true } });
  });

  return ok(res, { token: signToken(user), user: publicUser(user) }, 'Registration successful', 201);
}

export async function login(req, res) {
  const user = await prisma.user.findFirst({ where: { OR: [{ phone: normalizeEthiopianPhone(req.body.phone) }, { phone: req.body.phone }] }, include: { business: true } });
  if (!user || !user.isActive || !user.passwordHash || !(await bcrypt.compare(req.body.password, user.passwordHash))) {
    throw new AppError('Invalid phone or password', 401);
  }
  return ok(res, { token: signToken(user), user: publicUser(user) }, 'Login successful');
}

export async function googleLogin(req, res) {
  const identity = await verifiedGoogleIdentity(req.body.idToken);
  const email = identity.email.trim();

  const user = await prisma.user.findFirst({
    where: { OR: [{ googleUid: identity.uid }, { email: { equals: email, mode: 'insensitive' } }] },
    include: { business: true },
  });
  if (!user || !user.isActive) {
    throw new AppError('No active CallerQ business account uses this Google email', 404);
  }

  if (!user.googleUid) await prisma.user.update({ where: { id: user.id }, data: { googleUid: identity.uid } });
  return ok(res, { token: signToken(user), user: publicUser(user) }, 'Google login successful');
}

async function verifiedGoogleIdentity(idToken) {
  const app = firebaseAdminApp();
  if (!app) throw new AppError('Google sign-in is not configured on the server', 503);
  let identity;
  try {
    identity = await getAuth(app).verifyIdToken(idToken);
  } catch {
    throw new AppError('Invalid or expired Google sign-in', 401);
  }
  const email = identity.email?.trim();
  if (!email || identity.email_verified !== true) throw new AppError('Google must provide a verified email address', 401);
  return { ...identity, email };
}

export async function googleRegister(req, res) {
  const identity = await verifiedGoogleIdentity(req.body.idToken);
  const phone = normalizeEthiopianPhone(req.body.phone);
  const existing = await prisma.user.findFirst({
    where: { OR: [{ googleUid: identity.uid }, { phone }, { email: { equals: identity.email, mode: 'insensitive' } }] },
  });
  if (existing) throw new AppError('Google account, phone, or email is already registered', 409);
  const { idToken, businessName, businessType = 'BARBER_SHOP', city, address, openingTime, closingTime, latitude, longitude, services = [], ...owner } = req.body;
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({ data: {
      fullName: owner.fullName || identity.name || identity.email.split('@')[0],
      phone, email: identity.email, googleUid: identity.uid,
    } });
    const business = await tx.business.create({ data: {
      ownerId: created.id, name: businessName, type: businessType, phone,
      city, address, openingTime, closingTime, latitude, longitude,
    } });
    await tx.messageTemplate.createMany({ data: templateRows(business.id) });
    if (services.length) await tx.service.createMany({ data: services.map((service) => ({ ...service, businessId: business.id })) });
    return tx.user.findUnique({ where: { id: created.id }, include: { business: true } });
  });
  return ok(res, { token: signToken(user), user: publicUser(user) }, 'Google registration successful', 201);
}

export async function me(req, res) {
  return ok(res, { user: publicUser(req.user) });
}
