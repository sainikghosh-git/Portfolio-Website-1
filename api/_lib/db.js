/**
 * Neon serverless Postgres via its HTTP SQL API.
 * Deliberately dependency-free: no @neondatabase/serverless, no npm install.
 *
 * CommonJS on purpose: Vercel treats /api/*.js as CJS unless the project has
 * package.json with "type":"module". Keeping CJS means no package.json is
 * needed, so the static portfolio build is unaffected.
 */

function config() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured');

  // postgresql://user:pass@ep-xxx.region.neon.tech/dbname?sslmode=require
  const u = new URL(url);
  if (!u.hostname || !u.password) {
    throw new Error('DATABASE_URL must include host and password');
  }

  return {
    endpoint: 'https://' + u.hostname + '/sql',
    neonConnection: u.hostname.split('.').slice(0, 2).join('.'),
    password: decodeURIComponent(u.password),
  };
}

/**
 * Run a parameterized query.
 * Never string-concatenate user input into `sql` - always use $1, $2 placeholders.
 */
async function query(sql, params = []) {
  const cfg = config();

  const res = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Neon-Connection-String': cfg.neonConnection,
      Authorization: 'Bearer ' + cfg.password,
    },
    body: JSON.stringify({ sql, params }),
  });

  const text = await res.text();

  if (!res.ok) {
    console.error('Neon HTTP error:', res.status, text.slice(0, 500));
    throw new Error('Database request failed');
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    console.error('Neon returned non-JSON:', text.slice(0, 500));
    throw new Error('Database request failed');
  }

  if (payload.error) {
    console.error('Neon query error:', JSON.stringify(payload.error).slice(0, 500));
    throw new Error('Database request failed');
  }

  return payload;
}

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(body);
}

module.exports = { query, json };