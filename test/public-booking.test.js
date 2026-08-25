import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET ||= 'test-secret-that-is-long-enough';
process.env.NODE_ENV = 'test';

const enabled = process.env.RUN_DATABASE_TESTS === '1';
const suite = enabled ? test : test.skip;
const { app } = await import('../src/server.js');
const { prisma } = await import('../src/database/prisma.js');

let ownerId;
let otherOwnerId;
let business;
let inactiveBusiness;
let otherBusiness;
let service;
let otherService;

function futureDate(days = 3) {
  const date = new Date(Date.now() + days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

before(async () => {
  if (!enabled) return;
  ownerId = randomUUID();
  otherOwnerId = randomUUID();
  const inactiveOwnerId = randomUUID();
  await prisma.user.createMany({ data: [
    { id: ownerId, fullName: 'Public Test Owner', phone: `test-${ownerId}`, passwordHash: 'unused' },
    { id: otherOwnerId, fullName: 'Other Test Owner', phone: `test-${otherOwnerId}`, passwordHash: 'unused' },
    { id: inactiveOwnerId, fullName: 'Inactive Test Owner', phone: `test-${inactiveOwnerId}`, passwordHash: 'unused' },
  ] });
  business = await prisma.business.create({ data: {
    ownerId, name: 'Clean Cuts Integration', type: 'BARBER_SHOP', phone: '0911000000',
    city: 'Addis Ababa', address: 'Integration Bole', description: 'Public description',
    latitude: 8.9806, longitude: 38.7578,
  } });
  otherBusiness = await prisma.business.create({ data: {
    ownerId: otherOwnerId, name: 'Other Salon Integration', type: 'WOMENS_SALON', phone: '0911000001', city: 'Adama',
  } });
  inactiveBusiness = await prisma.business.create({ data: {
    ownerId: inactiveOwnerId, name: 'Hidden Integration Shop', type: 'BEAUTY_SPA', phone: '0911000002', isActive: false,
  } });
  service = await prisma.service.create({ data: { businessId: business.id, name: 'Haircut Integration', category: 'HAIR', price: 250, durationMinutes: 30 } });
  await prisma.service.create({ data: { businessId: business.id, name: 'Private Inactive Service', price: 1, durationMinutes: 10, isActive: false } });
  otherService = await prisma.service.create({ data: { businessId: otherBusiness.id, name: 'Other Service Integration', price: 100, durationMinutes: 20 } });
});

after(async () => {
  if (!enabled) return;
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherOwnerId, inactiveBusiness.ownerId] } } });
  await prisma.$disconnect();
});

