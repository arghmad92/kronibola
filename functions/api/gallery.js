import { getGoogleToken, json } from './_sheets.js';

const FOLDER_ID = '1YRyVk8whpJeSntTYYfLDvHbb1pbCLiJd';

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

    const photos = (data.files || []).slice(0, 12).map((f) => ({
      id: f.id,
      name: f.name,
      date: f.createdTime ? f.createdTime.split('T')[0] : '',
      caption: f.description || f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
      url: `https://drive.google.com/thumbnail?id=${f.id}&sz=w800`,
      fullUrl: `https://drive.google.com/thumbnail?id=${f.id}&sz=w1600`,
    }));

    return json({ photos });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
