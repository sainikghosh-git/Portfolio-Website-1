const crypto = require('node:crypto');

/**
 * Admin auth for a single-user inbox.
 *
 * Password is stored as a scrypt hash (ADMIN_PASSWORD_HASH) - never plaintext.
 * Session is a stateless HMAC-signed token in an httpOnly cookie, so there is
 * no session table and nothing to clean up.
 */

const COOKIE_NAME = 'sg_admin';
const MAX_AGE_MS = 1000 * 60 * 60 * 8; // 8 hours

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET must be set and at least 32 characters');
  }
  return s;
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function issueToken() {
  const exp = Date.now() + MAX_AGE_MS;
  const payload = b64url(JSON.stringify({ exp }));
  return payload + '.' + sign(payload);
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const payload = parts[0];
  const signature = parts[1];

  if (!timingSafeEqualStr(signature, sign(payload))) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof parsed.exp === 'number' && Date.now() < parsed.exp;
  } catch (_) {
    return false;
  }
}

/**
 * Verify a submitted password against the PBKDF2 hash in ADMIN_PASSWORD_HASH.
 * Format: pbkdf2-sha256$<iterations>$<saltHex>$<hashHex>
 *
 * PBKDF2 rather than scrypt so the matching hash can be generated in a browser
 * via Web Crypto (no Node install required). Parameters match Web Crypto's
 * PBKDF2 exactly, so a hash made by db/hash-password.html verifies here.
 * 600k iterations is the OWASP guidance for PBKDF2-HMAC-SHA256.
 */
function verifyPassword(candidate) {
  const stored = process.env.ADMIN_PASSWORD_HASH;
  if (!stored) throw new Error('ADMIN_PASSWORD_HASH is not configured');

  const parts = stored.split('$');
  const scheme = parts[0];
  const iterations = Number(parts[1]);
  const saltHex = parts[2];
  const hashHex = parts[3];

  if (scheme !== 'pbkdf2-sha256' || !saltHex || !hashHex) {
    throw new Error('ADMIN_PASSWORD_HASH is malformed');
  }
  if (!Number.isInteger(iterations) || iterations < 100000) {
    throw new Error('ADMIN_PASSWORD_HASH has an invalid iteration count');
  }

  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.pbkdf2Sync(
    candidate,
    Buffer.from(saltHex, 'hex'),
    iterations,
    expected.length,
    'sha256'
  );

  // Constant-time compare so a wrong password can't be brute-forced byte by byte.
  return crypto.timingSafeEqual(expected, actual);
}

/** Reads the cookie off the request (Vercel parses req.cookies). */
function isAuthenticated(req) {
  const cookies = (req && req.cookies) || {};
  return verifyToken(cookies[COOKIE_NAME]);
}

function setSessionCookie(res, secure) {
  const attrs = [
    COOKIE_NAME + '=' + issueToken(),
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=' + Math.floor(MAX_AGE_MS / 1000),
  ];
  if (secure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'
  );
}

module.exports = {
  verifyPassword,
  isAuthenticated,
  setSessionCookie,
  clearSessionCookie,
};