import { readSheet, writeSheet, json } from './_sheets.js';

// One-time cleanup: title-case player names, uppercase car plates
// Call once via: POST /api/cleanup-names
// Delete this file after running
export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const players = await readSheet(context.env, 'Registrations');
    let changed = 0;

    for (const p of players) {
      // Title case name
      const name = (p['Player Name'] || '').trim();
      const titleCased = name.replace(/\s+/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      if (titleCased !== name) {
        p['Player Name'] = titleCased;
        changed++;
      }

      // Uppercase car plate
      const plate = (p['Car Plate'] || '').trim();
      const upperPlate = plate.replace(/\s/g, '').toUpperCase();
      if (upperPlate !== plate) {
        p['Car Plate'] = upperPlate;
        changed++;
      }
    }

    if (changed > 0) {
      const headers = ['Session Date', 'Player Name', 'Phone', 'Payment Status', 'Amount', 'Timestamp', 'Ref Code', 'Refund', 'Car Plate'];
      await writeSheet(context.env, 'Registrations', players, headers);
    }

    return json({ success: true, recordsUpdated: changed, totalRecords: players.length });
  } catch (e) {
    console.error('Cleanup error:', e);
    return json({ error: 'Cleanup failed' }, 500);
  }
}
