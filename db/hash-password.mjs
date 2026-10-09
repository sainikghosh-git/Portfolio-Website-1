/**
 * Generates the ADMIN_PASSWORD_HASH value for .env.
 *
 * Usage:
 *   node db/hash-password.mjs 'your-admin-password'
 *
 * Prints a single line like:
 *   scrypt$3f2a...c1$9ab4...de
 *
 * Paste that into ADMIN_PASSWORD_HASH in your environment variables.
 * The raw password never gets stored or logged.
 */
import crypto from 'node:crypto';

const password = process.argv[2];

if (!password) {
  console.error("Usage: node db/hash-password.mjs 'your-admin-password'");
  process.exit(1);
}

if (password.length < 12) {
  console.error('Use at least 12 characters. This key unlocks your whole inbox.');
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, 64);

console.log(`scrypt$${salt.toString('hex')}$${hash.toString('hex')}`);
console.error('\nCopy the first line above into ADMIN_PASSWORD_HASH.');