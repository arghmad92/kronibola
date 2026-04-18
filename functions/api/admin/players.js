import { readSheet, writeSheet, mergeRowsByKey, json } from '../_sheets.js';
import { verifyToken } from './auth.js';

const HEADERS = ['Session Date', 'Player Name', 'Phone', 'Payment Status', 'Amount', 'Timestamp', 'Ref Code', 'Refund', 'Car Plate'];

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
      if (!Array.isArray(players)) return json({ error: 'Invalid payload: players must be an array' }, 400);

      // Re-read current sheet and merge by Ref Code. Protects fields the
      // admin UI never modifies (Car Plate, Timestamp, Phone, etc.) from
      // being wiped if a stale client posts rows missing those keys.
      const current = await readSheet(context.env, 'Registrations');
      const merged = mergeRowsByKey(current, players, 'Ref Code');

      // Refuse to clear a non-empty sheet. Guards against a bug in the
      // client that posts an empty array (e.g. before loadAllPlayers()
      // finished). Individual deletions are still allowed.
      if (current.length > 0 && merged.length === 0) {
        return json({ error: 'Refusing to clear all registrations. Delete rows individually.' }, 409);
      }

      await writeSheet(context.env, 'Registrations', merged, HEADERS);
      return json({ success: true });
    } catch (e) {
      console.error('admin/players POST error:', e && e.stack ? e.stack : e);
      return json({ error: e.message || 'Save failed' }, 500);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
