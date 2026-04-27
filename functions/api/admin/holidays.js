import { readSheet, writeSheet, reconcileByKey, json } from '../_sheets.js';
import { verifyToken } from './auth.js';
import { isSuperadmin } from './admins.js';

const HEADERS = ['Date', 'Name', 'Type'];

// Regular admins can only mutate "Sports" rows (community-sourced events).
// Superadmins can do anything. Federal / State / School / Custom holidays
// are calendar-of-truth and stay locked to superadmins.
function isSportsType(type) {
  return /sports?|tournament/i.test(String(type || ''));
}

// Walk the diff between current sheet state and the requested payload to
// determine whether a regular admin is overstepping their permissions.
// Returns null if the change is allowed, or an error message string if not.
function checkRegularAdminPermissions(current, incoming, deletes) {
  const currentMap = new Map();
  for (const row of current) if (row.Date) currentMap.set(String(row.Date), row);
  const incomingMap = new Map();
  for (const row of incoming) if (row.Date) incomingMap.set(String(row.Date), row);
  const deleteSet = new Set((deletes || []).map(String));

  // Deletions: row's existing Type must be Sports.
  for (const date of deleteSet) {
    const row = currentMap.get(String(date));
    if (row && !isSportsType(row.Type)) {
      return `Only the superadmin can remove "${row.Type || 'this'}" entries.`;
    }
  }

  // Additions and edits.
  for (const [date, incRow] of incomingMap) {
    const curRow = currentMap.get(String(date));
    if (!curRow) {
      // New row — must be Sports.
      if (!isSportsType(incRow.Type)) {
        return `Regular admins can only add Sports events. Type "${incRow.Type || 'unspecified'}" requires superadmin.`;
      }
    } else {
      // Possible edit — both old and new Type must be Sports.
      const changed = ['Name', 'Type'].some((f) =>
        String(curRow[f] || '') !== String(incRow[f] || '')
      );
      if (changed) {
        if (!isSportsType(curRow.Type)) {
          return `Only the superadmin can edit "${curRow.Type}" entries.`;
        }
        if (!isSportsType(incRow.Type)) {
          return `Regular admins can't promote a Sports event to "${incRow.Type}".`;
        }
      }
    }
  }

  return null;
}

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
    // Permission model:
    //   - Superadmin: can add/edit/remove any holiday or event.
    //   - Regular admin: can ONLY add/edit/remove rows whose Type is Sports
    //     (community-sourced "heads up" events). Federal/State/School/Custom
    //     are authoritative and stay locked to superadmins.
    // Reconcile by Date (which doubles as the natural key — only one row
    // per date). Same payload shape as Sessions: {holidays, deletes}.
    try {
      const body = await context.request.json();
      const holidays = body && body.holidays;
      const deletes = Array.isArray(body && body.deletes) ? body.deletes : [];
      if (!Array.isArray(holidays)) return json({ error: 'Invalid payload: holidays must be an array' }, 400);

      let current = [];
      try { current = await readSheet(context.env, 'Holidays'); } catch { current = []; }

      // Permission gate based on the requested diff.
      if (!(await isSuperadmin(context.env, session))) {
        const denial = checkRegularAdminPermissions(current, holidays, deletes);
        if (denial) return json({ error: denial }, 403);
      }

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
