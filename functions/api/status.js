import { readSheet, json } from './_sheets.js';
import { phoneMatches } from './_phone.js';

// NOTE: Rate limiting should be configured via Cloudflare WAF rules in the dashboard.
// Recommended: set a rate limit of 20 requests per minute per IP on /api/status
// to prevent abuse and excessive Google Sheets API calls.

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const phoneRaw = url.searchParams.get('phone') || '';
  // Accept any format the user types — phoneMatches normalizes both sides.
  // Just check we got at least 7 digits to weed out junk input.
  const digitsOnly = phoneRaw.replace(/\D/g, '');
  if (digitsOnly.length < 7 || digitsOnly.length > 15) {
    return json({ error: 'Invalid phone number.' }, 400);
  }

  try {
    const all = await readSheet(context.env, 'Registrations');
    const sessions = await readSheet(context.env, 'Sessions');

    // Fuzzy match against stored Phone — handles legacy formats
    // (0123456789, 60123456789) as well as new E.164 (+60123456789).
    const matches = all.filter((p) => phoneMatches(p.Phone, phoneRaw));

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
