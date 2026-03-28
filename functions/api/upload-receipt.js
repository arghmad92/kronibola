import { getGoogleToken, json } from './_sheets.js';

const TG_BOT_TOKEN = '8660743894:AAG_Sj6N1NE2faGOXBmR77cBhdvf_xPaehw';
const TG_CHAT_ID = '-5247564101';

async function getOrCreateFolder(token) {
  const query = encodeURIComponent(`name='KroniBola Receipts' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  if (data.files && data.files.length > 0) return data.files[0].id;

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'KroniBola Receipts', mimeType: 'application/vnd.google-apps.folder' }),
  });
  const folder = await createRes.json();
  return folder.id;
}

async function sendReceiptToTelegram(base64, mimeType, refCode, playerName) {
  try {
    // Convert base64 to blob for Telegram
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    const ext = (mimeType || 'image/jpeg').includes('png') ? 'png' : 'jpg';
    const fileName = `${refCode}.${ext}`;
    const caption = `🧾 Payment Receipt\n\nPlayer: ${playerName}\nRef: ${refCode}`;

    // Use multipart form data for Telegram sendPhoto
    const boundary = '----TgBoundary' + Date.now();
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${TG_CHAT_ID}`,
      `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}`,
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${fileName}"\r\nContent-Type: ${mimeType || 'image/jpeg'}\r\n\r\n`,
    ];

    // Build the body manually with binary data
    const textEncoder = new TextEncoder();
    const prefix = textEncoder.encode(parts.join(''));
    const suffix = textEncoder.encode(`\r\n--${boundary}--\r\n`);

    const body = new Uint8Array(prefix.length + bytes.length + suffix.length);
    body.set(prefix, 0);
    body.set(bytes, prefix.length);
    body.set(suffix, prefix.length + bytes.length);

    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: body.buffer,
    });
  } catch {}
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const { refCode, playerName, imageData, mimeType } = await context.request.json();
    if (!imageData || !refCode) return json({ error: 'Missing receipt data' }, 400);

    const base64 = imageData.replace(/^data:[^;]+;base64,/, '');

    // Upload to Google Drive
    const token = await getGoogleToken(context.env, 'https://www.googleapis.com/auth/drive.file');
    const folderId = await getOrCreateFolder(token);

    const ext = (mimeType || 'image/jpeg').includes('png') ? 'png' : 'jpg';
    const fileName = `${refCode}_${playerName || 'receipt'}.${ext}`;

    const metadata = JSON.stringify({
      name: fileName,
      parents: [folderId],
      description: `Payment receipt for ${refCode} - ${playerName}`,
    });

    const boundary = '---kronibola-upload---';
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      metadata,
      `--${boundary}`,
      `Content-Type: ${mimeType || 'image/jpeg'}`,
      'Content-Transfer-Encoding: base64',
      '',
      base64,
      `--${boundary}--`,
    ].join('\r\n');

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );

    const result = await uploadRes.json();
    if (result.error) return json({ error: result.error.message }, 500);

    // Send receipt photo to Telegram group
    await sendReceiptToTelegram(base64, mimeType, refCode, playerName);

    return json({ success: true, fileId: result.id, link: result.webViewLink });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
