import { readSheet, writeSheet, reconcileByKey, json } from '../_sheets.js';
import { verifyToken } from './auth.js';

const HEADERS = ['Order Date', 'Player Name', 'Phone', 'Size', 'Quantity', 'Total', 'Payment Status', 'Timestamp', 'Ref Code', 'Delivery', 'Address'];
// Fields the admin UI never edits on existing orders. If a stale client
// posts an empty string for one of these, treat it as "no change".
const PROTECTED = ['Order Date', 'Player Name', 'Phone', 'Size', 'Quantity', 'Total', 'Timestamp', 'Delivery', 'Address'];

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
      const body = await context.request.json();
      const orders = body && body.orders;
      const deletes = Array.isArray(body && body.deletes) ? body.deletes : [];
      if (!Array.isArray(orders)) return json({ error: 'Invalid payload: orders must be an array' }, 400);

      // Reconcile by Ref Code. Preserves rows not in the payload (protects
      // against concurrent orders placed after the admin loaded the page).
      const current = await readSheet(context.env, 'Orders');
      const result = reconcileByKey(current, orders, 'Ref Code', { deletes, protectedFields: PROTECTED });

      if (current.length > 0 && result.length === 0) {
        return json({ error: 'Refusing to clear all orders. Delete rows individually.' }, 409);
      }

      await writeSheet(context.env, 'Orders', result, HEADERS);
      return json({ success: true, orders: result });
    } catch (e) {
      console.error('admin/orders POST error:', e && e.stack ? e.stack : e);
      return json({ error: e.message || 'Save failed' }, 500);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
