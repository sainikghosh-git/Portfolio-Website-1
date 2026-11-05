/**
 * Supabase admin client for server-side API routes (Vercel serverless).
 *
 * Uses the SERVICE_ROLE key so it can write to `messages` regardless of RLS.
 * This file is only ever imported by /api/* — it never runs in the browser.
 *
 * CommonJS on purpose: Vercel treats /api/*.js as CJS by default.
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getClient() {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');

  _client = createClient(url, key, {
    auth: {
      // Service-role clients should never persist sessions or auto-refresh tokens.
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return _client;
}

/**
 * Insert a row into any Supabase table.
 * Returns the inserted row(s) or throws on error.
 *
 * @param {string} table  - Table name
 * @param {object} values - Column → value map
 * @returns {Promise<object[]>}
 */
async function insert(table, values) {
  const supabase = getClient();
  const { data, error } = await supabase.from(table).insert(values).select();

  if (error) {
    console.error(`Supabase insert into "${table}" failed:`, error.message);
    throw new Error('Database insert failed');
  }

  return data;
}

/**
 * Select rows from a table with optional filters.
 * Returns rows array or throws on error.
 *
 * @param {string}  table   - Table name
 * @param {string}  columns - Columns to select (default '*')
 * @param {object}  [match] - Optional equality filters { column: value }
 * @param {object}  [opts]  - { orderBy, ascending, limit }
 * @returns {Promise<object[]>}
 */
async function select(table, columns = '*', match = {}, opts = {}) {
  const supabase = getClient();
  let q = supabase.from(table).select(columns);

  for (const [col, val] of Object.entries(match)) {
    q = q.eq(col, val);
  }

  if (opts.orderBy) q = q.order(opts.orderBy, { ascending: opts.ascending ?? false });
  if (opts.limit)   q = q.limit(opts.limit);

  const { data, error } = await q;
  if (error) {
    console.error(`Supabase select from "${table}" failed:`, error.message);
    throw new Error('Database select failed');
  }

  return data;
}

/**
 * Update rows matching `match` with `values`.
 *
 * @param {string} table  - Table name
 * @param {object} match  - Equality filters { column: value }
 * @param {object} values - Column → value map
 * @returns {Promise<object[]>}
 */
async function update(table, match, values) {
  const supabase = getClient();
  let q = supabase.from(table).update(values);

  for (const [col, val] of Object.entries(match)) {
    q = q.eq(col, val);
  }

  const { data, error } = await q.select();
  if (error) {
    console.error(`Supabase update on "${table}" failed:`, error.message);
    throw new Error('Database update failed');
  }

  return data;
}

/**
 * Shared JSON response helper (mirrors the old db.js helper so callers need
 * no changes).
 */
function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(body);
}

module.exports = { insert, select, update, json, getClient };
