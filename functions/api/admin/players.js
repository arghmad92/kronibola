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
      const players = await readSheet(context.env, 'Registrations');
      return json({ players });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  if (method === 'POST') {
    try {
      const { players } = await context.request.json();
      const headers = ['Session Date', 'Player Name', 'Phone', 'Payment Status', 'Amount', 'Timestamp', 'Ref Code', 'Refund'];
      await writeSheet(context.env, 'Registrations', players, headers);
      return json({ success: true });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
