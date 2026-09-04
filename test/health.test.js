import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@localhost:5432/minot_test?schema=public';
process.env.JWT_SECRET ||= 'test-secret-that-is-long-enough';
process.env.NODE_ENV = 'test';

const { app } = await import('../src/server.js');

test('GET /health uses the standard success envelope', async () => {
  const response = await request(app).get('/health').expect(200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.message, 'ምኞት API is healthy');
  assert.equal(typeof response.body.data.payments.chapaConfigured, 'boolean');
  assert.match(response.body.data.payments.returnUrl, /^https:\/\//);
});

test('Chapa return URL has a safe in-app fallback page', async () => {
  const response = await request(app).get('/api/v1/public/chapa/return').expect(200);
  assert.match(response.headers['content-type'], /^text\/html/);
  assert.match(response.text, /Payment received/);
});

test('unknown route uses the standard error envelope', async () => {
  const response = await request(app).get('/not-a-route').expect(404);
  assert.equal(response.body.success, false);
  assert.ok(Array.isArray(response.body.errors));
});
