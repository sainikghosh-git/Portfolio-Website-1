/**
 * Input validation for the public contact endpoint.
 * Everything is length-capped and stripped of control characters before it can
 * reach Postgres, so a long/complex input can't blow up the DB or the layout.
 */

// Deliberately generous but bounded. Long enough for a real message, short
// enough that nobody is writing an essay into a contact box.
const LIMITS = {
  name: 80,
  email: 254, // RFC 5321 max
  subject: 120,
  message: 2000,
};

// Very permissive on purpose - the goal is to catch typos and obvious garbage,
// not to adjudicate RFC 5322. Server-side DB writes are what actually need to
// be strict, and those use parameterized queries.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function clean(value, max) {
  if (typeof value !== 'string') return '';
  // Strip C0/C1 control characters (newlines, NULs, etc).
  return value
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function validateContact(payload) {
  const errors = {};

  const name = clean(payload && payload.name, LIMITS.name);
  const email = clean(payload && payload.email, LIMITS.email).toLowerCase();

  // Messages are the one field where newlines are legitimate.
  const message =
    typeof (payload && payload.message) === 'string'
      ? payload.message
          .replace(/\r\n/g, '\n')
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
          .trim()
          .slice(0, LIMITS.message)
      : '';

  const subject = clean(payload && payload.subject, LIMITS.subject);

  // Honeypot: real people never see this field, bots fill everything in.
  const trap = clean(payload && payload.website, 100);

  if (name.length < 2) errors.name = 'Please enter your name.';
  if (!EMAIL_RE.test(email)) errors.email = 'Please enter a valid email address.';
  if (message.length < 10) errors.message = 'Message must be at least 10 characters.';
  if (message.length > LIMITS.message) errors.message = 'Message is too long.';

  return {
    values: { name, email, subject, message },
    // Non-empty trap => almost certainly a bot. Report success so the bot
    // doesn't learn it was filtered.
    isBot: trap.length > 0,
    errors,
    valid: Object.keys(errors).length === 0,
  };
}

module.exports = { validateContact, LIMITS };