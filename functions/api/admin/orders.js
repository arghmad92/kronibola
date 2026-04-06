import { readSheet, writeSheet, json } from '../_sheets.js';
import { verifyToken } from './auth.js';

export async function onRequest(context) {
  const token = context.request.headers.get('Authorization') || '';
  const valid = await verifyToken(token, context.env.ADMIN_PASSWORD);
  if (!valid) return json({ error: 'Unauthorized' }, 401);

  const method = context.request.method;

  if (method === 'GET') {
    try {
      const orders = await readSheet(context.env, 'Orders');
      return json({ orders });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  if (method === 'POST') {
    try {
      const { orders } = await context.request.json();
      const headers = ['Order Date', 'Player Name', 'Phone', 'Size', 'Quantity', 'Total', 'Payment Status', 'Timestamp', 'Ref Code'];
      await writeSheet(context.env, 'Orders', orders, headers);
      return json({ success: true });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
