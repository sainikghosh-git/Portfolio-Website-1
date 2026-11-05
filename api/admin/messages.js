const { getClient, update, json } = require('../_lib/supabase.js');
const { isAuthenticated } = require('../_lib/auth.js');

/**
 * GET    /api/admin/messages?limit=&offset=  -> list stored messages
 * PATCH  /api/admin/messages                 -> { id, isRead } mark read/unread
 * DELETE /api/admin/messages?id=<uuid>       -> delete one
 *
 * All methods require a valid session cookie. Vercel routes by filename, so
 * these live in one file to share the /api/admin/messages path.
 *
 * Data comes from the Supabase `messages` table (db/supabase-messages-table.sql).
 * The column is `read`; responses map it to `is_read` so admin.js is unchanged
 * there, and ids are UUID strings.
 */
const COLUMNS = 'id, name, email, subject, message, created_at, read';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toInboxRow(row) {
  const { read, ...rest } = row;
  return { ...rest, is_read: !!read };
}

module.exports = async function handler(req, res) {
  // Auth first, before revealing anything about method or payload shape.
  if (!isAuthenticated(req)) {
    return json(res, 401, { error: 'Not authenticated' });
  }

  // Vercel hands us an already-parsed object for JSON content types; the dev
  // server and older clients may send a raw string. Handle both.
  let body = {};
  if (typeof req.body === 'string' && req.body.length > 0) {
    try {
      body = JSON.parse(req.body);
    } catch (_) {
      return json(res, 400, { error: 'Invalid request' });
    }
  } else if (req.body && typeof req.body === 'object') {
    body = req.body;
  }

  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const limit = Math.min(Number(q.limit) || 50, 200);
      const offset = Math.max(Number(q.offset) || 0, 0);

      const { data, count, error } = await getClient()
        .from('messages')
        .select(COLUMNS, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw new Error(error.message);

      return json(res, 200, {
        messages: (data || []).map(toInboxRow),
        total: count ?? (data || []).length,
        limit,
        offset,
      });
    }

    if (req.method === 'PATCH') {
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!UUID_RE.test(id)) {
        return json(res, 400, { error: 'A valid message id is required' });
      }

      const isRead = body.isRead === true;
      await update('messages', { id }, { read: isRead });
      return json(res, 200, { ok: true, id, isRead });
    }

    if (req.method === 'DELETE') {
      const q = req.query || {};
      const id = typeof q.id === 'string' ? q.id : '';
      if (!UUID_RE.test(id)) {
        return json(res, 400, { error: 'A valid message id is required' });
      }

      const { error } = await getClient()
        .from('messages')
        .delete()
        .eq('id', id);
      if (error) throw new Error(error.message);
      return json(res, 200, { ok: true, id });
    }

    res.setHeader('Allow', 'GET, PATCH, DELETE');
    return json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('messages request failed:', err.message);
    return json(res, 500, { error: 'Could not complete request' });
  }
};
