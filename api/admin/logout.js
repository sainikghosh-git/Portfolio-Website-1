const { json } = require('../_lib/db.js');
const { clearSessionCookie } = require('../_lib/auth.js');

/**
 * POST /api/admin/logout
 * Clears the session cookie. Safe to call repeatedly.
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Method not allowed' });
  }

  clearSessionCookie(res);
  return json(res, 200, { ok: true });
};