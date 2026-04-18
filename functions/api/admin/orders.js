import { readSheet, writeSheet, mergeRowsByKey, json } from '../_sheets.js';
import { verifyToken } from './auth.js';

const HEADERS = ['Order Date', 'Player Name', 'Phone', 'Size', 'Quantity', 'Total', 'Payment Status', 'Timestamp', 'Ref Code', 'Delivery', 'Address'];

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
      if (!Array.isArray(orders)) return json({ error: 'Invalid payload: orders must be an array' }, 400);

      // Re-read current sheet and merge by Ref Code. Protects fields the
      // admin UI never modifies (Address, Timestamp, Size, etc.) from
      // being wiped if a stale client posts rows missing those keys.
      const current = await readSheet(context.env, 'Orders');
      const merged = mergeRowsByKey(current, orders, 'Ref Code');

      // Refuse to clear a non-empty sheet. Individual deletions still allowed.
      if (current.length > 0 && merged.length === 0) {
        return json({ error: 'Refusing to clear all orders. Delete rows individually.' }, 409);
      }

      await writeSheet(context.env, 'Orders', merged, HEADERS);
      return json({ success: true });
    } catch (e) {
      console.error('admin/orders POST error:', e && e.stack ? e.stack : e);
      return json({ error: e.message || 'Save failed' }, 500);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
