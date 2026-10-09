const { query, json } = require('../_lib/db.js');
const { isAuthenticated } = require('../_lib/auth.js');

/**
 * GET    /api/admin/messages?limit=&offset=  -> list stored messages
 * PATCH  /api/admin/messages                 -> { id, isRead } mark read/unread
 * DELETE /api/admin/messages?id=123          -> delete one
 *
 * All methods require a valid session cookie. Vercel routes by filename, so
 * these live in one file to share the /api/admin/messages path.
 */
module.exports = async function handler(req, res) {
  // Auth first, before revealing anything about method or payload shape.
  if (!isAuthenticated(req)) {
    return json(res, 401, { error: 'Not authenticated' });
  }

  let body = {};
  if (typeof req.body === 'string' && req.body.length > 0) {
    try {
      body = JSON.parse(req.body);
    } catch (_) {
      return json(res, 400, { error: 'Invalid request' });
    }
  }

  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const limit = Math.min(Number(q.limit) || 50, 200);
      const offset = Math.max(Number(q.offset) || 0, 0);

      const result = await query(
        'SELECT id, name, email, subject, message, created_at, is_read ' +
          'FROM messages ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      );

      const countResult = await query('SELECT COUNT(*)::int AS total FROM messages');
      const total =
        (countResult.rows && countResult.rows[0] && countResult.rows[0].total) || 0;

      return json(res, 200, {
        messages: result.rows || [],
        total,
        limit,
        offset,
      });
    }

    if (req.method === 'PATCH') {
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) {
        return json(res, 400, { error: 'A valid message id is required' });
      }

      const isRead = body.isRead === true;
      await query('UPDATE messages SET is_read = $1 WHERE id = $2', [isRead, id]);
      return json(res, 200, { ok: true, id, isRead });
    }

    if (req.method === 'DELETE') {
      const q = req.query || {};
      const id = Number(q.id);
      if (!Number.isInteger(id) || id <= 0) {
        return json(res, 400, { error: 'A valid message id is required' });
      }

      await query('DELETE FROM messages WHERE id = $1', [id]);
      return json(res, 200, { ok: true, id });
    }

    res.setHeader('Allow', 'GET, PATCH, DELETE');
    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('messages request failed:', err.message);
    return json(res, 500, { error: 'Could not complete request' });
  }
};