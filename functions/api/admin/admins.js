import { readSheet, writeSheet, appendRow, json } from '../_sheets.js';
import { verifyToken } from './auth.js';
import { hashPassword } from './_password.js';

// `Role` is the new column added in this revision. `superadmin` is the only
// non-empty value that means anything; everything else is treated as a
// regular admin. Existing sheets without the column are fine — readSheet
// returns undefined and rows are treated as regular admins until a
// superadmin saves and the column is written for the first time.
const HEADERS = ['Username', 'Display Name', 'Password Hash', 'Active', 'Created At', 'Role'];
const ROLE_SUPERADMIN = 'superadmin';

function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function normUsername(s) {
  return String(s || '').trim().toLowerCase();
}

function normRole(s) {
  const v = String(s || '').trim().toLowerCase();
  return v === ROLE_SUPERADMIN ? ROLE_SUPERADMIN : '';
}

// "owner" is reserved for the env-var owner-override session in auth.js.
// Other names that could clash with audit display strings are also blocked.
const RESERVED_USERNAMES = new Set(['owner', 'admin', 'root', 'system']);

function isValidUsername(u) {
  return /^[a-z0-9._-]{2,32}$/.test(u);
}

function isReservedUsername(u) {
  return RESERVED_USERNAMES.has(u);
}

// Strip the password hash from rows we send back to the client. The hash
// should never leave the server even though the requester is authenticated.
function publicView(row) {
  return {
    Username: row.Username || '',
    'Display Name': row['Display Name'] || '',
    Active: row.Active || 'No',
    'Created At': row['Created At'] || '',
    Role: normRole(row.Role),
    hasPassword: Boolean(row['Password Hash']),
  };
}

// Check whether the given session can manage OTHER admins. Owner-override
// (env-var login) is always allowed; otherwise the session's username
// must have Role=superadmin in the Admins sheet.
// Exported so other admin endpoints (e.g. /admin/leave) can authoritatively
// gate privileged actions against the same source-of-truth check.
export async function isSuperadmin(env, session) {
  if (!session) return false;
  if (session.isOwner) return true;
  try {
    const admins = await readSheet(env, 'Admins');
    const me = admins.find((r) => normUsername(r.Username) === normUsername(session.username));
    return !!me && normRole(me.Role) === ROLE_SUPERADMIN;
  } catch {
    return false;
  }
}

