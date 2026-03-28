import { json } from './_sheets.js';

const FOLDER_ID = '1EZOtL2ekr63dYNpMvmd1qEx0zT_mY7D2';

function parseCreds(raw) {
  try { return JSON.parse(raw); } catch {
    return JSON.parse(raw.replace(/\n/g, '\\n').replace(/\r/g, ''));
  }
}

async function createJWT(credentials) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const enc = (obj) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsigned = `${enc(header)}.${enc(payload)}`;

  const pem = (credentials.private_key || '')
    .replace(/\\n/g, '').replace(/\n/g, '').replace(/\r/g, '')
    .replace(/-/g, '').replace(/BEGINPRIVATEKEY/g, '').replace(/ENDPRIVATEKEY/g, '')
    .replace(/BEGIN PRIVATE KEY/g, '').replace(/END PRIVATE KEY/g, '')
    .replace(/\s/g, '').trim();

  const binaryKey = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return `${unsigned}.${sig}`;
}

async function getAccessToken(credentials) {
  const jwt = await createJWT(credentials);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  return data.access_token;
}

export async function onRequest(context) {
  try {
    const creds = parseCreds(context.env.GCP_CREDENTIALS);
    const token = await getAccessToken(creds);

    const query = encodeURIComponent(`'${FOLDER_ID}' in parents and mimeType contains 'image/' and trashed = false`);
    const fields = encodeURIComponent('files(id,name,createdTime,description)');
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&orderBy=createdTime desc&pageSize=100`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const data = await res.json();
    if (data.error) return json({ error: data.error.message }, 500);

    const photos = (data.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      date: f.createdTime ? f.createdTime.split('T')[0] : '',
      caption: f.description || f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
      url: `https://drive.google.com/thumbnail?id=${f.id}&sz=w800`,
      fullUrl: `https://drive.google.com/thumbnail?id=${f.id}&sz=w1600`,
    }));

    return json({ photos });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
