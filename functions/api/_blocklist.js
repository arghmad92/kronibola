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

// --- IP matching with CIDR support ---
//
// IPv6 from residential ISPs is assigned as a /64 prefix per household,
// with the last 64 bits varying per device. Exact-match `/128` blocks
// only catch the same device on the same DHCP lease — useless after a
// router reboot or device switch. Storing rules as CIDR (e.g.
// `2001:f40:97e:9a5::/64`) and matching by prefix makes blocks actually
// stick to the household.

/**
 * Parse an IPv4 or IPv6 string to { val: BigInt, bits: 32|128 }.
 * Returns null on malformed input. Compact IPv6 (`::`) is expanded.
 */
function ipToBigInt(s) {
  if (!s || typeof s !== 'string') return null;
  s = s.trim();

  if (s.includes(':')) {
    // IPv6 — expand `::` shorthand to all 8 groups.
    const halves = s.split('::');
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    const full = [...left, ...Array(missing).fill('0'), ...right];
    if (full.length !== 8) return null;
    let big = 0n;
    for (const part of full) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(part || '0')) return null;
      big = (big << 16n) | BigInt(parseInt(part || '0', 16));
    }
    return { val: big, bits: 128 };
  }

  // IPv4
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let big = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = parseInt(part, 10);
    if (n < 0 || n > 255) return null;
    big = (big << 8n) | BigInt(n);
  }
  return { val: big, bits: 32 };
}

/**
 * True if `candidate` falls inside `rule`. Rule may be a bare IP (exact
 * match) or CIDR (`net/prefix`). Mismatched families (rule v4 vs
 * candidate v6) never match.
 */
export function ipMatches(rule, candidate) {
  if (!rule || !candidate) return false;
  const ruleStr = String(rule).trim();
  const candStr = String(candidate).trim();
  if (!ruleStr || !candStr) return false;

  const slash = ruleStr.indexOf('/');
  const net = slash === -1 ? ruleStr : ruleStr.slice(0, slash);
  const prefix = slash === -1 ? null : parseInt(ruleStr.slice(slash + 1), 10);

  const r = ipToBigInt(net);
  const c = ipToBigInt(candStr);
  if (!r || !c || r.bits !== c.bits) {
    // Last-resort string equality so a malformed entry can still match
    // its identical twin and admins can at least delete it.
    return slash === -1 && ruleStr.toLowerCase() === candStr.toLowerCase();
  }
  if (prefix === null) return r.val === c.val;
  if (isNaN(prefix) || prefix < 0 || prefix > r.bits) return false;
  if (prefix === r.bits) return r.val === c.val;
  const shift = BigInt(r.bits - prefix);
  return (r.val >> shift) === (c.val >> shift);
}

/**
 * Suggest the right CIDR granularity for a freshly-blocked IP.
 *   IPv6 → `/64` (the per-household prefix on consumer ISPs)
 *   IPv4 → exact (no slash) since IPv4 is usually NAT'd already
 * If the input already has a `/`, leave it alone.
 */
export function suggestCidr(ip) {
  const s = String(ip || '').trim();
  if (!s || s.includes('/')) return s;
  if (s.includes(':')) {
    // Collapse to the /64 network. Easier to drop the last 4 groups
    // than to compute the canonical form bit-precisely.
    const parsed = ipToBigInt(s);
    if (!parsed) return s;
    // Zero out lower 64 bits, then render.
    const networkVal = (parsed.val >> 64n) << 64n;
    return bigIntToIpv6(networkVal) + '/64';
  }
  return s; // IPv4 stays exact
}

function bigIntToIpv6(big) {
  const parts = [];
  for (let i = 7; i >= 0; i--) {
    const group = Number((big >> BigInt(i * 16)) & 0xFFFFn);
    parts.push(group.toString(16));
  }
  // Collapse longest run of zeros to ::. Cheap implementation.
  let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '0') {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) { bestStart = curStart; bestLen = curLen; }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  if (bestLen >= 2) {
    return parts.slice(0, bestStart).join(':') + '::' + parts.slice(bestStart + bestLen).join(':');
  }
  return parts.join(':');
}

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
      // ipMatches handles bare IPs (exact) and CIDR rules (prefix match).
      // Covers IPv6 /64 household blocks that survive router reboots.
      if (ipMatches(row.IP, ip)) {
        return { blocked: true, kind: 'ip', reason: row.Reason || '' };
      }
    }
  }
  return { blocked: false };
}