suite('public booking API filters, validates, schedules, normalizes and sanitizes', async () => {
  const catalog = await request(app).get('/api/v1/public/businesses?query=integration%20bOlE').expect(200);
  assert.equal(catalog.body.data.businesses.length, 1);
  assert.equal(catalog.body.data.businesses[0].id, business.id);
  assert.equal(catalog.body.data.businesses[0].businessName, business.name);
  assert.equal(catalog.body.data.businesses[0].services.length, 1);
  assert.equal(catalog.body.data.businesses[0].latitude, 8.9806);
  assert.equal(catalog.body.data.businesses[0].longitude, 38.7578);
  assert.equal('ownerId' in catalog.body.data.businesses[0], false);

  const hidden = await request(app).get('/api/v1/public/businesses?query=Hidden%20Integration').expect(200);
  assert.deepEqual(hidden.body.data.businesses, []);
  await prisma.business.update({ where: { id: inactiveBusiness.id }, data: { isActive: true, isApproved: false } });
  assert.deepEqual((await request(app).get('/api/v1/public/businesses?query=Hidden%20Integration').expect(200)).body.data.businesses, []);
  await prisma.business.update({ where: { id: inactiveBusiness.id }, data: { isApproved: true, isSuspended: true } });
  assert.deepEqual((await request(app).get('/api/v1/public/businesses?query=Hidden%20Integration').expect(200)).body.data.businesses, []);
  await prisma.business.update({ where: { id: inactiveBusiness.id }, data: { isSuspended: false, deletedAt: new Date() } });
  assert.deepEqual((await request(app).get('/api/v1/public/businesses?query=Hidden%20Integration').expect(200)).body.data.businesses, []);
  await request(app).get('/api/v1/public/businesses/not-a-uuid').expect(404);
  await request(app).get('/api/v1/appointments').expect(401);

  const detail = await request(app).get(`/api/v1/public/businesses/${business.id}`).expect(200);
  assert.equal('staff' in detail.body.data.business, false);

  const base = {
    businessId: business.id,
    customerName: 'Public Customer',
    customerPhone: '0911 000 009',
    serviceId: service.id,
    appointmentDate: futureDate(),
    startTime: '10:00',
    endTime: '11:45',
    notes: 'must remain private',
  };
  await request(app)
    .post('/api/v1/public/appointments')
    .send({ ...base, customerPhone: business.phone })
    .expect(409);
  await request(app).post('/api/v1/public/appointments').send({ ...base, serviceId: otherService.id }).expect(404);
  await request(app).post('/api/v1/public/appointments').send({ ...base, appointmentDate: '2020-01-01' }).expect(400);

  const created = await request(app).post('/api/v1/public/appointments').send(base).expect(201);
  assert.equal(created.body.data.appointment.endTime, '10:30');
  assert.equal(created.body.data.appointment.status, 'REQUESTED');
  assert.equal('notes' in created.body.data.appointment, false);

  const ownerToken = jwt.sign({ sub: ownerId }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const directorySync = await request(app)
    .put('/api/v1/caller-directory/contacts')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ contacts: [
      { displayName: 'Community Caller', phone: '0911 222 333' },
      { displayName: 'Duplicate Newer Name', phone: '+251911222333' },
      { displayName: '1234567', phone: '0911444555' },
    ] })
    .expect(200);
  assert.equal(directorySync.body.data.syncedCount, 1);
  const directoryLookup = await request(app)
    .get('/api/v1/caller-directory/lookup?phone=0911222333')
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);
  assert.equal(directoryLookup.body.data.suggestion.displayName, 'Duplicate Newer Name');
  assert.equal(directoryLookup.body.data.suggestion.confirmations, 1);

  const accepted = await request(app)
    .post(`/api/v1/appointments/${created.body.data.appointment.id}/respond`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ action: 'ACCEPT' })
    .expect(200);
  assert.equal(accepted.body.data.appointment.status, 'ADDED_TO_QUEUE');
  assert.ok(accepted.body.data.queueEntry);
  await request(app)
    .post(`/api/v1/appointments/${created.body.data.appointment.id}/respond`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ action: 'DECLINE', reason: 'OTHER' })
    .expect(409);
  await request(app).post('/api/v1/public/appointments').send({ ...base, customerPhone: '+251911000009' }).expect(409);

  const second = await request(app).post('/api/v1/public/appointments').send({
    ...base, customerPhone: '251911000009', startTime: '11:00', endTime: '11:01',
  }).expect(201);
  assert.equal(second.body.data.appointment.endTime, '11:30');
  assert.equal(await prisma.customer.count({ where: { businessId: business.id, normalizedPhone: '+251911000009' } }), 1);

  const lookup = await request(app).get('/api/v1/public/appointments?phone=0911000009').expect(200);
  assert.equal(lookup.body.data.appointments.length, 2);
  assert.equal(lookup.body.data.appointments[0].business.businessName, business.name);
  assert.equal('customer' in lookup.body.data.appointments[0], false);
  assert.equal('notes' in lookup.body.data.appointments[0], false);
  assert.equal(JSON.stringify(lookup.body).includes('must remain private'), false);

  const activeLookup = await request(app)
    .get('/api/v1/public/appointments?phone=0911000009&active=true')
    .expect(200);
  assert.equal(activeLookup.body.data.appointments.length, 2);
  assert.deepEqual(
    new Set(activeLookup.body.data.appointments.map((item) => item.status)),
    new Set(['REQUESTED', 'ADDED_TO_QUEUE']),
  );
  assert.equal(activeLookup.body.data.appointments[0].status, 'ADDED_TO_QUEUE');
});
