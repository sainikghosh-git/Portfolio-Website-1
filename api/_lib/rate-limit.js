/**
 * Fixed-window rate limiter held in module scope.
 *
 * Caveat: on serverless this is per-instance, so it is a coarse speed bump,
 * NOT a hard guarantee. It stops casual spam and runaway scripts; it does not
 * stop a determined attacker. Put Cloudflare or Vercel WAF in front if you need
 * a real limit.
 */
const buckets = new Map();

function rateLimit(key, options = {}) {
  const max = options.max === undefined ? 5 : options.max;
  const windowMs = options.windowMs === undefined ? 60000 : options.windowMs;

  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || now > entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1 };
  }

  if (entry.count >= max) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count += 1;
  return { allowed: true, remaining: max - entry.count };
}

/** Best-effort client IP from proxy headers Vercel sets. */
function clientIp(req) {
  const headers = (req && req.headers) || {};
  const forwarded = headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return headers['x-real-ip'] || 'unknown';
}

module.exports = { rateLimit, clientIp };