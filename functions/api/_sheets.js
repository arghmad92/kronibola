/**
 * Google Sheets API helper for Cloudflare Workers
 * Uses service account JWT authentication
 */

// Generate JWT for Google API auth
async function createJWT(credentials) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const enc = (obj) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsigned = `${enc(header)}.${enc(payload)}`;

  // Import private key — handle both real newlines and literal \n
  let rawKey = credentials.private_key || '';
  // Normalize: replace literal \n with real newlines, then strip PEM headers and whitespace
  rawKey = rawKey.replace(/\\n/g, '\n');
  const pem = rawKey
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/[\n\r\s]/g, '')
    .trim();

  // Pad base64 if needed
  const padded = pem + '='.repeat((4 - (pem.length % 4)) % 4);
  const binaryKey = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
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

function parseCreds(raw) {
  // Handle escaped newlines in private_key that Cloudflare may mangle
  const fixed = raw.replace(/\\n/g, '\n');
  try {
    return JSON.parse(fixed);
  } catch {
    // Try replacing literal newlines inside the key
    return JSON.parse(raw.replace(/\n/g, '\\n'));
  }
}

// Read a sheet
export async function readSheet(env, sheetName) {
  const creds = parseCreds(env.GCP_CREDENTIALS);
  const token = await getAccessToken(creds);
  const spreadsheetId = env.SPREADSHEET_ID;

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  const rows = data.values || [];
  if (rows.length < 2) return [];

  const headers = rows[0];
  return rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ''; });
    return obj;
  });
}

// Write entire sheet (clear + write)
export async function writeSheet(env, sheetName, records, headers) {
  const creds = parseCreds(env.GCP_CREDENTIALS);
  const token = await getAccessToken(creds);
  const spreadsheetId = env.SPREADSHEET_ID;
  const authHeader = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Clear
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}:clear`,
    { method: 'POST', headers: authHeader, body: '{}' }
  );

  // Write
  const values = [headers, ...records.map((r) => headers.map((h) => r[h] || ''))];
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}?valueInputOption=RAW`,
    { method: 'PUT', headers: authHeader, body: JSON.stringify({ values }) }
  );
}

// Append a row
export async function appendRow(env, sheetName, row) {
  const creds = parseCreds(env.GCP_CREDENTIALS);
  const token = await getAccessToken(creds);
  const spreadsheetId = env.SPREADSHEET_ID;

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] }),
    }
  );
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
