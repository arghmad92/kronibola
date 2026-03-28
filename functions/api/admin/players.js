import { readSheet, writeSheet, json } from '../_sheets.js';

export async function onRequest(context) {
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
      const headers = ['Session Date', 'Player Name', 'Phone', 'Payment Status', 'Amount', 'Timestamp'];
      await writeSheet(context.env, 'Registrations', players, headers);
      return json({ success: true });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
