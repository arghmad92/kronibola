/**
 * Shared blocklist helpers — used by /api/register (to reject bad actors)
 * and /api/admin/blocklist (to manage the list).
 *
 * Two sheets, both admin-managed:
 *   BlockedPhones: Phone | Reason | Blocked At | Blocked By
 *   BlockedIPs:    IP    | Reason | Blocked At | Blocked By
 *
 * Sheets that don't exist (or read errors) are treated as empty — we
 * never want a blocklist outage to take down public registration.
 */

import { readSheet } from './_sheets.js';
import { phoneMatches } from './_phone.js';

export const PHONES_SHEET = 'BlockedPhones';
export const IPS_SHEET = 'BlockedIPs';
export const PHONES_HEADERS = ['Phone', 'Reason', 'Blocked At', 'Blocked By'];
export const IPS_HEADERS = ['IP', 'Reason', 'Blocked At', 'Blocked By'];

async function safeRead(env, sheetName) {
  try {
    return await readSheet(env, sheetName);
  } catch (e) {
    // Sheet missing or unreachable — fail-open so a misconfigured
    // blocklist can't take down registration.
    console.warn(`Blocklist read failed for ${sheetName}:`, e && e.message);
    return [];
  }
}

/**
 * Returns `{ blocked: true, reason }` if the registration should be rejected,
 * `{ blocked: false }` otherwise. Phone match is fuzzy (handles legacy
 * format variants); IP match is exact.
 */
export async function checkBlocked(env, { phone, ip }) {
  const [phones, ips] = await Promise.all([
    safeRead(env, PHONES_SHEET),
    safeRead(env, IPS_SHEET),
  ]);

  if (phone) {
    for (const row of phones) {
      if (phoneMatches(row.Phone, phone)) {
        return { blocked: true, kind: 'phone', reason: row.Reason || '' };
      }
    }
  }
  if (ip) {
    for (const row of ips) {
      if (row.IP && String(row.IP).trim() === ip) {
        return { blocked: true, kind: 'ip', reason: row.Reason || '' };
      }
    }
  }
  return { blocked: false };
}
