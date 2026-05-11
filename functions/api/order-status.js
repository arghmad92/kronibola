import { readSheet, json } from './_sheets.js';
import { phoneMatches } from './_phone.js';

export async function onRequest(context) {
  try {
    const url = new URL(context.request.url);
    const phoneRaw = url.searchParams.get('phone') || '';
    const digitsOnly = phoneRaw.replace(/\D/g, '');
    if (digitsOnly.length < 7 || digitsOnly.length > 15) return json({ error: 'Valid phone number required' }, 400);

    const orders = await readSheet(context.env, 'Orders');
    const matches = orders.filter((o) => phoneMatches(o.Phone, phoneRaw));

    return json({
      orders: matches.map((m) => ({
        date: m['Order Date'],
        name: m['Player Name'],
        size: m.Size,
        quantity: m.Quantity,
        total: m.Total,
        status: m['Payment Status'],
        refCode: m['Ref Code'],
      })),
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