const FORBIDDEN = (msg) => json({ error: msg || 'Only the superadmin can do this.' }, 403);

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
    // Create a new admin. Body: { username, displayName, password, active?, role? }
    // Restricted to superadmins (and owner override) — otherwise any
    // logged-in admin could create themselves a second account or
    // promote arbitrary names.
    if (!(await isSuperadmin(context.env, session))) return FORBIDDEN('Only the superadmin can create new admins.');
    try {
      const body = await context.request.json();
      const username = normUsername(body && body.username);
      const displayName = String((body && body.displayName) || '').trim();
      const password = String((body && body.password) || '');
      const active = String((body && body.active) || 'Yes');
      const role = normRole(body && body.role);

      if (!isValidUsername(username)) return json({ error: 'Username must be 2–32 lowercase letters, digits, dot, underscore or dash' }, 400);
      if (isReservedUsername(username)) return json({ error: `"${username}" is a reserved username — pick another` }, 400);
      if (!displayName) return json({ error: 'Display name is required' }, 400);
      if (password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

      const current = await readSheet(context.env, 'Admins').catch(() => []);
      const exists = current.some((r) => normUsername(r.Username) === username);
      if (exists) return json({ error: `Username "${username}" already exists` }, 409);

      // Schema-migrate fresh sheets (and existing 5-column sheets) by writing
      // the full HEADERS. Existing rows get the new Role column with empty
      // values when the next full writeSheet runs (PUT/DELETE paths).
      if (current.length === 0) {
        await writeSheet(context.env, 'Admins', [], HEADERS);
      }
      const hash = await hashPassword(password);
      await appendRow(context.env, 'Admins', [username, displayName, hash, active === 'No' ? 'No' : 'Yes', nowIso(), role]);
      return json({ success: true });
    } catch (e) {
      console.error('admin/admins POST error:', e && e.stack ? e.stack : e);
      return json({ error: e.message || 'Save failed' }, 500);
    }
  }

  if (method === 'PUT') {
    // Update an admin. Body: { username, displayName?, active?, password?, role? }
    //
    // Permission model:
    //   - Self-edit: you can change your own Display Name and your own
    //     Password. You can NOT change your own Active or Role (those would
    //     be privilege actions on yourself — superadmin's job).
    //   - Editing someone else: superadmin only. Non-superadmins get 403.
    try {
      const body = await context.request.json();
      const username = normUsername(body && body.username);
      if (!username) return json({ error: 'Username is required' }, 400);

      const isSelf = normUsername(session.username) === username;
      const isSA = await isSuperadmin(context.env, session);
      if (!isSelf && !isSA) return FORBIDDEN('Only the superadmin can edit other admins.');

      const current = await readSheet(context.env, 'Admins').catch(() => []);
      const idx = current.findIndex((r) => normUsername(r.Username) === username);
      if (idx === -1) return json({ error: 'Admin not found' }, 404);

      const target = current[idx];
      const updated = { ...target };

      if (typeof body.displayName === 'string' && body.displayName.trim()) {
        updated['Display Name'] = body.displayName.trim();
      }
      if (typeof body.password === 'string' && body.password.length > 0) {
        if (body.password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);
        updated['Password Hash'] = await hashPassword(body.password);
      }
      // Active and Role are privilege fields — only a superadmin can change
      // them, even when the target is themselves. Self-edit silently ignores
      // these fields if the requester isn't a superadmin.
      if (typeof body.active === 'string' && isSA) {
        updated.Active = body.active === 'No' ? 'No' : 'Yes';
      }
      if (typeof body.role === 'string' && isSA) {
        updated.Role = normRole(body.role);
      }

      // Guardrails: can't deactivate the last active admin OR demote the
      // last superadmin to a regular admin. Owner-override is excluded
      // from these checks (it's the recovery path, sheet state irrelevant).
      if (!session.isOwner) {
        if (updated.Active === 'No' && String(target.Active || '').trim().toLowerCase() === 'yes') {
          const otherActive = current.filter((r, i) =>
            i !== idx && String(r.Active || '').trim().toLowerCase() === 'yes'
          );
          if (otherActive.length === 0) {
            return json({ error: "Can't deactivate the last active admin." }, 409);
          }
        }
        if (
          normRole(target.Role) === ROLE_SUPERADMIN &&
          normRole(updated.Role) !== ROLE_SUPERADMIN
        ) {
          const otherSAs = current.filter((r, i) =>
            i !== idx && normRole(r.Role) === ROLE_SUPERADMIN
              && String(r.Active || '').trim().toLowerCase() === 'yes'
          );
          if (otherSAs.length === 0) {
            return json({ error: "Can't demote the last superadmin. Promote someone else first." }, 409);
          }
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
    // Hard-delete by username. Restricted to superadmins; the existing
    // last-active and last-superadmin guards apply.
    if (!(await isSuperadmin(context.env, session))) return FORBIDDEN('Only the superadmin can delete admins.');
    try {
      const body = await context.request.json();
      const username = normUsername(body && body.username);
      if (!username) return json({ error: 'Username is required' }, 400);

      const current = await readSheet(context.env, 'Admins').catch(() => []);
      const idx = current.findIndex((r) => normUsername(r.Username) === username);
      if (idx === -1) return json({ error: 'Admin not found' }, 404);

      const remaining = current.filter((_, i) => i !== idx);
      const remainingActive = remaining.filter((r) => String(r.Active || '').trim().toLowerCase() === 'yes');
      const target = current[idx];
      const targetIsActive = String(target.Active || '').trim().toLowerCase() === 'yes';
      if (targetIsActive && remainingActive.length === 0 && !session.isOwner) {
        return json({ error: "Can't delete the last active admin." }, 409);
      }
      if (normRole(target.Role) === ROLE_SUPERADMIN && !session.isOwner) {
        const otherSAs = remaining.filter((r) =>
          normRole(r.Role) === ROLE_SUPERADMIN
            && String(r.Active || '').trim().toLowerCase() === 'yes'
        );
        if (otherSAs.length === 0) {
          return json({ error: "Can't delete the last superadmin. Promote someone else first." }, 409);
        }
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
