import { readSheet, json } from './_sheets.js';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const phone = (url.searchParams.get('phone') || '').replace(/[-\s']/g, '');

  if (!phone || phone.length < 10) return json({ error: 'Invalid phone number' }, 400);

  try {
    const all = await readSheet(context.env, 'Registrations');
    const sessions = await readSheet(context.env, 'Sessions');

    // Match by phone (strip leading ' and compare last 10 digits)
    const cleanPhone = phone.replace(/^0/, '').slice(-10);
    const matches = all.filter((p) => {
      const pPhone = String(p.Phone || '').replace(/[-\s']/g, '').replace(/^0/, '').slice(-10);
      return pPhone === cleanPhone;
    });

    // Enrich with session details
    const results = matches.map((m) => {
      const session = sessions.find((s) => s.Date === m['Session Date']);
      return {
        name: m['Player Name'],
        phone: m.Phone,
        date: m['Session Date'],
        status: m['Payment Status'],
        fee: m.Amount,
        timestamp: m.Timestamp,
        sessionName: session ? session['Session Name'] : '',
        location: session ? session.Location : '',
        time: session ? session.Time : '',
      };
    });

    // Also return the player name for auto-fill
    const knownName = matches.length > 0 ? matches[matches.length - 1]['Player Name'] : '';

    return json({ registrations: results, knownName });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
