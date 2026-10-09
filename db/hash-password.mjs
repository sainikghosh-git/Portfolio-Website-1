/**
 * Generates ADMIN_PASSWORD_HASH for Node.js users.
 *
 *   node db/hash-password.mjs 'your-admin-password'
 *
 * If you don't have Node installed, just open db/hash-password.html in your
 * browser instead - it produces an identical value using Web Crypto.
 *
 * Format (both paths agree):
 *   pbkdf2-sha256$<iterations>$<saltHex>$<hashHex>
 */
import crypto from 'node:crypto';

const password = process.argv[2];
const ITERATIONS = 600000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

if (!password) {
  console.error("Usage: node db/hash-password.mjs 'your-admin-password'");
  process.exit(1);
}

if (password.length < 12) {
  console.error('Use at least 12 characters. This key unlocks your whole inbox.');
  process.exit(1);
}

const salt = crypto.randomBytes(SALT_BYTES);
const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_BYTES, 'sha256');

console.log(`pbkdf2-sha256$${ITERATIONS}$${salt.toString('hex')}$${hash.toString('hex')}`);
console.error('\nCopy the first line above into ADMIN_PASSWORD_HASH.');