import { readSheet, appendRow, writeSheet, json } from '../_sheets.js';
import { verifyToken } from './auth.js';

const HEADERS = ['Timestamp', 'Player Name', 'Phone', 'Status', 'Session Date', 'Message', 'Sent By'];

export async function onRequest(context) {
  // Auth check — capture session so we can attribute the log row to the
  // logged-in admin instead of a hardcoded "Admin" string.
  const token = context.request.headers.get('Authorization') || '';
  const session = await verifyToken(token, context.env.ADMIN_PASSWORD);
  if (!session) return json({ error: 'Unauthorized' }, 401);

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

      // Sent By: prefer the logged-in admin's display name. Owner-override
      // sessions get tagged "OWNER" so the audit trail shows when the
      // shared password was used. The legacy `sentBy` body field is
      // honoured only as a last fallback (kept for backward compatibility
      // with any client that still posts it).
      const author = session.displayName || sentBy || 'Admin';
      await appendRow(context.env, 'Notifications', [timestamp, playerName || '', phone || '', status || '', date || '', message || '', author]);
      return json({ success: true });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
