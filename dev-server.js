/**
 * Local preview server for the contact form + admin inbox.
 *
 *   node dev-server.js
 *
 * Serves your static site AND the /api routes with an in-memory message list,
 * so you can test the whole flow on localhost without deploying, without Neon,
 * and without touching any real credentials.
 *
 * This is a development tool only. It is NOT used by Vercel.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('base64url');
process.env.ADMIN_PASSWORD_HASH =
  process.env.ADMIN_PASSWORD_HASH ||
  (() => {
    // Matches the password printed at startup.
    const pw = 'WyPZ-PmYeg5ZV39Cdohk6q4_';
    const salt = crypto.randomBytes(16);
    return `pbkdf2-sha256$600000$${salt.toString('hex')}$` +
      crypto.pbkdf2Sync(pw, salt, 600000, 32, 'sha256').toString('hex');
  })();

const { validateContact } = require('./api/_lib/validate.js');
const { rateLimit, clientIp } = require('./api/_lib/rate-limit.js');
const { verifyPassword, isAuthenticated, setSessionCookie, clearSessionCookie } =
  require('./api/_lib/auth.js');

const PORT = 8080;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---- in-memory "database" ----
let messages = [
  {
    id: 1, name: 'Priya Sharma', email: 'priya@example.com', subject: 'Internship opportunity',
    message: "Hi Sainik,\n\nI came across your portfolio and wanted to reach out about a summer internship role on our AI tooling team.\n\nWe'd love to chat about your work with agentic workflows.\n\nBest,\nPriya",
    is_read: false,
    created_at: new Date(Date.now() - 3600_000 * 5).toISOString(),
  },
  {
    id: 2, name: 'Arjun Mehta', email: 'arjun.dev@example.com', subject: 'Collaboration on DSA project',
    message: 'Hey! I like the Java DSA suite you built.\n\nWant to collab on a LeetCode challenge tracker as a side project?',
    is_read: true,
    created_at: new Date(Date.now() - 3600_000 * 30).toISOString(),
  },
];
let nextId = 3;

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 20_000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve(null); }
    });
  });
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// ---- api routes ----
async function handleApi(req, res, pathname) {
  const body = req.method === 'GET' || req.method === 'DELETE'
    ? {}
    : (await readBody(req) || {});

  if (pathname === '/api/contact' && req.method === 'POST') {
    const limit = rateLimit('contact:' + clientIp(req), { max: 5, windowMs: 60_000 });
    if (!limit.allowed) {
      return sendJson(res, 429, { error: 'Too many messages. Please try again shortly.' });
    }

    const result = validateContact(body);
    if (result.isBot) return sendJson(res, 200, { ok: true });
    if (!result.valid) {
      return sendJson(res, 400, { error: 'Please check the form.', fields: result.errors });
    }

    messages.unshift({
      id: nextId++,
      name: result.values.name,
      email: result.values.email,
      subject: result.values.subject,
      message: result.values.message,
      is_read: false,
      created_at: new Date().toISOString(),
    });
    console.log(`  [contact] stored "${result.values.subject || '(no subject)'}" from ${result.values.email}`);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/login' && req.method === 'POST') {
    const limit = rateLimit('login:' + clientIp(req), { max: 8, windowMs: 15 * 60_000 });
    if (!limit.allowed) {
      return sendJson(res, 429, { error: 'Too many attempts. Try again later.' });
    }

    if (!body.password || body.password.length > 200) {
      return sendJson(res, 401, { error: 'Incorrect password' });
    }

    let ok = false;
    try { ok = verifyPassword(body.password); } catch (e) {
      console.error('login config error:', e.message);
      return sendJson(res, 500, { error: 'Login is not configured yet.' });
    }
    if (!ok) return sendJson(res, 401, { error: 'Incorrect password' });

    console.log('  [login] success');
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': buildCookie() });
  }

  if (pathname === '/api/admin/logout' && req.method === 'POST') {
    return sendJson(res, 200, { ok: true }, {
      'Set-Cookie': 'sg_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
    });
  }

  if (pathname === '/api/admin/messages') {
    const cookies = parseCookies(req.headers.cookie);
    if (!isAuthenticated({ cookies })) {
      return sendJson(res, 401, { error: 'Not authenticated' });
    }

    if (req.method === 'GET') {
      return sendJson(res, 200, { messages, total: messages.length, limit: 50, offset: 0 });
    }

    if (req.method === 'PATCH') {
      const msg = messages.find((m) => m.id === Number(body.id));
      if (!msg) return sendJson(res, 400, { error: 'Message not found' });
      msg.is_read = body.isRead === true;
      return sendJson(res, 200, { ok: true, id: msg.id, isRead: msg.is_read });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url, 'http://localhost');
      const id = Number(url.searchParams.get('id'));
      const before = messages.length;
      messages = messages.filter((m) => m.id !== id);
      if (messages.length === before) return sendJson(res, 400, { error: 'Message not found' });
      return sendJson(res, 200, { ok: true, id });
    }
  }

  return sendJson(res, 404, { error: 'Unknown API route' });
}

function buildCookie() {
  const exp = Date.now() + 1000 * 60 * 60 * 8;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET)
    .update(payload).digest('base64url');
  return `sg_admin=${payload}.${sig}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`;
}

// ---- static files ----
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';

  const full = path.join(ROOT, rel);
  if (!full.startsWith(ROOT)) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<h1>404</h1><p>Not found. Try <a href="/">the site</a>.</p>');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;

  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname).catch((e) => {
      console.error('api error:', e);
      sendJson(res, 500, { error: 'Server error' });
    });
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Local preview running\n');
  console.log('    Site   http://localhost:' + PORT);
  console.log('    Inbox  http://localhost:' + PORT + '/admin.html');
  console.log('    Hash   http://localhost:' + PORT + '/db/hash-password.html');
  console.log('');
  console.log('  Admin password:  WyPZ-PmYeg5ZV39Cdohk6q4_');
  console.log('');
  console.log('  Messages are stored in memory and reset when you stop this.');
  console.log('  Press Ctrl+C to stop.\n');
});