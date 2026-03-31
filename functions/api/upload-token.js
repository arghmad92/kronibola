import { json } from './_sheets.js';

// Generate a short-lived upload token (valid 30 minutes)
export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'POST only' }, 405);

  const secret = context.env.ADMIN_PASSWORD || 'kronibola';
  const payloadB64 = btoa(JSON.stringify({ purpose: 'upload', iat: Date.now() }));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  const sigStr = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const token = payloadB64 + '.' + sigStr;

  return json({ token });
}

// Verify upload token (exported for use by upload-receipt)
export async function verifyUploadToken(token, secret) {
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [payloadB64, sig] = parts;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const expectedSig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  const expectedStr = btoa(String.fromCharCode(...new Uint8Array(expectedSig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  if (sig !== expectedStr) return false;

  try {
    const data = JSON.parse(atob(payloadB64));
    if (data.purpose !== 'upload') return false;
    // Valid for 30 minutes
    if (Date.now() - data.iat > 30 * 60 * 1000) return false;
    return true;
  } catch {
    return false;
  }
}
