import { readSheet, json } from './_sheets.js';

export async function onRequest(context) {
  try {
    const photos = await readSheet(context.env, 'Gallery');
    // Sort by date descending (newest first)
    photos.sort((a, b) => {
      const da = new Date(a['Date'] || '');
      const db = new Date(b['Date'] || '');
      return db - da;
    });
    return json({ photos });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
