import { readSheet, json } from './_sheets.js';

export async function onRequest(context) {
  try {
    const url = new URL(context.request.url);
    const phone = (url.searchParams.get('phone') || '').replace(/[\s\-+'"]/g, '');
    if (!phone || !/^\d+$/.test(phone) || phone.length < 10 || phone.length > 15) return json({ error: 'Valid phone number required (10-15 digits)' }, 400);

    const orders = await readSheet(context.env, 'Orders');
    const matches = orders.filter((o) => {
      const oPhone = String(o.Phone || '').replace(/[\s\-+'"]/g, '');
      return oPhone === phone || oPhone.endsWith(phone.slice(-10)) || phone.endsWith(oPhone.slice(-10));
    });

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
