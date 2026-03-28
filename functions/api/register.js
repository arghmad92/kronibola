import { readSheet, appendRow, json } from './_sheets.js';

function generateRefCode(date, name) {
  const dd = date.slice(8, 10);
  const mm = date.slice(5, 7);
  const initial = (name || 'X')[0].toUpperCase();
  const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `KB-${mm}${dd}-${initial}${rand}`;
}

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
      (r) => String(r['Session Date']) === date && ['Paid', 'Pending', 'Overdue'].includes(r['Payment Status'])
    ).length;

    const status = activeCount >= maxPlayers ? 'Waitlist' : 'Pending';
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const cleanPhone = "'" + phone.replace(/[-\s]/g, '');
    const refCode = generateRefCode(date, name);

    // Columns: Session Date, Player Name, Phone, Payment Status, Amount, Timestamp, Ref Code, Refund
    await appendRow(context.env, 'Registrations', [date, name, cleanPhone, status, fee, timestamp, refCode, '']);

    return json({ success: true, status, refCode });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
