import { json, getGoogleToken } from '../_sheets.js';

const HEADERS = ['Timestamp', 'Player Name', 'Phone', 'Status', 'Session Date', 'Message', 'Sent By'];

async function getRawSheet(env) {
  const token = await getGoogleToken(env, 'https://www.googleapis.com/auth/spreadsheets');
  const spreadsheetId = env.SPREADSHEET_ID;

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent('Notifications')}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return { values: data.values || [], token, spreadsheetId };
}

async function appendValues(token, spreadsheetId, rows) {
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent('Notifications')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    }
  );
}

export async function onRequest(context) {
  const method = context.request.method;

  if (method === 'GET') {
    try {
      const { values } = await getRawSheet(context.env);
      if (values.length < 2) return json({ logs: [] });

      const headers = values[0];
      const logs = values.slice(1).map((row) => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] || ''; });
        return obj;
      });

      // Sort newest first
      logs.sort((a, b) => (b.Timestamp || '').localeCompare(a.Timestamp || ''));
      return json({ logs });
    } catch (e) {
      return json({ logs: [], error: e.message });
    }
  }

  if (method === 'POST') {
    try {
      const { playerName, phone, status, date, message, sentBy } = await context.request.json();
      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

      const { values, token, spreadsheetId } = await getRawSheet(context.env);

      const rows = [];
      // If sheet is empty, add headers first
      if (values.length === 0) {
        rows.push(HEADERS);
      }
      rows.push([timestamp, playerName || '', phone || '', status || '', date || '', message || '', sentBy || 'Admin']);

      await appendValues(token, spreadsheetId, rows);
      return json({ success: true });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
