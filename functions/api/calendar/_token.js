/**
 * Long-lived calendar feed token.
 *
 * Calendar apps (iOS Calendar, Google Calendar) can't send custom
 * Authorization headers when refreshing a subscription, so we need
 * the auth proof inside the URL itself — a signed token in a query
 * parameter.
 *
 * Design choices:
 *   - HMAC-SHA256 signed with ADMIN_PASSWORD (same secret already used
 *     for admin login + upload tokens; rotation invalidates everything
 *     in one shot, which is the desired behaviour).
 *   - No issued-at / expiry — admins paste the URL into their phone once
 *     and expect it to keep working. To revoke, rotate ADMIN_PASSWORD.
 *   - Deterministic: same ADMIN_PASSWORD always produces the same token.
 *     Lets the admin panel render a stable URL admins can re-share.
 */

const PURPOSE = 'cal-feed';

async function sign(payloadB64, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function generateCalendarToken(secret) {
  if (!secret) throw new Error('Calendar token: secret required');
  const payloadB64 = btoa(JSON.stringify({ purpose: PURPOSE }));
  const sig = await sign(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

export async function verifyCalendarToken(token, secret) {
  if (!token || !secret) return false;
  const parts = String(token).split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;
  const expected = await sign(payloadB64, secret);
  if (sig !== expected) return false;
  try {
    const data = JSON.parse(atob(payloadB64));
    return data && data.purpose === PURPOSE;
  } catch {
    return false;
  }
}
