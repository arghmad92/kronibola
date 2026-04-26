import { readSheet, writeSheet, appendRow, json } from '../_sheets.js';
import { verifyToken } from './auth.js';

const HEADERS = ['Username', 'Display Name', 'Date From', 'Date To', 'Reason', 'Created At'];

function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function isYmd(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function onRequest(context) {
  const token = context.request.headers.get('Authorization') || '';
  const session = await verifyToken(token, context.env.ADMIN_PASSWORD);
  if (!session) return json({ error: 'Unauthorized' }, 401);

  const method = context.request.method;

  if (method === 'GET') {
    try {
      let leaves = [];
      try { leaves = await readSheet(context.env, 'Admin Leave'); } catch { leaves = []; }
      return json({ leaves });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  if (method === 'POST') {
    // Apply for leave. Server stamps Username + Display Name from the token —
    // body cannot override these (no impersonation via per-admin login).
    if (session.isOwner) {
      return json({ error: 'Pick a real admin to apply for leave. Owner-override sessions can manage admins but not submit leave on someone else\u2019s behalf.' }, 403);
    }
    try {
      const body = await context.request.json();
      const dateFrom = String((body && body.dateFrom) || '');
      const dateTo = String((body && body.dateTo) || dateFrom);
      const reason = String((body && body.reason) || '').trim().slice(0, 200);

      if (!isYmd(dateFrom)) return json({ error: 'Invalid "Date From" — expected YYYY-MM-DD' }, 400);
      if (!isYmd(dateTo)) return json({ error: 'Invalid "Date To" — expected YYYY-MM-DD' }, 400);
      if (dateTo < dateFrom) return json({ error: '"Date To" must not be before "Date From"' }, 400);

      // Ensure header row exists on a fresh sheet.
      let existing = [];
      try { existing = await readSheet(context.env, 'Admin Leave'); }
      catch { await writeSheet(context.env, 'Admin Leave', [], HEADERS); }
      if (existing.length === 0) {
        // Sheet might have data but readSheet returns [] when only the
        // header row exists — that's fine, no special bootstrap needed.
      }

      await appendRow(context.env, 'Admin Leave', [
        session.username,
        session.displayName,
        dateFrom,
        dateTo,
        reason,
        nowIso(),
      ]);
      return json({ success: true });
    } catch (e) {
      console.error('admin/leave POST error:', e && e.stack ? e.stack : e);
      return json({ error: e.message || 'Save failed' }, 500);
    }
  }

  if (method === 'DELETE') {
    // Cancel a leave entry. Match by (Username + Created At) so we identify
    // the exact row — Created At is set server-side at append time so the
    // client just sends back what it received from GET.
    try {
      const body = await context.request.json();
      const createdAt = String((body && body.createdAt) || '').trim();
      if (!createdAt) return json({ error: '"createdAt" is required to cancel leave' }, 400);

      const me = session.username;
      let current = [];
      try { current = await readSheet(context.env, 'Admin Leave'); } catch { current = []; }

      const remaining = [];
      let removed = 0;
      for (const row of current) {
        const matches =
          String(row['Created At'] || '').trim() === createdAt &&
          String(row.Username || '').trim().toLowerCase() === me;
        if (matches && removed === 0) { removed++; continue; }
        remaining.push(row);
      }

      if (removed === 0) {
        return json({ error: 'Leave entry not found, or not yours to cancel.' }, 404);
      }

      await writeSheet(context.env, 'Admin Leave', remaining, HEADERS);
      return json({ success: true });
    } catch (e) {
      console.error('admin/leave DELETE error:', e && e.stack ? e.stack : e);
      return json({ error: e.message || 'Delete failed' }, 500);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
