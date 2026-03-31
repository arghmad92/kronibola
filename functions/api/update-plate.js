import { readSheet, writeSheet, json } from './_sheets.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const { refCode, carPlate } = await context.request.json();
    if (!refCode) return json({ error: 'Missing ref code' }, 400);

    // Validate car plate
    const cleaned = (carPlate || '').replace(/\s/g, '').toUpperCase();
    if (!cleaned) return json({ error: 'Car plate is required' }, 400);
    if (cleaned.length < 2 || cleaned.length > 10) return json({ error: 'Car plate must be 2-10 characters' }, 400);
    if (!/^[A-Z0-9]+$/.test(cleaned)) return json({ error: 'Car plate must contain only letters and numbers' }, 400);
    if (!/[A-Z]/.test(cleaned) || !/[0-9]/.test(cleaned)) return json({ error: 'Car plate must contain at least 1 letter and 1 digit' }, 400);

    // Find and update the registration
    const players = await readSheet(context.env, 'Registrations');
    const idx = players.findIndex(p => p['Ref Code'] === refCode);
    if (idx === -1) return json({ error: 'Registration not found' }, 404);

    players[idx]['Car Plate'] = cleaned;
    const headers = ['Session Date', 'Player Name', 'Phone', 'Payment Status', 'Amount', 'Timestamp', 'Ref Code', 'Refund', 'Car Plate'];
    await writeSheet(context.env, 'Registrations', players, headers);

    return json({ success: true, carPlate: cleaned });
  } catch (e) {
    console.error('Update plate error:', e);
    return json({ error: 'An error occurred. Please try again.' }, 500);
  }
}
