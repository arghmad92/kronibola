/**
 * Admin iCal feed.
 *
 * GET /api/calendar/admin?t=<signed-token>
 * Returns text/calendar with everything visible in the admin panel
 * Calendar tab: matches, holidays, school breaks, sports events,
 * and admin leave entries.
 *
 * Auth: HMAC-signed token in `t` query param (since calendar apps can't
 * send custom Authorization headers). Token signed with ADMIN_PASSWORD;
 * to revoke all admin feeds, rotate ADMIN_PASSWORD on Cloudflare.
 *
 * Cached for 5 min — keeps things fast without going stale.
 */

import { readSheet } from '../_sheets.js';
import {
  buildIcs,
  icsResponse,
  utcStamp,
  myDateTimeToUtcStamp,
  dateOnly,
  dateOnlyPlus,
  sessionRange,
  dateCutoff,
} from './_ical.js';
import { verifyCalendarToken } from './_token.js';

function isSchoolType(t) { return /school/i.test(String(t || '')); }
function isSportsType(t) { return /sports?|tournament/i.test(String(t || '')); }

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const token = url.searchParams.get('t') || '';
  const secret = context.env.ADMIN_PASSWORD;
  if (!secret) return new Response('Calendar feed not configured', { status: 500 });

  const ok = await verifyCalendarToken(token, secret);
  if (!ok) return new Response('Unauthorized', { status: 401 });

  try {
    // Read all four sheets in parallel; missing sheets are tolerated as
    // empty (e.g. Holidays / Admin Leave may not exist on a fresh install).
    const [sessions, holidays, leaves] = await Promise.all([
      readSheet(context.env, 'Sessions').catch(() => []),
      readSheet(context.env, 'Holidays').catch(() => []),
      readSheet(context.env, 'Admin Leave').catch(() => []),
    ]);

    const cutoff = dateCutoff(30);
    const stamp = utcStamp(new Date());
    const events = [];

    // Matches — same shape as the public feed.
    for (const s of sessions) {
      if (!s.Date || s.Date < cutoff) continue;
      const range = sessionRange(s);
      if (!range) continue;

      const start = myDateTimeToUtcStamp(s.Date, range.start);
      let endDate = s.Date;
      if (range.end.hours < range.start.hours
          || (range.end.hours === range.start.hours && range.end.minutes < range.start.minutes)) {
        const d = new Date(`${s.Date}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        endDate = d.toISOString().slice(0, 10);
      }
      const end = myDateTimeToUtcStamp(endDate, range.end);

      events.push({
        uid: `kb-game-${s.Date}@kronibola.com`,
        stamp,
        start,
        end,
        summary: `⚽ ${s['Session Name'] || 'Match'}`,
        location: s.Location || '',
        description: [
          s.Fee ? `RM ${s.Fee} / pax` : '',
          s['Max Players'] ? `${s['Max Players']} slots` : '',
          s.Status ? `Status: ${s.Status}` : '',
        ].filter(Boolean).join('\n'),
        url: 'https://kronibola.com',
        status: 'CONFIRMED',
        categories: 'Match',
      });
    }

    // Holidays / school breaks / sports events — all live in the Holidays
    // sheet, differentiated by Type. All-day events.
    for (const h of holidays) {
      if (!h.Date || h.Date < cutoff) continue;
      const sports = isSportsType(h.Type);
      const school = !sports && isSchoolType(h.Type);
      const prefix = sports ? '🏆 ' : school ? '🎒 ' : '🇲🇾 ';
      const kind = sports ? 'sport' : school ? 'school' : 'holiday';
      events.push({
        uid: `kb-${kind}-${h.Date}@kronibola.com`,
        stamp,
        start: dateOnly(h.Date),
        end: dateOnlyPlus(h.Date, 1),
        summary: `${prefix}${h.Name || (sports ? 'Sports Event' : school ? 'School Holiday' : 'Holiday')}`,
        description: h.Type || '',
        allDay: true,
        categories: sports ? 'Sports' : school ? 'School' : 'Holiday',
      });
    }

    // Admin leave — all-day events spanning Date From → Date To inclusive.
    for (const lv of leaves) {
      const from = String(lv['Date From'] || '');
      const to = String(lv['Date To'] || from);
      if (!from || from < cutoff) continue;
      const name = lv['Display Name'] || lv.Username || 'Admin';
      const reason = lv.Reason ? ` — ${lv.Reason}` : '';
      // iCal end is EXCLUSIVE for all-day events: a leave on a single day
      // (from === to) needs DTEND = from + 1.
      const endExclusive = dateOnlyPlus(to, 1);
      events.push({
        uid: `kb-leave-${(lv.Username || 'x')}-${(lv['Created At'] || from).replace(/[^0-9]/g, '')}@kronibola.com`,
        stamp,
        start: dateOnly(from),
        end: endExclusive,
        summary: `🛌 ${name} on leave${reason}`,
        description: `Applied: ${lv['Created At'] || ''}`,
        allDay: true,
        categories: 'Leave',
      });
    }

    return icsResponse(buildIcs({
      name: 'KroniBola Admin',
      description: 'All KroniBola events: matches, holidays, school breaks, sports events, admin leave.',
      events,
    }));
  } catch (e) {
    console.error('admin.ics error:', e && e.stack ? e.stack : e);
    return new Response('Failed to generate calendar', { status: 500 });
  }
}
