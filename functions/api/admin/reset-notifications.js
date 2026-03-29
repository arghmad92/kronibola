import { writeSheet, json } from '../_sheets.js';

const HEADERS = ['Timestamp', 'Player Name', 'Phone', 'Status', 'Session Date', 'Message', 'Sent By'];

export async function onRequest(context) {
  try {
    await writeSheet(context.env, 'Notifications', [], HEADERS);
    return json({ success: true, message: 'Notifications sheet cleared and headers written' });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
