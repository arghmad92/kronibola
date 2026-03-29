import { readSheet, writeSheet, appendRow, json } from '../_sheets.js';

const HEADERS = ['Timestamp', 'Player Name', 'Phone', 'Status', 'Session Date', 'Message', 'Sent By'];

async function ensureHeaders(env) {
  try {
    const data = await readSheet(env, 'Notifications');
    return data;
  } catch {
    // Sheet exists but has no headers — write headers first
    await writeSheet(env, 'Notifications', [], HEADERS);
    return [];
  }
}

export async function onRequest(context) {
  const method = context.request.method;

  if (method === 'GET') {
    try {
      const logs = await ensureHeaders(context.env);
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

      // Ensure headers exist
      await ensureHeaders(context.env);

      await appendRow(context.env, 'Notifications', [timestamp, playerName, phone, status, date, message, sentBy || 'Admin']);
      return json({ success: true });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
