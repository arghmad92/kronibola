import { readSheet, batchUpdateCells, json } from './_sheets.js';

// Flag overdue players as "Overdue" (soft warning, not rejection).
//
// IMPORTANT: this runs on every /api/players call, which is a public endpoint
// hit on normal page loads. The old implementation did a full writeSheet
// rewrite here, which caused two nasty bugs:
//   1. Its headers array was missing 'Car Plate', so every flag-and-write
//      blanked the Car Plate column across the entire sheet.
//   2. The read-then-full-rewrite window would drop any row appended
//      between the read and the write (e.g. a fresh registration would
//      vanish if someone else loaded a site page while flagOverdue was
//      persisting).
//
// Fix: use spreadsheets.values:batchUpdate to update ONLY the Payment Status
// cell of each row that's flipping. No full sheet rewrite — no car plate
// wipe, no concurrent-registration loss.
//
// Returns the (in-memory) mutated players array so the caller can render
// "Overdue" to the user immediately, even if the persist call fails.
async function flagOverdue(env, players) {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  const toFlagRefs = new Set();

  for (const p of players) {
    if (p['Payment Status'] !== 'Pending') continue;
    const ts = p['Timestamp'];
    if (!ts) continue;
    const parsed = new Date(ts.replace(' ', 'T') + 'Z').getTime();
    if (isNaN(parsed)) continue;
    if (now - parsed > ONE_HOUR) {
      p['Payment Status'] = 'Overdue';
      if (p['Ref Code']) toFlagRefs.add(p['Ref Code']);
    }
  }

  if (toFlagRefs.size === 0) return players;

  // Persist via targeted cell updates. Re-read right before the write to
  // pick up authoritative row indices (register.js only appends, so existing
  // indices are stable, but admin saves can reorder). We still verify the
  // current Payment Status === Pending before flipping, so we never clobber
  // an admin-set Paid/Waitlist status that raced in between.
  try {
    const fresh = await readSheet(env, 'Registrations');
    const updates = [];
    for (let i = 0; i < fresh.length; i++) {
      const p = fresh[i];
      if (toFlagRefs.has(p['Ref Code']) && p['Payment Status'] === 'Pending') {
        // Payment Status is column D (4th column of the Registrations sheet).
        // Header is row 1, data starts at row 2 → array index + 2.
        updates.push({ range: `Registrations!D${i + 2}`, values: [['Overdue']] });
      }
    }
    if (updates.length > 0) await batchUpdateCells(env, updates);
  } catch (e) {
    // Flagging is best-effort. Don't fail the read just because persistence failed.
    console.error('flagOverdue persist error:', e && e.stack ? e.stack : e);
  }

  return players;
}

// Public projection — what we let leave the server. The lineup and
// leaderboard only need name, status, and date; everything else is PII or
// internal admin data. Anyone calling /api/players (this is unauthenticated)
// gets only these fields. The admin equivalent /api/admin/players is auth-
// gated and returns the full row.
//
// Team / Position / Receipt are public on purpose — they drive the 3-team
// position builder (whose player sits on which slot, in which state).
// They're not PII; they're the whole point of the public pitch view.
function publicPlayer(p) {
  return {
    'Session Date': p['Session Date'] || '',
    'Player Name': p['Player Name'] || '',
    'Payment Status': p['Payment Status'] || '',
    'Team': p['Team'] || '',
    'Position': p['Position'] || '',
    'Receipt': p['Receipt'] || '',
  };
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const date = url.searchParams.get('date');

  try {
    let all = await readSheet(context.env, 'Registrations');
    all = await flagOverdue(context.env, all);
    const filtered = date ? all.filter((p) => String(p['Session Date']) === date) : all;

    // Aggregate momentum signal: how many real registrations landed in the
    // last 24h for this session. Single int — no per-player timestamps leave
    // the server, so publicPlayer's PII boundary is preserved.
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const recentJoins24h = filtered.reduce((n, p) => {
      if (p['Payment Status'] === 'Rejected') return n;
      const ts = p['Timestamp'];
      if (!ts) return n;
      const parsed = new Date(ts.replace(' ', 'T') + 'Z').getTime();
      return !isNaN(parsed) && now - parsed < DAY ? n + 1 : n;
    }, 0);

    return json({ players: filtered.map(publicPlayer), recentJoins24h });
  } catch (e) {
    console.error('Players error:', e);
    return json({ error: 'An error occurred. Please try again.' }, 500);
  }
}
