const { json } = require('../_lib/db.js');
const { verifyPassword, setSessionCookie } = require('../_lib/auth.js');
const { rateLimit, clientIp } = require('../_lib/rate-limit.js');

/**
 * POST /api/admin/login
 * Exchanges the admin password for an httpOnly session cookie.
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Method not allowed' });
  }

  const limit = rateLimit('login:' + clientIp(req), { max: 8, windowMs: 15 * 60 * 1000 });
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter));
    return json(res, 429, { error: 'Too many attempts. Try again later.' });
  }

  let password = '';
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    password = body && typeof body.password === 'string' ? body.password : '';
  } catch (_) {
    return json(res, 400, { error: 'Invalid request' });
  }

  if (!password || password.length > 200) {
    return json(res, 401, { error: 'Incorrect password' });
  }

  let ok = false;
  try {
    ok = verifyPassword(password);
  } catch (err) {
    console.error('login config error:', err.message);
    return json(res, 500, { error: 'Login is not configured yet.' });
  }

  if (!ok) {
    // Same message regardless of whether the password was merely wrong.
    return json(res, 401, { error: 'Incorrect password' });
  }

  const secure = (req.headers['x-forwarded-proto'] || '') === 'https';
  setSessionCookie(res, secure);

  return json(res, 200, { ok: true });
};