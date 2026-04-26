/**
 * Auto-close sessions that have passed.
 *
 * Called by Cloudflare Cron Trigger every 30 minutes.
 * Can also be called manually: POST /api/cron-autoclose (requires admin token).
 *
 * Logic:
 *   For each session where Status === 'Open':
 *     1. Parse Date + end time (or start time + 2h buffer)
 *     2. If that time < now → set Status to 'Closed'
 *     3. Write updated sessions back to Google Sheets
 */

import { readSheet, writeSheet, json } from './_sheets.js';

// Parse time string like "830pm", "10pm", "8:30pm" into 24h hours/minutes
function parseTime(timeStr) {
  if (!timeStr) return null;
  const match = timeStr.trim().match(/^(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?$/i);
  if (!match) return null;
  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2] || '0');
  const period = (match[3] || '').toLowerCase();
  // Handle "830" as 8:30
  if (!match[2] && hours > 24) {
    const h = Math.floor(hours / 100);
    const m = hours % 100;
    return { hours: period === 'pm' && h < 12 ? h + 12 : h, minutes: m };
  }
  if (period === 'pm' && hours < 12) hours += 12;
  if (period === 'am' && hours === 12) hours = 0;
  return { hours, minutes };
}

// Get the session end timestamp (end time, or start time + 2 hours as fallback)
function getSessionEndTime(session) {
  const date = session.Date;
  if (!date) return null;

  const timeStr = session.Time || '';
  const parts = timeStr.split('-').map(s => s.trim());

  // Try end time first (e.g. "830pm-10pm" → "10pm")
  let time = parts.length > 1 ? parseTime(parts[1]) : null;

  // Fallback: start time + 2 hours
  if (!time && parts.length > 0) {
    time = parseTime(parts[0]);
    if (time) {
      time = { hours: time.hours + 2, minutes: time.minutes };
    }
  }

  if (!time) return null;

  const dt = new Date(`${date}T${String(time.hours).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}:00+08:00`);
  return isNaN(dt.getTime()) ? null : dt;
}

async function autoCloseSessions(env) {
  const sessions = await readSheet(env, 'Sessions');
  if (!sessions.length) return { closed: 0 };

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

  return { closed: closedCount, checked: sessions.length };
}

// HTTP handler — manual trigger via POST with admin auth
export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    const { handleOptions } = await import('./_sheets.js');
    return handleOptions();
  }

  // Only allow POST
  if (context.request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // Require admin token
  const { verifyToken } = await import('./admin/auth.js');
  const token = context.request.headers.get('Authorization') || '';
  const session = await verifyToken(token, context.env.ADMIN_PASSWORD);
  if (!session) return json({ error: 'Unauthorized' }, 401);

  try {
    const result = await autoCloseSessions(context.env);
    return json({ success: true, ...result });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// Export for Cloudflare Cron Trigger (scheduled event)
export async function onSchedule(event, env) {
  await autoCloseSessions(env);
}
