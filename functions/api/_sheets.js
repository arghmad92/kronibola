/**
 * Google Sheets API helper for Cloudflare Workers
 * Uses service account JWT authentication
 */

// Generate JWT for Google API auth
async function createJWT(credentials, scope) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: credentials.client_email,
    scope: scope || 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const enc = (obj) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsigned = `${enc(header)}.${enc(payload)}`;

  // Import private key — strip PEM headers, newlines, and whitespace
  const pem = (credentials.private_key || '')
    .replace(/\\n/g, '')
    .replace(/\n/g, '')
    .replace(/\r/g, '')
    .replace(/-/g, '')
    .replace(/BEGIN\s*PRIVATE\s*KEY/g, '')
    .replace(/END\s*PRIVATE\s*KEY/g, '')
    .replace(/BEGINPRIVATEKEY/g, '')
    .replace(/ENDPRIVATEKEY/g, '')
    .replace(/\s/g, '')
    .trim();

  const binaryKey = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);

  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return `${unsigned}.${sig}`;
}

// Fetch wrapper that throws on non-2xx so callers can't silently swallow
// Google API failures. Includes a truncated response body in the error to
// make Cloudflare Pages logs actionable.
async function sheetsFetch(url, init, context) {
  const res = await fetch(url, init);
  if (!res.ok) {
    let body = '';
    try { body = (await res.text()).slice(0, 500); } catch {}
    const err = new Error(`${context || 'sheetsFetch'} failed: ${res.status} ${res.statusText}${body ? ' - ' + body : ''}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res;
}

async function getAccessToken(credentials, scope) {
  const jwt = await createJWT(credentials, scope);
  const res = await sheetsFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  }, 'Google OAuth token');
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Google OAuth returned no access_token: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.access_token;
}

function parseCreds(raw) {
  // Cloudflare may store real newlines inside the JSON string value,
  // which breaks JSON.parse. Replace all real newlines with \\n first.
  try {
    return JSON.parse(raw);
  } catch {
    // Replace real newlines (that break JSON) with escaped \\n
    const fixed = raw.replace(/\n/g, '\\n').replace(/\r/g, '');
    return JSON.parse(fixed);
  }
}

// Read a sheet
export async function readSheet(env, sheetName) {
  const creds = parseCreds(env.GCP_CREDENTIALS);
  const token = await getAccessToken(creds);
  const spreadsheetId = env.SPREADSHEET_ID;

  const res = await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}`,
    { headers: { Authorization: `Bearer ${token}` } },
    `readSheet(${sheetName})`
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
  await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}:clear`,
    { method: 'POST', headers: authHeader, body: '{}' },
    `writeSheet.clear(${sheetName})`
  );

  // Write
  const values = [headers, ...records.map((r) => headers.map((h) => r[h] || ''))];
  await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}?valueInputOption=RAW`,
    { method: 'PUT', headers: authHeader, body: JSON.stringify({ values }) },
    `writeSheet.update(${sheetName})`
  );
}

// Append a row. Verifies that Google Sheets reports an updated range —
// otherwise we'd still be silently accepting a 200 with no write performed.
// Intentionally no retry: :append is not idempotent and we'd rather surface
// a 500 than risk a duplicate row (the caller's duplicate check ran before
// this write, so a retry wouldn't be caught).
export async function appendRow(env, sheetName, row) {
  const creds = parseCreds(env.GCP_CREDENTIALS);
  const token = await getAccessToken(creds);
  const spreadsheetId = env.SPREADSHEET_ID;

  const res = await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] }),
    },
    `appendRow(${sheetName})`
  );
  const data = await res.json().catch(() => ({}));
  if (!data.updates || !data.updates.updatedRange) {
    throw new Error(`appendRow(${sheetName}) returned no updatedRange: ${JSON.stringify(data).slice(0, 300)}`);
  }
}

// Merge incoming rows with current sheet state by a key field. For each
// incoming row, if a row with the same key exists in current state, missing
// fields are filled in from the existing row. This protects fields the admin
// never intended to modify (e.g. Car Plate on a registration) from being
// wiped by a stale client that loaded the page before those fields existed.
// Rows in current but not in incoming are dropped — admin intent is still to
// replace the sheet contents, just without inadvertently clearing columns.
export function mergeRowsByKey(current, incoming, keyField) {
  const byKey = new Map();
  for (const row of current) {
    const k = row && row[keyField];
    if (k) byKey.set(String(k), row);
  }
  return incoming.map((row) => {
    const k = row && row[keyField];
    if (!k) return row;
    const existing = byKey.get(String(k));
    if (!existing) return row;
    return { ...existing, ...row };
  });
}

// Get access token for any Google API scope
export async function getGoogleToken(env, scope) {
  const creds = parseCreds(env.GCP_CREDENTIALS);
  return getAccessToken(creds, scope);
}

// Handle CORS preflight OPTIONS requests
export function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://kronibola.com',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'https://kronibola.com' },
  });
}
