import { getGoogleToken, json } from './_sheets.js';

const FOLDER_ID = '1P5a06gF5ZE9okLGgiTAdZYUsvDUbDkTp';

// A file is treated as a "highlight" if its Drive description contains any
// of these markers. Highlights float to the top of the gallery; everything
// else is ordered by createdTime desc. To curate, open the photo in Drive
// and add ★ (or ⭐ / [highlight]) anywhere in the description.
const HIGHLIGHT_MARKERS = ['★', '⭐', '[highlight]', '[hl]'];
function isHighlight(file) {
  const desc = (file.description || '').toLowerCase();
  return HIGHLIGHT_MARKERS.some((m) => desc.includes(m.toLowerCase()));
}

// Strip the highlight marker from the caption so the user sees a clean
// caption instead of a leading ★.
function cleanCaption(file) {
  let cap = file.description || file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  for (const m of HIGHLIGHT_MARKERS) {
    cap = cap.split(m).join('').replace(/\s+/g, ' ').trim();
  }
  return cap || file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
}

export async function onRequest(context) {
  try {
    const token = await getGoogleToken(context.env, 'https://www.googleapis.com/auth/drive.readonly');

    const query = encodeURIComponent(`'${FOLDER_ID}' in parents and mimeType contains 'image/' and trashed = false`);
    const fields = encodeURIComponent('files(id,name,createdTime,description)');
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&orderBy=createdTime desc&pageSize=100`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const data = await res.json();
    if (data.error) return json({ error: data.error.message }, 500);

    const files = data.files || [];
    const highlights = files.filter(isHighlight);
    const rest = files.filter((f) => !isHighlight(f));
    const ordered = [...highlights, ...rest];

    const photos = ordered.slice(0, 12).map((f) => ({
      id: f.id,
      name: f.name,
      date: f.createdTime ? f.createdTime.split('T')[0] : '',
      caption: cleanCaption(f),
      url: `https://drive.google.com/thumbnail?id=${f.id}&sz=w800`,
      fullUrl: `https://drive.google.com/thumbnail?id=${f.id}&sz=w1600`,
      highlight: isHighlight(f),
    }));

    return json({ photos });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
