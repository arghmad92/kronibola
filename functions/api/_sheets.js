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

  // Import private key
  const pem = credentials.private_key.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\n/g, '');
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

// Read a sheet
export async function readSheet(env, sheetName) {
  const creds = JSON.parse(env.GCP_CREDENTIALS);
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
  const creds = JSON.parse(env.GCP_CREDENTIALS);
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
  const creds = JSON.parse(env.GCP_CREDENTIALS);
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
