import { json } from './_sheets.js';

async function verifyUploadToken(token, secret) {
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
    if (Date.now() - data.iat > 30 * 60 * 1000) return false;
    return true;
  } catch { return false; }
}

// Short window in which repeat uploads of the same receipt are treated as
// accidental double-fires (mobile Safari is known to fire `change` twice on
// camera-sourced file inputs). Longer than this, a second upload is treated
// as an intentional retry / correction and forwarded to Telegram normally.
const DEDUPE_TTL_SECONDS = 6;

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const { refCode, playerName, imageData, mimeType, uploadToken } = await context.request.json();
    if (!imageData || !refCode) return json({ error: 'Missing receipt data' }, 400);

    // Verify upload token
    const secret = context.env.ADMIN_PASSWORD || 'kronibola';
    const validToken = await verifyUploadToken(uploadToken, secret);
    if (!validToken) return json({ error: 'Invalid or expired upload session. Please refresh the page.' }, 403);

    // Validate MIME type (Option G) — allow common mobile formats too
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/jpg'];
    if (mimeType && !allowedMimes.includes(mimeType.toLowerCase())) {
      return json({ error: 'Only image files are allowed' }, 400);
    }

    // Validate file size — base64 is ~33% larger than raw, so 6.7MB base64 ≈ 5MB file
    const base64 = imageData.replace(/^data:[^;]+;base64,/, '');
    if (base64.length > 6.7 * 1024 * 1024) {
      return json({ error: 'File too large. Maximum size is 5MB.' }, 400);
    }

    // Dedupe identical uploads within a short window. Fingerprint combines
    // refCode + image size + a small prefix of the encoded bytes — enough to
    // tell "same receipt posted twice in 6 seconds" from "user retried with
    // a different file". Key lives in the VISITORS_KV namespace (reused as
    // a general ephemeral cache; prefix keeps it separate from visitor keys).
    if (context.env.VISITORS_KV) {
      const prefix = base64.slice(0, 32);
      const fp = `rx:${refCode}:${base64.length}:${prefix}`;
      const recent = await context.env.VISITORS_KV.get(fp).catch(() => null);
      if (recent) {
        // Duplicate within window — swallow it. Report success to the client
        // so the user still sees the ✓, but do NOT forward to Telegram.
        return json({ success: true, deduped: true });
      }
      // Record the fingerprint BEFORE sending to Telegram so any truly
      // simultaneous second request finds the key set.
      await context.env.VISITORS_KV.put(fp, '1', { expirationTtl: DEDUPE_TTL_SECONDS }).catch(() => {});
    }

    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    // Basic sanity check — file should have some content
    if (bytes.length < 100) return json({ error: 'Invalid file' }, 400);

    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
    const safeName = (playerName || 'player').replace(/[^a-zA-Z0-9\s]/g, '').slice(0, 50);
    const safeRef = (refCode || '').replace(/[^a-zA-Z0-9\-]/g, '').slice(0, 20);
    const fileName = `${safeRef}_${safeName}.${ext}`;
    const caption = `🧾 Payment Receipt\n\nPlayer: ${safeName}\nRef: ${safeRef}`;

    // Telegram credentials from environment variables
    const TG_BOT_TOKEN = context.env.TG_BOT_TOKEN;
    const TG_CHAT_ID = context.env.TG_CHAT_ID;
    if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
      console.error('Telegram credentials not configured');
      return json({ error: 'Upload service unavailable' }, 500);
    }

    // Build multipart form data for Telegram sendPhoto
    const boundary = '----TgBound' + Date.now();
    const chatIdPart = `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${TG_CHAT_ID}\r\n`;
    const captionPart = `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`;
    const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const ending = `\r\n--${boundary}--\r\n`;

    const enc = new TextEncoder();
    const chatIdBytes = enc.encode(chatIdPart);
    const captionBytes = enc.encode(captionPart);
    const fileHeaderBytes = enc.encode(fileHeader);
    const endingBytes = enc.encode(ending);

    const totalLen = chatIdBytes.length + captionBytes.length + fileHeaderBytes.length + bytes.length + endingBytes.length;
    const body = new Uint8Array(totalLen);
    let offset = 0;
    body.set(chatIdBytes, offset); offset += chatIdBytes.length;
    body.set(captionBytes, offset); offset += captionBytes.length;
    body.set(fileHeaderBytes, offset); offset += fileHeaderBytes.length;
    body.set(bytes, offset); offset += bytes.length;
    body.set(endingBytes, offset);

    const tgRes = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: body,
    });

    const tgResult = await tgRes.json();
    if (!tgResult.ok) {
      console.error('Telegram error:', tgResult.description);
      return json({ error: 'Receipt upload failed. Please try again.' }, 500);
    }

    return json({ success: true });
  } catch (e) {
    console.error('Upload error:', e);
    return json({ error: 'An error occurred. Please try again.' }, 500);
  }
}
