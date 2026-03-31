import { readSheet, json } from './_sheets.js';

// NOTE: Rate limiting should be configured via Cloudflare WAF rules in the dashboard.
// Recommended: set a rate limit of 20 requests per minute per IP on /api/status
// to prevent abuse and excessive Google Sheets API calls.

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const phone = (url.searchParams.get('phone') || '').replace(/[-\s']/g, '');

  // Validate phone: must be digits only after cleaning, 10-15 characters
  if (!phone || !/^\d+$/.test(phone) || phone.length < 10 || phone.length > 15) {
    return json({ error: 'Invalid phone number. Must be 10-15 digits.' }, 400);
  }

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
        refCode: m['Ref Code'] || '',
        carPlate: m['Car Plate'] || '',
        sessionName: session ? session['Session Name'] : '',
        location: session ? session.Location : '',
        time: session ? session.Time : '',
        requireCarPlate: session ? session['Require Car Plate'] === 'Yes' : false,
      };
    });

    // Also return the player name for auto-fill
    const knownName = matches.length > 0 ? matches[matches.length - 1]['Player Name'] : '';

    return json({ registrations: results, knownName });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
