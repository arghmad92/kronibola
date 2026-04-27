/**
 * Public match-schedule iCal feed.
 *
 * GET /api/calendar/matches
 * Returns text/calendar with one VEVENT per session (last 30 days +
 * everything in the future). Same data the public site already renders;
 * just delivered in a format Calendar apps can subscribe to.
 *
 * No auth — public schedule is public information. Cached for 5 min so
 * we're kind to Sheets API even if many clients refresh at once.
 */

import { readSheet } from '../_sheets.js';
import {
  buildIcs,
  icsResponse,
  utcStamp,
  myDateTimeToUtcStamp,
  sessionRange,
  dateCutoff,
} from './_ical.js';

export async function onRequest(context) {
  try {
    const sessions = await readSheet(context.env, 'Sessions');
    const cutoff = dateCutoff(30);
    const stamp = utcStamp(new Date());

    const events = [];
    for (const s of sessions) {
      if (!s.Date || s.Date < cutoff) continue;
      const range = sessionRange(s);
      if (!range) continue;

      const start = myDateTimeToUtcStamp(s.Date, range.start);
      // If the session crosses midnight (e.g. starts 11pm, ends 1am next
      // day), the end time we computed is "before" start in clock terms.
      // Bump the end date by 1 day in that case so iCal stays sane.
      let endDate = s.Date;
      if (range.end.hours < range.start.hours
          || (range.end.hours === range.start.hours && range.end.minutes < range.start.minutes)) {
        const d = new Date(`${s.Date}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        endDate = d.toISOString().slice(0, 10);
      }
      const end = myDateTimeToUtcStamp(endDate, range.end);

      const isClosed = String(s.Status || '').trim().toLowerCase() === 'closed';

      events.push({
        uid: `kb-game-${s.Date}@kronibola.com`,
        stamp,
        start,
        end,
        summary: `⚽ ${s['Session Name'] || 'KroniBola Match'}`,
        location: s.Location || '',
        description: [
          s.Fee ? `RM ${s.Fee} / pax` : '',
          s['Max Players'] ? `${s['Max Players']} slots` : '',
          'Register: https://kronibola.com',
        ].filter(Boolean).join('\n'),
        url: 'https://kronibola.com',
        status: isClosed ? 'CONFIRMED' : 'CONFIRMED',
        categories: 'Match',
      });
    }

    return icsResponse(buildIcs({
      name: 'KroniBola Matches',
      description: 'Upcoming KroniBola matches in the Klang Valley.',
      events,
    }));
  } catch (e) {
    console.error('matches.ics error:', e && e.stack ? e.stack : e);
    return new Response('Failed to generate calendar', { status: 500 });
  }
}
