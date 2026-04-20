import { readSheet, writeSheet, reconcileByKey, json } from '../_sheets.js';
import { verifyToken } from './auth.js';

const HEADERS = ['Session Date', 'Player Name', 'Phone', 'Payment Status', 'Amount', 'Timestamp', 'Ref Code', 'Refund', 'Car Plate'];
// Fields the admin UI never edits on existing players. If a stale client
// posts an empty string for one of these, treat it as "no change" — this
// is what stopped the car-plate wipe after update-plate.js writes.
const PROTECTED = ['Session Date', 'Player Name', 'Phone', 'Amount', 'Timestamp', 'Car Plate'];

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
      const body = await context.request.json();
      const players = body && body.players;
      const deletes = Array.isArray(body && body.deletes) ? body.deletes : [];
      if (!Array.isArray(players)) return json({ error: 'Invalid payload: players must be an array' }, 400);

      // Re-read current sheet and reconcile by Ref Code. Rows in current but
      // not in the payload are PRESERVED unless explicitly listed in deletes.
      // Protects against: stale clients wiping Car Plate, concurrent
      // registrations getting dropped because admin's payload was out of date.
      const current = await readSheet(context.env, 'Registrations');
      const result = reconcileByKey(current, players, 'Ref Code', { deletes, protectedFields: PROTECTED });

      // Defensive guard: refuse to clear a non-empty sheet. With the new
      // reconcile, this only fires if the admin explicitly deleted every
      // single row via the deletes list.
      if (current.length > 0 && result.length === 0) {
        return json({ error: 'Refusing to clear all registrations. Delete rows individually.' }, 409);
      }

      await writeSheet(context.env, 'Registrations', result, HEADERS);
      // Return the reconciled state so the client can refresh its in-memory
      // copy and show any concurrent registrations it didn't know about.
      return json({ success: true, players: result });
    } catch (e) {
      console.error('admin/players POST error:', e && e.stack ? e.stack : e);
      return json({ error: e.message || 'Save failed' }, 500);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
