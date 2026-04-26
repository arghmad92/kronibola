import { readSheet, writeSheet, appendRow, json } from '../_sheets.js';
import { verifyToken } from './auth.js';
import { hashPassword } from './_password.js';

const HEADERS = ['Username', 'Display Name', 'Password Hash', 'Active', 'Created At'];

function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function normUsername(s) {
  return String(s || '').trim().toLowerCase();
}

function isValidUsername(u) {
  return /^[a-z0-9._-]{2,32}$/.test(u);
}

// Strip the password hash from rows we send back to the client. The hash
// should never leave the server even though the requester is authenticated.
function publicView(row) {
  return {
    Username: row.Username || '',
    'Display Name': row['Display Name'] || '',
    Active: row.Active || 'No',
    'Created At': row['Created At'] || '',
    hasPassword: Boolean(row['Password Hash']),
  };
}

export async function onRequest(context) {
  const token = context.request.headers.get('Authorization') || '';
  const session = await verifyToken(token, context.env.ADMIN_PASSWORD);
  if (!session) return json({ error: 'Unauthorized' }, 401);

  const method = context.request.method;

  if (method === 'GET') {
    try {
      let admins = [];
      try { admins = await readSheet(context.env, 'Admins'); } catch { admins = []; }
      return json({ admins: admins.map(publicView) });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  if (method === 'POST') {
    // Create a new admin. Body: { username, displayName, password, active? }
    try {
      const body = await context.request.json();
      const username = normUsername(body && body.username);
      const displayName = String((body && body.displayName) || '').trim();
      const password = String((body && body.password) || '');
      const active = String((body && body.active) || 'Yes');

      if (!isValidUsername(username)) return json({ error: 'Username must be 2–32 lowercase letters, digits, dot, underscore or dash' }, 400);
      if (!displayName) return json({ error: 'Display name is required' }, 400);
      if (password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

      const current = await readSheet(context.env, 'Admins').catch(() => []);
      const exists = current.some((r) => normUsername(r.Username) === username);
      if (exists) return json({ error: `Username "${username}" already exists` }, 409);

      // Ensure headers exist on a fresh sheet, then append.
      if (current.length === 0) {
        await writeSheet(context.env, 'Admins', [], HEADERS);
      }
      const hash = await hashPassword(password);
      await appendRow(context.env, 'Admins', [username, displayName, hash, active === 'No' ? 'No' : 'Yes', nowIso()]);
      return json({ success: true });
    } catch (e) {
      console.error('admin/admins POST error:', e && e.stack ? e.stack : e);
      return json({ error: e.message || 'Save failed' }, 500);
    }
  }

  if (method === 'PUT') {
    // Update an admin. Body: { username, displayName?, active?, password? }
    // Only the fields present in the body are changed; password rotates the
    // stored hash (and only the stored hash — display name and active stay
    // untouched unless their fields are also present).
    try {
      const body = await context.request.json();
      const username = normUsername(body && body.username);
      if (!username) return json({ error: 'Username is required' }, 400);

      const current = await readSheet(context.env, 'Admins').catch(() => []);
      const idx = current.findIndex((r) => normUsername(r.Username) === username);
      if (idx === -1) return json({ error: 'Admin not found' }, 404);

      const target = current[idx];
      const updated = { ...target };

      if (typeof body.displayName === 'string' && body.displayName.trim()) {
        updated['Display Name'] = body.displayName.trim();
      }
      if (typeof body.active === 'string') {
        updated.Active = body.active === 'No' ? 'No' : 'Yes';
      }
      if (typeof body.password === 'string' && body.password.length > 0) {
        if (body.password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);
        updated['Password Hash'] = await hashPassword(body.password);
      }

      // Guardrails: can't deactivate yourself if you're the last active admin
      // (would lock everyone out of the panel). Owner-override session can do
      // anything since it doesn't depend on this sheet.
      if (!session.isOwner && updated.Active === 'No' && normUsername(session.username) === username) {
        const otherActive = current.filter((r, i) =>
          i !== idx && String(r.Active || '').trim().toLowerCase() === 'yes'
        );
        if (otherActive.length === 0) {
          return json({ error: "You can't deactivate yourself — you're the last active admin." }, 409);
        }
      }

      const next = current.slice();
      next[idx] = updated;
      await writeSheet(context.env, 'Admins', next, HEADERS);
      return json({ success: true });
    } catch (e) {
      console.error('admin/admins PUT error:', e && e.stack ? e.stack : e);
      return json({ error: e.message || 'Save failed' }, 500);
    }
  }

  if (method === 'DELETE') {
    // Hard-delete by username. Owner can delete anyone except themselves
    // accidentally locking out (last-active check). Per-admin sessions can
    // only delete themselves OR another non-self user, but we still apply
    // the last-active guardrail.
    try {
      const body = await context.request.json();
      const username = normUsername(body && body.username);
      if (!username) return json({ error: 'Username is required' }, 400);

      const current = await readSheet(context.env, 'Admins').catch(() => []);
      const idx = current.findIndex((r) => normUsername(r.Username) === username);
      if (idx === -1) return json({ error: 'Admin not found' }, 404);

      const remaining = current.filter((_, i) => i !== idx);
      const remainingActive = remaining.filter((r) => String(r.Active || '').trim().toLowerCase() === 'yes');
      const targetIsActive = String(current[idx].Active || '').trim().toLowerCase() === 'yes';
      if (targetIsActive && remainingActive.length === 0 && !session.isOwner) {
        return json({ error: "You can't delete the last active admin." }, 409);
      }

      await writeSheet(context.env, 'Admins', remaining, HEADERS);
      return json({ success: true });
    } catch (e) {
      console.error('admin/admins DELETE error:', e && e.stack ? e.stack : e);
      return json({ error: e.message || 'Delete failed' }, 500);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
