import { readSheet, appendRow, json } from './_sheets.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const { date, name, phone, fee, sessionName } = await context.request.json();
    if (!date || !name || !phone) return json({ error: 'Missing fields' }, 400);

    // Check duplicates
    const regs = await readSheet(context.env, 'Registrations');
    const taken = regs
      .filter((r) => String(r['Session Date']) === date)
      .map((r) => String(r['Player Name']).toLowerCase().trim());

    if (taken.includes(name.toLowerCase().trim())) {
      return json({ error: `Name "${name}" is already taken!` }, 400);
    }

    // Check if full
    const sessions = await readSheet(context.env, 'Sessions');
    const session = sessions.find((s) => s.Date === date);
    const maxPlayers = session ? parseInt(session['Max Players']) || 20 : 20;
    const activeCount = regs.filter(
      (r) => String(r['Session Date']) === date && ['Paid', 'Pending'].includes(r['Payment Status'])
    ).length;

    const status = activeCount >= maxPlayers ? 'Waitlist' : 'Pending';
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const cleanPhone = "'" + phone.replace(/[-\s]/g, '');

    await appendRow(context.env, 'Registrations', [date, name, cleanPhone, status, fee, timestamp]);

    return json({ success: true, status });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
