# Contact form + admin inbox

A contact form on the portfolio that stores submissions in **Supabase**
(Postgres), plus a password-protected inbox at `/admin.html`.

The API uses the `@supabase/supabase-js` npm package (see `package.json`) with
the service-role key on the server only, so Row Level Security never blocks
form writes. Your existing static site deploys exactly as before.

```
api/
  contact.js          POST  public form submission
  admin/login.js      POST  password -> signed session cookie
  admin/logout.js     POST  clears the cookie
  admin/messages.js   GET/PATCH/DELETE  list, mark read, delete
  _lib/supabase.js    Supabase service-role client (server only)
  _lib/auth.js        PBKDF2 verify + HMAC session cookie
  _lib/rate-limit.js  in-memory fixed-window limiter
  _lib/validate.js    input validation + honeypot check
admin.html            inbox UI
admin.js              inbox client
contact.js            form submit handler
db/supabase-messages-table.sql   run once in the Supabase SQL Editor
db/hash-password.html browser-based hash generator (no install needed)
db/hash-password.mjs  same thing for Node users
db/schema.sql         legacy Neon schema (kept for reference; do not use)
```

---

## 1. Create the table

In the Supabase Dashboard → **SQL Editor**, paste and run
`db/supabase-messages-table.sql`. It creates the `messages` table with RLS
enabled (public insert only from the form; the API uses the service-role key,
which bypasses RLS).

---

## 2. Generate your password hash

**Easiest way — no install needed:**

Open `db/hash-password.html` in your browser, type your password, click
**GENERATE HASH**, then copy the result.

The page hashes entirely on your machine using your browser's built-in Web
Crypto. Your password is never sent anywhere, and the field clears itself after
generating.

**If you have Node 18+**, you can use the script instead:

```bash
node db/hash-password.mjs 'your-admin-password'
```

Both produce the same format:
```
pbkdf2-sha256$600000$<salt-hex>$<hash-hex>
```

> Why PBKDF2 instead of scrypt? Both are strong, but scrypt needs Node to
> generate the hash, and you don't have Node installed. PBKDF2 works in both
> the browser (Web Crypto) and Node, so you can create the hash without
> installing anything. 600,000 iterations is the OWASP recommendation for
> PBKDF2-HMAC-SHA256.

---

## 3. Set environment variables

In **Vercel → Project → Settings → Environment Variables**, add all five.
Mark them for **Production** (and Preview if you want to test there).

| Variable | Where to get it |
|----------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → *Project URL* |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API → *publishable key* |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → *service_role key* (server-side only) |
| `ADMIN_PASSWORD_HASH` | Output from step 2 |
| `SESSION_SECRET` | Any 32+ random characters (see below) |

For `SESSION_SECRET`, open your browser console and run:

```js
crypto.getRandomValues(new Uint8Array(32))
```

then paste the output. Or type 32+ random characters yourself.

> These must **never** be committed. `.env` and `.env.*` are already gitignored.

---

## 4. Deploy

Push to the connected branch, or:

```bash
vercel --prod
```

Then:
- Test the form on your live site
- Open `/admin.html` to see the inbox

---

## How the security works

**Password** — stored as `pbkdf2-sha256$600000$salt$hash`, verified with
`crypto.timingSafeEqual` so a wrong password can't be brute-forced byte by byte.
The raw password is never stored or logged.

**Session** — a stateless HMAC-SHA256 signed token in an `HttpOnly`,
`SameSite=Strict` cookie (8 hour expiry). No session table. The cookie can't be
read by JavaScript, so an XSS bug can't exfiltrate it.

**SQL injection** — there is no raw SQL in the request path. `@supabase/supabase-js`
sends parameterized PostgREST requests, and message ids are validated as UUIDs
before they reach the database. User input is never concatenated into a query.

**Supabase RLS** — the `messages` table denies all browser access except public
INSERT. Reads/updates/deletes only happen from the server-side API with the
service-role key, behind your admin password.

**Spam** — a honeypot field (`website`) that people can't see but bots fill;
bot submissions return success so the bot gets no feedback. Plus per-IP rate
limits: 5 messages/min, 8 login attempts/15min.

**Origin checks** — `POST /api/contact` rejects requests whose `Origin` doesn't
match the host, so a malicious page can't make your API post on a visitor's behalf.

---

## Limitations worth knowing

- **Rate limiting is per-instance.** On serverless, each warm lambda has its own
  bucket map, so it slows casual spam but is not a hard cap. Use Vercel WAF or
  Cloudflare for real enforcement.
- **No CSRF token.** `SameSite=Strict` plus the origin check covers this for the
  endpoints as written. If you add cookies that must be sent cross-site, revisit that.
- **No email notification.** Messages sit in the inbox until you open
  `/admin.html`. To be emailed on submit, add a provider (Resend, Postmark) to
  the insert path.
- **Single admin account.** No user table, no roles. Fine for a personal
  portfolio; not a multi-tenant system.
