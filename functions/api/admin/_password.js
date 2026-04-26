/**
 * Password hashing helpers for the per-admin login feature.
 *
 * Uses PBKDF2-SHA256 via the Web Crypto API which Cloudflare Workers
 * support natively — no Node `crypto` import, no npm dependency, no
 * native bcrypt binary needed.
 *
 * Hash format: `pbkdf2$<iters>$<saltB64>$<hashB64>` (single-line string,
 * stored in the `Password Hash` column of the `Admins` sheet).
 */

const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

function toB64(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromB64(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const std = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(std);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function deriveBits(plain, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(plain),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    HASH_BITS
  );
  return new Uint8Array(bits);
}

/**
 * Produce a fresh PBKDF2 hash for a plaintext password. Each call rolls a
 * new random salt — never reuse a salt across users.
 *
 * @param {string} plain
 * @returns {Promise<string>} `pbkdf2$<iters>$<saltB64>$<hashB64>`
 */
export async function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('Password is required');
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const bits = await deriveBits(plain, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(bits)}`;
}

/**
 * Constant-time byte comparison to avoid timing-leak attacks on hash check.
 */
function constantTimeEq(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Verify a plaintext password against a stored hash string.
 * Returns false on any malformed input rather than throwing — callers
 * can treat the result as a simple boolean.
 *
 * @param {string} plain
 * @param {string} stored
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(plain, stored) {
  if (typeof plain !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4) return false;
  const [scheme, itersStr, saltB64, hashB64] = parts;
  if (scheme !== 'pbkdf2') return false;
  const iters = parseInt(itersStr, 10);
  if (!Number.isFinite(iters) || iters < 1000 || iters > 1_000_000) return false;
  let salt, expected;
  try {
    salt = fromB64(saltB64);
    expected = fromB64(hashB64);
  } catch {
    return false;
  }
  const actual = await deriveBits(plain, salt, iters);
  return constantTimeEq(actual, expected);
}
