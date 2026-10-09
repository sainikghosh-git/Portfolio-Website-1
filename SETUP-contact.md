# Contact form + admin inbox

A contact form on the portfolio that stores submissions in **Neon** (serverless
Postgres), plus a password-protected inbox at `/admin.html`.

No npm dependencies — the API talks to Neon's HTTP SQL interface directly, so
there is no `node_modules` and no build step.

```
api/
  contact.js          POST  public form submission
  admin/login.js      POST  password -> signed session cookie
  admin/logout.js     POST  clears the cookie
  admin/messages.js   GET/PATCH/DELETE  list, mark read, delete
  _lib/db.js          Neon HTTP SQL client
  _lib/auth.js        scrypt verify + HMAC session cookie
  _lib/rate-limit.js  in-memory fixed-window limiter
  _lib/validate.js    input validation + honeypot check
admin.html            inbox UI
admin.js              inbox client
contact.js            form submit handler
db/schema.sql         run once in Neon
db/hash-password.mjs  generates ADMIN_PASSWORD_HASH
```

---

## 1. Create the table

In the Neon console, paste and run `db/schema.sql`.

---

## 2. Set environment variables

In **Vercel → Project → Settings → Environment Variables**:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Neon connection string (Connection Details) |
| `ADMIN_PASSWORD_HASH` | output of the command below |
| `SESSION_SECRET` | random 32+ char string |

Generate the password hash (needs Node 18+):

```bash
node db/hash-password.mjs 'choose-a-long-password'
```

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

> These values must **never** be committed. `.env` and `.env.*` are gitignored.

---

## 3. Deploy

Push to the connected branch, or:

```bash
vercel --prod
```

Then open `/admin.html` to view messages.

---

## How the security works

**Password** — stored as `scrypt$<salt>$<hash>`, verified with
`crypto.timingSafeEqual` so a wrong password can't be brute-forced byte by byte.

**Session** — a stateless HMAC-SHA256 signed token in an `HttpOnly`,
`SameSite=Strict` cookie (8 hour expiry). No session table. The cookie is not
readable by JavaScript, so an XSS bug can't exfiltrate it.

**SQL injection** — every query uses Postgres placeholders (`$1`, `$2`).
User input is never concatenated into SQL. Deletes coerce `id` with
`Number()` and validate it's a positive integer before it reaches the query.

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
- **No CSRF token.** The `SameSite=Strict` cookie plus origin check covers this
  for the endpoints as written; if you add cookies that must be sent
  cross-site, revisit that.
- **No email notification.** Messages sit in the inbox until you open
  `/admin.html`. If you want to be emailed on submit, add a provider
  (Resend, Postmark) to the insert path.
- **Single admin account.** No user table, no roles. Fine for a personal
  portfolio; not a multi-tenant system.