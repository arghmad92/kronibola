import { readSheet, writeSheet, reconcileByKey, json } from '../_sheets.js';
import { verifyToken } from './auth.js';

const HEADERS = ['Date', 'Name', 'Type'];

export async function onRequest(context) {
  const token = context.request.headers.get('Authorization') || '';
  const session = await verifyToken(token, context.env.ADMIN_PASSWORD);
  if (!session) return json({ error: 'Unauthorized' }, 401);

  const method = context.request.method;

  if (method === 'GET') {
    try {
      let holidays = [];
      try { holidays = await readSheet(context.env, 'Holidays'); } catch { holidays = []; }
      return json({ holidays });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  if (method === 'POST') {
    // Reconcile by Date (which doubles as the natural key — only one holiday
    // entry per date is sensible). Same shape as Sessions: {holidays, deletes}.
    try {
      const body = await context.request.json();
      const holidays = body && body.holidays;
      const deletes = Array.isArray(body && body.deletes) ? body.deletes : [];
      if (!Array.isArray(holidays)) return json({ error: 'Invalid payload: holidays must be an array' }, 400);

      let current = [];
      try { current = await readSheet(context.env, 'Holidays'); } catch { current = []; }
      const result = reconcileByKey(current, holidays, 'Date', { deletes });

      // Refuse to clear a populated sheet unless the admin is explicitly
      // deleting every row via the deletes list.
      if (current.length > 0 && result.length === 0 && deletes.length === 0) {
        return json({ error: 'Refusing to clear all holidays. Delete rows individually.' }, 409);
      }

      // Ensure header row exists when seeding the sheet for the first time.
      if (current.length === 0 && result.length === 0) {
        await writeSheet(context.env, 'Holidays', [], HEADERS);
        return json({ success: true, holidays: [] });
      }

      await writeSheet(context.env, 'Holidays', result, HEADERS);
      return json({ success: true, holidays: result });
    } catch (e) {
      console.error('admin/holidays POST error:', e && e.stack ? e.stack : e);
      return json({ error: e.message || 'Save failed' }, 500);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
