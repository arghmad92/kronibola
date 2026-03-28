import { getGoogleToken, json } from './_sheets.js';

const RECEIPTS_FOLDER_ID = ''; // Will be created on first upload

async function getOrCreateFolder(token, parentId) {
  // Check if KroniBola Receipts folder exists
  const query = encodeURIComponent(`name='KroniBola Receipts' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();

  if (data.files && data.files.length > 0) return data.files[0].id;

  // Create folder
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'KroniBola Receipts',
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  const folder = await createRes.json();
  return folder.id;
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const { refCode, playerName, imageData, mimeType } = await context.request.json();

    if (!imageData || !refCode) return json({ error: 'Missing receipt data' }, 400);

    const token = await getGoogleToken(
      context.env,
      'https://www.googleapis.com/auth/drive.file'
    );

    const folderId = await getOrCreateFolder(token);

    // Convert base64 to binary
    const base64 = imageData.replace(/^data:[^;]+;base64,/, '');
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    const ext = (mimeType || 'image/jpeg').includes('png') ? 'png' : 'jpg';
    const fileName = `${refCode}_${playerName || 'receipt'}.${ext}`;

    // Upload using multipart upload
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

    return json({ success: true, fileId: result.id, link: result.webViewLink });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
