import { readSheet, batchUpdateCells, json } from './_sheets.js';

// Normalised phone match — strips formatting and a leading 0, keeps the
// last 10 digits. Same logic the rest of the site uses (status.js,
// register.js phone storage), so users can type 0123-456-789 / 123456789
// / +60123456789 interchangeably and still match their stored value.
function normalizePhone(s) {
  return String(s || '').replace(/[-\s'+]/g, '').replace(/^0/, '').slice(-10);
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const body = await context.request.json();
    const refCode = String((body && body.refCode) || '').trim();
    const phone = String((body && body.phone) || '');
    const carPlate = String((body && body.carPlate) || '');

    if (!refCode) return json({ error: 'Missing ref code' }, 400);
    if (!phone) return json({ error: 'Phone number is required to verify ownership' }, 400);

    // Validate car plate format (same rules as registration + admin add).
    const cleaned = carPlate.replace(/\s/g, '').toUpperCase();
    if (!cleaned) return json({ error: 'Car plate is required' }, 400);
    if (cleaned.length < 2 || cleaned.length > 10) return json({ error: 'Car plate must be 2-10 characters' }, 400);
    if (!/^[A-Z0-9]+$/.test(cleaned)) return json({ error: 'Car plate must contain only letters and numbers' }, 400);
    if (!/[A-Z]/.test(cleaned) || !/[0-9]/.test(cleaned)) return json({ error: 'Car plate must contain at least 1 letter and 1 digit' }, 400);

    // Locate the registration and authenticate the requester.
    // Anyone can send a refCode (they're discoverable / shareable), but
    // mutating someone's plate now requires the requester to know the
    // phone the row was registered with. Generic 404 on mismatch so we
    // don't leak which condition failed.
    const players = await readSheet(context.env, 'Registrations');
    const idx = players.findIndex((p) => p['Ref Code'] === refCode);
    if (idx === -1) return json({ error: 'Registration not found' }, 404);

    const requesterPhone = normalizePhone(phone);
    const ownerPhone = normalizePhone(players[idx].Phone);
    if (!requesterPhone || requesterPhone !== ownerPhone) {
      return json({ error: 'Registration not found' }, 404);
    }

    // Update ONLY the Car Plate cell (column I = 9th column, 1-indexed).
    // Header row is row 1, data starts at row 2 → array index + 2.
    // batchUpdateCells leaves every other row + column untouched, so we
    // can't accidentally drop a registration that came in between our
    // read and write — the bug pattern we fixed elsewhere (flagOverdue,
    // admin saves) lived in this file too.
    await batchUpdateCells(context.env, [
      { range: `Registrations!I${idx + 2}`, values: [[cleaned]] },
    ]);

    return json({ success: true, carPlate: cleaned });
  } catch (e) {
    console.error('Update plate error:', e && e.stack ? e.stack : e);
    return json({ error: 'An error occurred. Please try again.' }, 500);
  }
}
