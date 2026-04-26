import { readSheet, json } from '../_sheets.js';
import { verifyPassword } from './_password.js';

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const TOKEN_VERSION = 2;

// HMAC-SHA256 signing for the JWT-shaped token.
async function signToken(payload, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Verify a token and return the parsed session payload, or null on any
 * failure. Callers should treat null as Unauthorized. The previous version
 * of this function returned a boolean — the parsed-payload return is the
 * upgrade that lets endpoints attribute writes to the logged-in admin.
 *
 * Payload shape:
 *   { v: 2, username: string, displayName: string, isOwner: boolean, iat: ms }
 *
 * Tokens issued by the v1 codepath (no `username`, no `v`) are rejected so
 * stale browser sessions are forced to re-login.
 */
export async function verifyToken(token, secret) {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = await signToken(payload, secret);
  if (sig !== expected) return null;
  let data;
  try { data = JSON.parse(atob(payload)); } catch { return null; }
  if (!data || data.v !== TOKEN_VERSION) return null;
  if (data.role !== 'admin') return null;
  if (Date.now() - data.iat > TOKEN_TTL_MS) return null;
  if (typeof data.username !== 'string' || !data.username) return null;
  if (typeof data.displayName !== 'string' || !data.displayName) return null;
  return data;
}

async function issueToken({ username, displayName, isOwner }, secret) {
  const payload = btoa(JSON.stringify({
    v: TOKEN_VERSION,
    role: 'admin',
    username,
    displayName,
    isOwner: !!isOwner,
    iat: Date.now(),
  }));
  const sig = await signToken(payload, secret);
  return `${payload}.${sig}`;
}

// Generic credentials error — never reveal whether a username exists.
// Built per-call rather than cached at module scope: Cloudflare Workers v2
// forbids constructing a Response object during global init (counts as
// disallowed I/O setup), which broke the deploy.
function badCreds() {
  return json({ success: false, error: 'Invalid username or password' }, 401);
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'POST only' }, 405);

  const adminPassword = context.env.ADMIN_PASSWORD;
  if (!adminPassword) return json({ error: 'Admin not configured' }, 500);

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: 'Invalid request' }, 400); }

  const usernameRaw = (body && body.username) || '';
  const password = (body && body.password) || '';
  const username = String(usernameRaw).trim().toLowerCase();
  if (!password) return badCreds();

  // Owner override is restricted to the reserved username "owner". Any other
  // username has to authenticate against the Admins sheet — the override
  // can no longer be used to impersonate a real admin account by typing
  // their name in the username field. Reserves the bootstrap/recovery
  // identity behind a single, well-known label.
  //
  // Bootstrap: log in with username `owner` + ADMIN_PASSWORD env var.
  // Recovery: same path, even after real admins exist.
  if (username === 'owner' && password === adminPassword) {
    const token = await issueToken({
      username: 'owner',
      displayName: 'OWNER',
      isOwner: true,
    }, adminPassword);
    return json({ success: true, token, displayName: 'OWNER', isOwner: true });
  }

  // Per-admin login: look up the username in the `Admins` sheet and verify
  // the PBKDF2 hash. Generic 401 on any failure — no user enumeration.
  if (!username) return badCreds();
  let admins;
  try { admins = await readSheet(context.env, 'Admins'); }
  catch (e) {
    console.error('auth: Admins sheet read failed:', e && e.stack ? e.stack : e);
    return json({ error: 'Admin directory unavailable. Try again.' }, 500);
  }

  const row = admins.find((r) =>
    String(r.Username || '').trim().toLowerCase() === username
    && String(r.Active || '').trim().toLowerCase() === 'yes'
  );
  if (!row) return badCreds();

  const hash = String(row['Password Hash'] || '');
  const ok = hash ? await verifyPassword(password, hash) : false;
  if (!ok) return badCreds();

  const displayName = String(row['Display Name'] || row.Username || username).trim() || username;
  const token = await issueToken({
    username: username,
    displayName,
    isOwner: false,
  }, adminPassword);
  return json({ success: true, token, displayName, isOwner: false });
}
