import { readSheet, json } from './_sheets.js';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const date = url.searchParams.get('date');

  try {
    const all = await readSheet(context.env, 'Registrations');
    const players = date ? all.filter((p) => String(p['Session Date']) === date) : all;
    return json({ players });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
