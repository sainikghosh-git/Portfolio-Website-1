const { query, json } = require('./_lib/db.js');
const { rateLimit, clientIp } = require('./_lib/rate-limit.js');
const { validateContact } = require('./_lib/validate.js');

/**
 * POST /api/contact
 * Public endpoint. Accepts a message, stores it for the admin inbox.
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Method not allowed' });
  }

  // Same-origin only. A cross-site POST from an attacker's page should not be
  // able to make your server store anything on a logged-in visitor's behalf.
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    try {
      if (new URL(origin).host !== host) {
        return json(res, 403, { error: 'Forbidden' });
      }
    } catch (_) {
      return json(res, 403, { error: 'Forbidden' });
    }
  }

  const limit = rateLimit('contact:' + clientIp(req), { max: 5, windowMs: 60000 });
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter));
    return json(res, 429, { error: 'Too many messages. Please try again shortly.' });
  }

  let payload;
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (_) {
    return json(res, 400, { error: 'Invalid request' });
  }

  const result = validateContact(payload || {});
  const values = result.values;

  // Silently accept bot submissions so the sender sees nothing to tune against.
  if (result.isBot) {
    return json(res, 200, { ok: true });
  }

  if (!result.valid) {
    return json(res, 400, { error: 'Please check the form.', fields: result.errors });
  }

  try {
    await query(
      'INSERT INTO messages (name, email, subject, message) VALUES ($1, $2, $3, $4)',
      [values.name, values.email, values.subject, values.message]
    );
  } catch (err) {
    console.error('contact insert failed:', err.message);
    return json(res, 500, {
      error: 'Could not save your message. Please email me directly.',
    });
  }

  return json(res, 200, { ok: true });
};