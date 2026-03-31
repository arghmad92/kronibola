import { readSheet, writeSheet, json } from '../_sheets.js';
import { verifyToken } from './auth.js';

export async function onRequest(context) {
  // Auth check
  const token = context.request.headers.get('Authorization') || '';
  const valid = await verifyToken(token, context.env.ADMIN_PASSWORD);
  if (!valid) return json({ error: 'Unauthorized' }, 401);

  const method = context.request.method;

  if (method === 'GET') {
    try {
      const sessions = await readSheet(context.env, 'Sessions');
      return json({ sessions });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  if (method === 'POST') {
    try {
      const { sessions } = await context.request.json();
      const headers = ['Session Name', 'Date', 'Time', 'Location', 'Fee', 'Status', 'Max Players', 'Require Car Plate'];
      await writeSheet(context.env, 'Sessions', sessions, headers);
      return json({ success: true });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
