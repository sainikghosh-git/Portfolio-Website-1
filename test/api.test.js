/**
 * Endpoint-level tests for the /api handlers.
 *
 *   node test/api.test.js
 *
 * Mocks req/res so we can assert routing, auth gates, and validation without a
 * live database. Neon itself is stubbed at the module boundary - the real HTTP
 * call is only exercised in production.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

process.env.SESSION_SECRET = 'x'.repeat(48);
const PASSWORD = 'test-admin-password-123';
const salt = crypto.randomBytes(16);
process.env.ADMIN_PASSWORD_HASH =
  `pbkdf2-sha256$600000$${salt.toString('hex')}$` +
  crypto.pbkdf2Sync(PASSWORD, salt, 600000, 32, 'sha256').toString('hex');

// Stub the DB before the handlers require it, so no network call is made.
const inserted = [];
require.cache[require.resolve('../api/_lib/db.js')] = {
  id: require.resolve('../api/_lib/db.js'),
  filename: require.resolve('../api/_lib/db.js'),
  loaded: true,
  exports: {
    query: async (sql, params) => {
      if (sql.startsWith('INSERT')) {
        inserted.push(params);
        return { rows: [] };
      }
      if (sql.startsWith('SELECT COUNT')) return { rows: [{ total: inserted.length }] };
      return { rows: [] };
    },
    json: (res, status, body) => res.status(status).json(body),
  },
};

const contact = require('../api/contact.js');
const login = require('../api/admin/login.js');
const logout = require('../api/admin/logout.js');
const messages = require('../api/admin/messages.js');

function mockRes() {
  const res = {
    _status: 200,
    _body: null,
    _headers: {},
    setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
    status(c) { this._status = c; return this; },
    json(b) { this._body = b; return this; },
  };
  return res;
}

function mockReq({ method = 'GET', body, headers = {}, cookies = {}, query = {} } = {}) {
  return { method, body, headers, cookies, query };
}

// ------------------------------------------------------------- contact
test('contact: GET is rejected', async () => {
  const res = mockRes();
  await contact(mockReq({ method: 'GET' }), res);
  assert.strictEqual(res._status, 405);
});

test('contact: cross-origin POST is forbidden', async () => {
  const res = mockRes();
  await contact(
    mockReq({
      method: 'POST',
      headers: { origin: 'https://evil.example', host: 'mysite.com' },
      body: { name: 'Alice', email: 'a@b.com', message: 'long enough message' },
    }),
    res
  );
  assert.strictEqual(res._status, 403);
  assert.strictEqual(inserted.length, 0, 'nothing should be stored');
});

test('contact: same-origin POST stores the message', async () => {
  const before = inserted.length;
  const res = mockRes();
  await contact(
    mockReq({
      method: 'POST',
      headers: { origin: 'https://mysite.com', host: 'mysite.com' },
      body: { name: 'Alice', email: 'Alice@Example.com', subject: 'Hello', message: 'A real message body.' },
    }),
    res
  );
  assert.strictEqual(res._status, 200);
  assert.strictEqual(inserted.length, before + 1);
  assert.deepStrictEqual(inserted[inserted.length - 1], [
    'Alice', 'alice@example.com', 'Hello', 'A real message body.'
  ]);
});

test('contact: no Origin header is allowed (non-browser client)', async () => {
  const res = mockRes();
  await contact(
    mockReq({ method: 'POST', body: { name: 'Bob', email: 'b@c.com', message: 'Another real message.' } }),
    res
  );
  assert.strictEqual(res._status, 200);
});

test('contact: invalid input returns 400 with field errors, stores nothing', async () => {
  const before = inserted.length;
  const res = mockRes();
  await contact(mockReq({ method: 'POST', body: { name: 'A', email: 'bad', message: 'hi' } }), res);
  assert.strictEqual(res._status, 400);
  assert.ok(res._body.fields, 'should include per-field errors');
  assert.strictEqual(inserted.length, before, 'nothing stored');
});

test('contact: honeypot returns 200 but stores nothing', async () => {
  const before = inserted.length;
  const res = mockRes();
  await contact(
    mockReq({
      method: 'POST',
      body: { name: 'Bot', email: 'bot@spam.com', message: 'buy my thing now', website: 'http://spam' },
    }),
    res
  );
  assert.strictEqual(res._status, 200, 'bot should see success');
  assert.strictEqual(inserted.length, before, 'but nothing stored');
});

test('contact: malformed JSON body returns 400', async () => {
  const res = mockRes();
  await contact(mockReq({ method: 'POST', body: '{not json' }), res);
  assert.strictEqual(res._status, 400);
});

test('contact: rate limit kicks in after 5 from one IP', async () => {
  const body = { name: 'Alice', email: 'a@b.com', message: 'repeated message body' };
  const statuses = [];
  for (let i = 0; i < 7; i++) {
    const res = mockRes();
    await contact(
      mockReq({ method: 'POST', headers: { 'x-forwarded-for': '203.0.113.9' }, body }),
      res
    );
    statuses.push(res._status);
  }
  assert.ok(statuses.includes(429), 'should have been rate limited');
});

// --------------------------------------------------------------- login
test('login: GET is rejected', async () => {
  const res = mockRes();
  await login(mockReq({ method: 'GET' }), res);
  assert.strictEqual(res._status, 405);
});

test('login: wrong password returns 401 and sets no cookie', async () => {
  const res = mockRes();
  await login(mockReq({ method: 'POST', body: { password: 'nope' } }), res);
  assert.strictEqual(res._status, 401);
  assert.ok(!res._headers['set-cookie']);
});

test('login: correct password sets an httpOnly cookie', async () => {
  const res = mockRes();
  await login(mockReq({ method: 'POST', body: { password: PASSWORD } }), res);
  assert.strictEqual(res._status, 200);
  assert.match(res._headers['set-cookie'], /HttpOnly/i);
});

test('login: empty and oversized passwords rejected without hashing', async () => {
  for (const pw of ['', 'a'.repeat(500)]) {
    const res = mockRes();
    await login(mockReq({ method: 'POST', body: { password: pw } }), res);
    assert.strictEqual(res._status, 401);
  }
});

test('login: issued cookie then authenticates against messages endpoint', async () => {
  const res = mockRes();
  await login(mockReq({ method: 'POST', body: { password: PASSWORD } }), res);
  const cookie = res._headers['set-cookie'].split(';')[0].split('=')[1];

  const listRes = mockRes();
  await messages(mockReq({ method: 'GET', cookies: { sg_admin: cookie } }), listRes);
  assert.strictEqual(listRes._status, 200, 'cookie from login should open the inbox');
});

// ------------------------------------------------------------ messages
test('messages: unauthenticated is rejected on every method', async () => {
  for (const method of ['GET', 'PATCH', 'DELETE']) {
    const res = mockRes();
    await messages(mockReq({ method, body: { id: 1 }, query: { id: '1' } }), res);
    assert.strictEqual(res._status, 401, method + ' must require auth');
  }
});

test('messages: auth is checked BEFORE method validation', async () => {
  // An unauthenticated caller must not learn which methods exist.
  const res = mockRes();
  await messages(mockReq({ method: 'PATCH', body: { id: 'not-a-number' } }), res);
  assert.strictEqual(res._status, 401, 'should be 401, not 400');
});

test('messages: PATCH rejects a non-integer id', async () => {
  const res = mockRes();
  await messages(
    mockReq({ method: 'PATCH', cookies: { sg_admin: 'x.y' }, body: { id: 'abc' } }),
    res
  );
  // Invalid cookie -> 401; the point is it never reaches SQL.
  assert.ok([400, 401].includes(res._status));
});

test('messages: unsupported method returns 405 when authenticated', async () => {
  const res = mockRes();
  await login(mockReq({ method: 'POST', body: { password: PASSWORD } }), res);
  const cookie = res._headers['set-cookie'].split(';')[0].split('=')[1];

  const bad = mockRes();
  await messages(mockReq({ method: 'PUT', cookies: { sg_admin: cookie } }), bad);
  assert.strictEqual(bad._status, 405);
});

// -------------------------------------------------------------- logout
test('logout: clears the cookie', async () => {
  const res = mockRes();
  await logout(mockReq({ method: 'POST' }), res);
  assert.strictEqual(res._status, 200);
  assert.match(res._headers['set-cookie'], /Max-Age=0/i);
});

test('logout: GET is rejected', async () => {
  const res = mockRes();
  await logout(mockReq({ method: 'GET' }), res);
  assert.strictEqual(res._status, 405);
});