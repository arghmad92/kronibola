import { readSheet, appendRow, json } from '../_sheets.js';

export async function onRequest(context) {
  const method = context.request.method;

  if (method === 'GET') {
    try {
      const logs = await readSheet(context.env, 'Notifications');
      // Sort newest first
      logs.sort((a, b) => (b.Timestamp || '').localeCompare(a.Timestamp || ''));
      return json({ logs });
    } catch {
      // Sheet might not exist yet
      return json({ logs: [] });
    }
  }

  if (method === 'POST') {
    try {
      const { playerName, phone, status, date, message, sentBy } = await context.request.json();
      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
      // Columns: Timestamp, Player Name, Phone, Status, Session Date, Message, Sent By
      await appendRow(context.env, 'Notifications', [timestamp, playerName, phone, status, date, message, sentBy || 'Admin']);
      return json({ success: true });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
