/**
 * Cloudflare Scheduled Worker — runs on cron trigger.
 *
 * To enable, add to wrangler.toml:
 *   [triggers]
 *   crons = ["*/30 * * * *"]
 *
 * This auto-closes sessions that have already been played.
 */

import { readSheet, writeSheet } from './api/_sheets.js';

function parseTime(timeStr) {
  if (!timeStr) return null;
  const match = timeStr.trim().match(/^(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?$/i);
  if (!match) return null;
  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2] || '0');
  const period = (match[3] || '').toLowerCase();
  if (!match[2] && hours > 24) {
    const h = Math.floor(hours / 100);
    const m = hours % 100;
    return { hours: period === 'pm' && h < 12 ? h + 12 : h, minutes: m };
  }
  if (period === 'pm' && hours < 12) hours += 12;
  if (period === 'am' && hours === 12) hours = 0;
  return { hours, minutes };
}

function getSessionEndTime(session) {
  const date = session.Date;
  if (!date) return null;
  const timeStr = session.Time || '';
  const parts = timeStr.split('-').map(s => s.trim());
  let time = parts.length > 1 ? parseTime(parts[1]) : null;
  if (!time && parts.length > 0) {
    time = parseTime(parts[0]);
    if (time) time = { hours: time.hours + 2, minutes: time.minutes };
  }
  if (!time) return null;
  const dt = new Date(`${date}T${String(time.hours).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}:00+08:00`);
  return isNaN(dt.getTime()) ? null : dt;
}

export default {
  async scheduled(event, env, ctx) {
    const sessions = await readSheet(env, 'Sessions');
    if (!sessions.length) return;

    const now = new Date();
    let closedCount = 0;

    for (const session of sessions) {
      if (session.Status !== 'Open') continue;
      const endTime = getSessionEndTime(session);
      if (!endTime) continue;
      if (endTime < now) {
        session.Status = 'Closed';
        closedCount++;
      }
    }

    if (closedCount > 0) {
      const headers = ['Session Name', 'Date', 'Time', 'Location', 'Fee', 'Status', 'Max Players', 'Require Car Plate'];
      await writeSheet(env, 'Sessions', sessions, headers);
    }
  },
};
