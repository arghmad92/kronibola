import { json } from './_sheets.js';

const TG_BOT_TOKEN = '8660743894:AAG_Sj6N1NE2faGOXBmR77cBhdvf_xPaehw';
const TG_CHAT_ID = '-5247564101';

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const { refCode, playerName, imageData, mimeType } = await context.request.json();
    if (!imageData || !refCode) return json({ error: 'Missing receipt data' }, 400);

    const base64 = imageData.replace(/^data:[^;]+;base64,/, '');
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    const ext = (mimeType || 'image/jpeg').includes('png') ? 'png' : 'jpg';
    const fileName = `${refCode}_${playerName || 'receipt'}.${ext}`;
    const caption = `🧾 Payment Receipt\n\nPlayer: ${playerName}\nRef: ${refCode}`;

    // Build multipart form data for Telegram sendPhoto
    const boundary = '----TgBound' + Date.now();

    // Create form parts as text
    const chatIdPart = `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${TG_CHAT_ID}\r\n`;
    const captionPart = `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`;
    const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${fileName}"\r\nContent-Type: ${mimeType || 'image/jpeg'}\r\n\r\n`;
    const ending = `\r\n--${boundary}--\r\n`;

    // Encode text parts
    const enc = new TextEncoder();
    const chatIdBytes = enc.encode(chatIdPart);
    const captionBytes = enc.encode(captionPart);
    const fileHeaderBytes = enc.encode(fileHeader);
    const endingBytes = enc.encode(ending);

    // Combine all parts into single buffer
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
      return json({ error: tgResult.description || 'Telegram upload failed' }, 500);
    }

    return json({ success: true });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
