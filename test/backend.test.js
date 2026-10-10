/**
 * Test suite for the contact form backend helpers.
 *
 *   node test/backend.test.js
 *
 * No dependencies - uses node:test and node:assert. Exits non-zero on failure
 * so it can run in CI or as a pre-deploy check.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

process.env.SESSION_SECRET = 'x'.repeat(48);

const PASSWORD = 'correct-horse-battery-staple';
const salt = crypto.randomBytes(16);
process.env.ADMIN_PASSWORD_HASH =
  `pbkdf2-sha256$600000$${salt.toString('hex')}$` +
  crypto.pbkdf2Sync(PASSWORD, salt, 600000, 32, 'sha256').toString('hex');

const { verifyPassword, isAuthenticated, setSessionCookie, clearSessionCookie } =
  require('../api/_lib/auth.js');
const { validateContact } = require('../api/_lib/validate.js');
const { rateLimit, clientIp } = require('../api/_lib/rate-limit.js');

function mockRes() {
  const headers = {};
  return { setHeader: (k, v) => { headers[k] = v; }, _h: headers };
}

// ---------------------------------------------------------------- auth
test('password: correct one verifies', () => {
  assert.strictEqual(verifyPassword(PASSWORD), true);
});

test('password: wrong one rejected', () => {
  assert.strictEqual(verifyPassword('wrong-password'), false);
});

test('password: empty rejected', () => {
  assert.strictEqual(verifyPassword(''), false);
});

test('password: case sensitive', () => {
  assert.strictEqual(verifyPassword('CORRECT-HORSE-BATTERY-STAPLE'), false);
});

test('password: malformed hash throws rather than silently passing', () => {
  const saved = process.env.ADMIN_PASSWORD_HASH;
  process.env.ADMIN_PASSWORD_HASH = 'garbage';
  assert.throws(() => verifyPassword(PASSWORD));
  process.env.ADMIN_PASSWORD_HASH = saved;
});

test('cookie: HttpOnly, SameSite=Strict, Secure over https', () => {
  const res = mockRes();
  setSessionCookie(res, true);
  const cookie = res._h['Set-Cookie'];
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Secure/i);
});

test('cookie: no Secure flag over plain http (local dev)', () => {
  const res = mockRes();
  setSessionCookie(res, false);
  assert.doesNotMatch(res._h['Set-Cookie'], /Secure/i);
});

test('session: valid token authenticates', () => {
  const res = mockRes();
  setSessionCookie(res, true);
  const token = res._h['Set-Cookie'].split(';')[0].split('=')[1];
  assert.strictEqual(isAuthenticated({ cookies: { sg_admin: token } }), true);
});

test('session: missing / empty / malformed all rejected', () => {
  assert.strictEqual(isAuthenticated({ cookies: {} }), false);
  assert.strictEqual(isAuthenticated({ cookies: { sg_admin: '' } }), false);
  assert.strictEqual(isAuthenticated({ cookies: { sg_admin: 'garbage' } }), false);
});

test('session: forged signature rejected', () => {
  const forged = Buffer.from(JSON.stringify({ exp: Date.now() + 99999 })).toString('base64url');
  assert.strictEqual(
    isAuthenticated({ cookies: { sg_admin: forged + '.deadbeef' } }),
    false
  );
});

test('session: expired token rejected', () => {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() - 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET)
    .update(payload).digest('base64url');
  assert.strictEqual(isAuthenticated({ cookies: { sg_admin: payload + '.' + sig } }), false);
});

test('session: rotating SESSION_SECRET invalidates old cookies', () => {
  const res = mockRes();
  setSessionCookie(res, true);
  const token = res._h['Set-Cookie'].split(';')[0].split('=')[1];

  const saved = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'y'.repeat(48);
  assert.strictEqual(isAuthenticated({ cookies: { sg_admin: token } }), false);
  process.env.SESSION_SECRET = saved;
});

test('logout: clears cookie with Max-Age=0', () => {
  const res = mockRes();
  clearSessionCookie(res);
  assert.match(res._h['Set-Cookie'], /Max-Age=0/i);
});

// ------------------------------------------------------------ validation
test('contact: valid input accepted', () => {
  const r = validateContact({
    name: 'Alice', email: 'Alice@Example.com', subject: 'Hi', message: 'This is long enough.'
  });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.values.email, 'alice@example.com');
});

test('contact: rejects bad name / email / short message', () => {
  assert.strictEqual(validateContact({ name: 'A', email: 'a@b.com', message: 'long enough here' }).valid, false);
  assert.strictEqual(validateContact({ name: 'Alice', email: 'nope', message: 'long enough here' }).valid, false);
  assert.strictEqual(validateContact({ name: 'Alice', email: 'a@b', message: 'long enough here' }).valid, false);
  assert.strictEqual(validateContact({ name: 'Alice', email: 'a@b.com', message: 'hi' }).valid, false);
});

test('contact: empty and null payloads are safe', () => {
  assert.strictEqual(validateContact({}).valid, false);
  assert.strictEqual(validateContact(null).valid, false);
  assert.strictEqual(validateContact(undefined).valid, false);
});

test('contact: honeypot flags bots, leaves humans alone', () => {
  assert.strictEqual(
    validateContact({ name: 'Alice', email: 'a@b.com', message: 'long enough here', website: 'http://spam' }).isBot,
    true
  );
  assert.strictEqual(
    validateContact({ name: 'Alice', email: 'a@b.com', message: 'long enough here' }).isBot,
    false
  );
});

test('contact: strips NUL and other control chars', () => {
  const r = validateContact({ name: 'Al\x00ice', email: 'a@b.com', message: 'bad\x07bell here' });
  assert.ok(!r.values.name.includes('\x00'));
  assert.ok(!r.values.message.includes('\x07'));
});

test('contact: caps field lengths', () => {
  const r = validateContact({ name: 'A'.repeat(500), email: 'a@b.com', message: 'm'.repeat(9000) });
  assert.strictEqual(r.values.name.length, 80);
  assert.strictEqual(r.values.message.length, 2000);
});

// The regression: \n is 0x0A and sits inside \u0000-\u001F. Stripping that whole
// range silently flattened every multi-paragraph message onto one line.
test('contact: PRESERVES newlines in message body', () => {
  const r = validateContact({
    name: 'Alice', email: 'a@b.com', message: 'line one\nline two\r\nline three'
  });
  assert.strictEqual(r.values.message, 'line one\nline two\nline three');
  assert.strictEqual(r.values.message.split('\n').length, 3);
  assert.ok(!r.values.message.includes('\r'), 'CRLF should normalize to LF');
});

test('contact: preserves blank lines between paragraphs', () => {
  const r = validateContact({
    name: 'Alice', email: 'a@b.com', message: 'Para one.\n\nPara two after blank line.'
  });
  assert.ok(r.values.message.includes('\n\n'));
});

test('contact: strips tabs and bells but not newlines', () => {
  const r = validateContact({ name: 'Alice', email: 'a@b.com', message: 'a\tb\x07c\nd' });
  assert.ok(!r.values.message.includes('\t'));
  assert.ok(!r.values.message.includes('\x07'));
  assert.ok(r.values.message.includes('\n'));
});

test('contact: name and subject stay single-line', () => {
  const r = validateContact({
    name: 'Al\nice', email: 'a@b.com', subject: 'a\nb', message: 'long enough here'
  });
  assert.ok(!r.values.name.includes('\n'));
  assert.ok(!r.values.subject.includes('\n'));
});

// ----------------------------------------------------------- rate limit
test('rate limit: allows up to max, then blocks', () => {
  const opts = { max: 3, windowMs: 60000 };
  assert.strictEqual(rateLimit('k1', opts).allowed, true);
  assert.strictEqual(rateLimit('k1', opts).allowed, true);
  assert.strictEqual(rateLimit('k1', opts).allowed, true);
  const blocked = rateLimit('k1', opts);
  assert.strictEqual(blocked.allowed, false);
  assert.ok(blocked.retryAfter > 0);
});

test('rate limit: keys are independent', () => {
  const opts = { max: 2, windowMs: 60000 };
  rateLimit('a', opts);
  rateLimit('a', opts);
  assert.strictEqual(rateLimit('a', opts).allowed, false);
  assert.strictEqual(rateLimit('b', opts).allowed, true);
});

test('rate limit: expired window resets', async () => {
  const opts = { max: 1, windowMs: 1 };
  assert.strictEqual(rateLimit('c', opts).allowed, true);
  await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(rateLimit('c', opts).allowed, true);
});

test('clientIp: reads x-forwarded-for, then x-real-ip, then unknown', () => {
  assert.strictEqual(clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }), '1.2.3.4');
  assert.strictEqual(clientIp({ headers: { 'x-real-ip': '9.9.9.9' } }), '9.9.9.9');
  assert.strictEqual(clientIp({ headers: {} }), 'unknown');
  assert.strictEqual(clientIp({}), 'unknown');
});