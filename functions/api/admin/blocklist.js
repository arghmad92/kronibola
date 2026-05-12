/**
 * Admin CRUD for the BlockedPhones and BlockedIPs sheets.
 *
 *   GET    /api/admin/blocklist          → { phones: [...], ips: [...] }
 *   POST   /api/admin/blocklist          → body { kind, value, reason }
 *   DELETE /api/admin/blocklist?kind=&value=
 *
 * Phones are stored E.164 if possible. IPs are exact-match strings.
 * Empty/duplicate entries are silently dropped on add.
 */

import { readSheet, writeSheet, json } from '../_sheets.js';
import { verifyToken } from './auth.js';
import {
  PHONES_SHEET,
  IPS_SHEET,
  PHONES_HEADERS,
  IPS_HEADERS,
} from '../_blocklist.js';
import { phoneMatches } from '../_phone.js';

function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function isValidIp(s) {
  if (!s || typeof s !== 'string') return false;
  // Accept IPv4 and IPv6 (Cloudflare passes either). Loose check — exact
  // string match is what we use at lookup time, so we just need to keep
  // out obvious junk and SQL-injection-style payloads.
  return /^[0-9a-fA-F.:]{3,45}$/.test(s.trim());
}

export async function onRequest(context) {
  const token = context.request.headers.get('Authorization') || '';
  const session = await verifyToken(token, context.env.ADMIN_PASSWORD);
  if (!session) return json({ error: 'Unauthorized' }, 401);

  const method = context.request.method;

  if (method === 'GET') {
    try {
      const [phones, ips] = await Promise.all([
        readSheet(context.env, PHONES_SHEET).catch(() => []),
        readSheet(context.env, IPS_SHEET).catch(() => []),
      ]);
      return json({ phones, ips });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }

  if (method === 'POST') {
    try {
      const body = await context.request.json();
      const kind = body && body.kind;
      const value = body && body.value;
      const reason = (body && body.reason) || '';

      if (kind !== 'phone' && kind !== 'ip') return json({ error: 'kind must be phone or ip' }, 400);
      if (!value || typeof value !== 'string') return json({ error: 'value required' }, 400);
      if (kind === 'ip' && !isValidIp(value)) return json({ error: 'Invalid IP address' }, 400);

      const sheet = kind === 'phone' ? PHONES_SHEET : IPS_SHEET;
      const headers = kind === 'phone' ? PHONES_HEADERS : IPS_HEADERS;
      const field = kind === 'phone' ? 'Phone' : 'IP';
      const trimmed = value.trim();

      const current = await readSheet(context.env, sheet).catch(() => []);
      const exists = kind === 'phone'
        ? current.some((r) => phoneMatches(r.Phone, trimmed))
        : current.some((r) => String(r.IP || '').trim() === trimmed);
      if (exists) return json({ success: true, alreadyBlocked: true });

      const newRow = {
        [field]: trimmed,
        Reason: String(reason).slice(0, 200),
        'Blocked At': nowIso(),
        'Blocked By': session.displayName || session.username,
      };
      await writeSheet(context.env, sheet, [...current, newRow], headers);
      return json({ success: true });
    } catch (e) {
      console.error('blocklist POST:', e && e.stack ? e.stack : e);
      return json({ error: e.message || 'Add failed' }, 500);
    }
  }

  if (method === 'DELETE') {
    try {
      const url = new URL(context.request.url);
      const kind = url.searchParams.get('kind');
      const value = (url.searchParams.get('value') || '').trim();
      if (kind !== 'phone' && kind !== 'ip') return json({ error: 'kind must be phone or ip' }, 400);
      if (!value) return json({ error: 'value required' }, 400);

      const sheet = kind === 'phone' ? PHONES_SHEET : IPS_SHEET;
      const headers = kind === 'phone' ? PHONES_HEADERS : IPS_HEADERS;
      const current = await readSheet(context.env, sheet).catch(() => []);
      const next = kind === 'phone'
        ? current.filter((r) => !phoneMatches(r.Phone, value))
        : current.filter((r) => String(r.IP || '').trim() !== value);
      await writeSheet(context.env, sheet, next, headers);
      return json({ success: true });
    } catch (e) {
      console.error('blocklist DELETE:', e && e.stack ? e.stack : e);
      return json({ error: e.message || 'Delete failed' }, 500);
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
