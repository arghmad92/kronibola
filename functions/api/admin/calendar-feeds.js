/**
 * Returns the calendar-feed URLs for the logged-in admin to subscribe.
 *
 * GET /api/admin/calendar-feeds   (admin auth required)
 *   → {
 *       matches: "https://.../api/calendar/matches",
 *       admin:   "https://.../api/calendar/admin?t=<signed>",
 *       webcalMatches: "webcal://.../api/calendar/matches",
 *       webcalAdmin:   "webcal://.../api/calendar/admin?t=<signed>"
 *     }
 *
 * Server-side only — the signed token is computed from ADMIN_PASSWORD,
 * which never leaves the server. The client renders the resulting URLs
 * for admins to copy or tap.
 */

import { json } from '../_sheets.js';
import { verifyToken } from './auth.js';
import { generateCalendarToken } from '../calendar/_token.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return json({ error: 'GET only' }, 405);

  const token = context.request.headers.get('Authorization') || '';
  const session = await verifyToken(token, context.env.ADMIN_PASSWORD);
  if (!session) return json({ error: 'Unauthorized' }, 401);

  const secret = context.env.ADMIN_PASSWORD;
  if (!secret) return json({ error: 'Admin not configured' }, 500);

  const calToken = await generateCalendarToken(secret);
  const reqUrl = new URL(context.request.url);
  const httpsOrigin = reqUrl.origin;
  // webcal:// is the iOS deep-link scheme; tapping it opens Calendar's
  // subscription confirmation dialog directly. Browsers fall back to https.
  const webcalOrigin = httpsOrigin.replace(/^https:/, 'webcal:').replace(/^http:/, 'webcal:');

  return json({
    matches:       `${httpsOrigin}/api/calendar/matches`,
    admin:         `${httpsOrigin}/api/calendar/admin?t=${encodeURIComponent(calToken)}`,
    webcalMatches: `${webcalOrigin}/api/calendar/matches`,
    webcalAdmin:   `${webcalOrigin}/api/calendar/admin?t=${encodeURIComponent(calToken)}`,
  });
}
