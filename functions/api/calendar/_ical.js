/**
 * iCalendar (RFC 5545) generation helpers.
 *
 * Produces text/calendar payloads that iOS Calendar, Google Calendar,
 * Outlook, etc. can subscribe to via webcal:// URLs and refresh on a
 * schedule. UTC stamps so we don't need a VTIMEZONE block — clients
 * convert to the viewer's local time automatically.
 *
 * Underscored filename keeps Cloudflare Pages from routing this file.
 */

const KL_TZ_OFFSET_HOURS = 8;

// Per RFC 5545: escape backslash, comma, semicolon; collapse newlines to \n.
export function escapeText(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\r\n|\r|\n/g, '\\n');
}

// Per RFC 5545 §3.1: lines longer than 75 octets must be folded by inserting
// CRLF + a single whitespace. Count chars (not bytes) — adequate for ASCII +
// the few non-ASCII chars our events contain (emojis are mostly fine since
// iOS handles them).
export function fold(line) {
  if (line.length <= 75) return line;
  const parts = [];
  let i = 0;
  while (i < line.length) {
    parts.push((i === 0 ? '' : ' ') + line.slice(i, i + (i === 0 ? 75 : 74)));
    i += i === 0 ? 75 : 74;
  }
  return parts.join('\r\n');
}

// Date | string → iCal UTC stamp "YYYYMMDDTHHMMSSZ".
export function utcStamp(d) {
  const date = d instanceof Date ? d : new Date(d);
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// Convert a Malaysia-local date+time to a UTC iCal stamp. Inputs:
//   ymd:  "2026-04-26"
//   time: { hours: 21, minutes: 0 }    // 21:00 MY = 13:00 UTC
export function myDateTimeToUtcStamp(ymd, time) {
  const hh = String(time.hours).padStart(2, '0');
  const mm = String(time.minutes).padStart(2, '0');
  return utcStamp(new Date(`${ymd}T${hh}:${mm}:00+08:00`));
}

// All-day events use VALUE=DATE in YYYYMMDD form. End is EXCLUSIVE per RFC,
// so a single-day all-day event needs DTEND = DTSTART + 1 day.
export function dateOnly(ymd) {
  return String(ymd || '').replace(/-/g, '');
}

export function dateOnlyPlus(ymd, days = 1) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// Parse session time strings like "830pm", "10pm", "8:30pm", "21:00".
// Mirrors the parseTime in cron-autoclose.js so behaviour is consistent.
export function parseTime(raw) {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?$/i);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2] || '0', 10);
  const period = (m[3] || '').toLowerCase();
  // "830" parsed as 8:30
  if (!m[2] && hours > 24) {
    const h = Math.floor(hours / 100);
    const min = hours % 100;
    return { hours: period === 'pm' && h < 12 ? h + 12 : h, minutes: min };
  }
  if (period === 'pm' && hours < 12) hours += 12;
  if (period === 'am' && hours === 12) hours = 0;
  return { hours, minutes };
}

// Session.Time is typically "830pm-10pm" or "9pm". Returns {start, end} where
// end falls back to start+2h if unspecified.
export function sessionRange(session) {
  const parts = String(session.Time || '').split('-').map((p) => p.trim());
  const start = parts.length > 0 ? parseTime(parts[0]) : null;
  if (!start) return null;
  let end = parts.length > 1 ? parseTime(parts[1]) : null;
  if (!end) {
    end = { hours: (start.hours + 2) % 24, minutes: start.minutes };
  }
  return { start, end };
}

/**
 * Build a complete iCalendar document.
 *
 * @param {object} props
 * @param {string} props.name                  X-WR-CALNAME
 * @param {string} [props.description]         X-WR-CALDESC
 * @param {Array<object>} props.events
 *   Each event: { uid, stamp, start, end, summary, location?, description?,
 *                 url?, status?, categories?, allDay? }
 *   For allDay events: start/end should be YYYYMMDD strings; end EXCLUSIVE.
 *   For timed events: start/end should be UTC stamps "YYYYMMDDTHHMMSSZ".
 */
export function buildIcs(props) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KroniBola//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(props.name)}`,
    'X-WR-TIMEZONE:Asia/Kuala_Lumpur',
  ];
  if (props.description) lines.push(`X-WR-CALDESC:${escapeText(props.description)}`);

  for (const e of props.events || []) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.uid}`);
    lines.push(`DTSTAMP:${e.stamp}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${e.start}`);
      lines.push(`DTEND;VALUE=DATE:${e.end}`);
    } else {
      lines.push(`DTSTART:${e.start}`);
      lines.push(`DTEND:${e.end}`);
    }
    lines.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.status) lines.push(`STATUS:${e.status}`);
    if (e.categories) lines.push(`CATEGORIES:${e.categories}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// Wrap the iCal payload in a properly-headered Response.
// Cache 5 minutes — long enough to be kind to Sheets API, short enough that
// a calendar app refreshing hourly always gets recent data.
export function icsResponse(text) {
  return new Response(text, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Content-Disposition': 'inline; filename="kronibola.ics"',
    },
  });
}

// Date filter: include the past N days through the future. Past sessions
// are useful for "history at a glance" without polluting forever.
export function dateCutoff(daysAgo = 30) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}
