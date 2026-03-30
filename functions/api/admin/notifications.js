import { readSheet, appendRow, writeSheet, json } from '../_sheets.js';

const HEADERS = ['Timestamp', 'Player Name', 'Phone', 'Status', 'Session Date', 'Message', 'Sent By'];

export async function onRequest(context) {
  // Auth check
  const authHeader = context.request.headers.get('Authorization');
  if (!authHeader) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const method = context.request.method;

  if (method === 'GET') {
    try {
      const logs = await readSheet(context.env, 'Notifications');
      logs.sort((a, b) => (b.Timestamp || '').localeCompare(a.Timestamp || ''));
      return json({ logs });
    } catch (e) {
      // If sheet has no data or doesn't exist properly, return empty
      return json({ logs: [] });
    }
  }

  if (method === 'POST') {
    try {
      const { playerName, phone, status, date, message, sentBy } = await context.request.json();
      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

      // Try reading first to check if headers exist
      let hasData = false;
      try {
        const existing = await readSheet(context.env, 'Notifications');
        hasData = true;
      } catch {
        // No headers — write headers first
        await writeSheet(context.env, 'Notifications', [], HEADERS);
      }

      await appendRow(context.env, 'Notifications', [timestamp, playerName || '', phone || '', status || '', date || '', message || '', sentBy || 'Admin']);
      return json({ success: true });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
