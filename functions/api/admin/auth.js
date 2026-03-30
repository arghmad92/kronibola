import { json } from '../_sheets.js';

// Generate HMAC-SHA256 signature
async function signToken(payload, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Verify token signature and expiration
export async function verifyToken(token, secret) {
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [payload, sig] = parts;
  const expectedSig = await signToken(payload, secret);
  if (sig !== expectedSig) return false;

  try {
    const data = JSON.parse(atob(payload));
    if (data.role !== 'admin') return false;
    // Token expires after 8 hours
    if (Date.now() - data.iat > 8 * 60 * 60 * 1000) return false;
    return true;
  } catch {
    return false;
  }
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'POST only' }, 405);

  const { password } = await context.request.json();
  const adminPassword = context.env.ADMIN_PASSWORD;

  if (!adminPassword) return json({ error: 'Admin not configured' }, 500);

  if (password === adminPassword) {
    const secret = adminPassword;
    const payload = btoa(JSON.stringify({ role: 'admin', iat: Date.now() }));
    const sig = await signToken(payload, secret);
    const token = `${payload}.${sig}`;
    return json({ success: true, token });
  }

  return json({ success: false, error: 'Wrong password' }, 401);
}
