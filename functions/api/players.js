import { readSheet, writeSheet, json } from './_sheets.js';

// Auto-reject players whose Payment Status is "Pending" and Timestamp is older than 1 hour
async function autoRejectOverdue(env, players) {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  let changed = false;

  for (const p of players) {
    if (p['Payment Status'] !== 'Pending') continue;
    const ts = p['Timestamp'];
    if (!ts) continue;
    // Timestamp format: "YYYY-MM-DD HH:MM:SS" (no timezone, treat as UTC)
    const parsed = new Date(ts.replace(' ', 'T') + 'Z').getTime();
    if (isNaN(parsed)) continue;
    if (now - parsed > ONE_HOUR) {
      p['Payment Status'] = 'Rejected';
      changed = true;
    }
  }

  if (changed) {
    const headers = ['Session Date', 'Player Name', 'Phone', 'Payment Status', 'Amount', 'Timestamp'];
    await writeSheet(env, 'Registrations', players, headers);
  }

  return players;
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const date = url.searchParams.get('date');

  try {
    let all = await readSheet(context.env, 'Registrations');
    all = await autoRejectOverdue(context.env, all);
    const players = date ? all.filter((p) => String(p['Session Date']) === date) : all;
    return json({ players });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
