import { readSheet, writeSheet, mergeRowsByKey, json } from '../_sheets.js';
import { verifyToken } from './auth.js';

// `Format` is blank for normal sessions, '3-team-11' for the 3-team
// 11-a-side position builder. Keep it last so existing rows just need
// one column appended.
const HEADERS = ['Session Name', 'Date', 'Time', 'Location', 'Fee', 'Status', 'Max Players', 'Require Car Plate', 'Format'];

export async function onRequest(context) {
  // Auth check — verifyToken now returns the parsed session payload
  // (or null on failure) so endpoints can attribute writes to a specific
  // admin. We don't need it here yet but keep the variable for parity.
  const token = context.request.headers.get('Authorization') || '';
  const session = await verifyToken(token, context.env.ADMIN_PASSWORD);
  if (!session) return json({ error: 'Unauthorized' }, 401);

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
      if (!Array.isArray(sessions)) return json({ error: 'Invalid payload: sessions must be an array' }, 400);

      // Re-read current sheet and merge by Date. Preserves cron-autoclose
      // Status updates that happened between page load and save. Admin can
      // still change any field — payload values always win on merge.
      const current = await readSheet(context.env, 'Sessions');
      const merged = mergeRowsByKey(current, sessions, 'Date');

      // Refuse to clear a non-empty sheet. Individual deletions still allowed.
      if (current.length > 0 && merged.length === 0) {
        return json({ error: 'Refusing to clear all sessions. Delete rows individually.' }, 409);
      }

      await writeSheet(context.env, 'Sessions', merged, HEADERS);
      return json({ success: true });
    } catch (e) {
      console.error('admin/sessions POST error:', e && e.stack ? e.stack : e);
      return json({ error: e.message || 'Save failed' }, 500);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
