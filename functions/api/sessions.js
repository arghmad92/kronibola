import { readSheet, json } from './_sheets.js';

export async function onRequest(context) {
  try {
    const sessions = await readSheet(context.env, 'Sessions');
    return json({ sessions });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
