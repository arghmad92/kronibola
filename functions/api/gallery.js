import { getGoogleToken, json } from './_sheets.js';

const FOLDER_ID = '1Rn3GRHcw90oQ2pHHM1PwkTGsxsXaVzYV';

// Any subfolder whose name matches this pattern (case-insensitive) is treated
// as the curated highlights folder. Photos in that subfolder float to the top
// of the gallery grid; everything else falls back to "newest first" from the
// main folder.
const HIGHLIGHT_FOLDER_PATTERN = /highlight/i;

// Backup path: description markers still work if you ever prefer to curate
// without moving files around.
const HIGHLIGHT_MARKERS = ['★', '⭐', '[highlight]', '[hl]'];
function hasDescriptionMarker(file) {
  const desc = (file.description || '').toLowerCase();
  return HIGHLIGHT_MARKERS.some((m) => desc.includes(m.toLowerCase()));
}

// Strip any highlight marker from the caption so the viewer sees clean text.
function cleanCaption(file) {
  let cap = file.description || file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  for (const m of HIGHLIGHT_MARKERS) {
    cap = cap.split(m).join('').replace(/\s+/g, ' ').trim();
  }
  return cap || file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
}

async function driveList(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.files || [];
}

async function listImagesIn(folderId, token) {
  const q = encodeURIComponent(`'${folderId}' in parents and mimeType contains 'image/' and trashed = false`);
  const fields = encodeURIComponent('files(id,name,createdTime,description)');
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&orderBy=createdTime desc&pageSize=100`;
  return driveList(url, token);
}

export async function onRequest(context) {
  try {
    const token = await getGoogleToken(context.env, 'https://www.googleapis.com/auth/drive.readonly');

    // 1. Find a subfolder named "Highlights" (or anything matching /highlight/i)
    //    inside the main session folder. Failure is non-fatal — if it doesn't
    //    exist we fall back to description markers + newest-first.
    const folderQ = encodeURIComponent(
      `'${FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
    );
    const folderUrl = `https://www.googleapis.com/drive/v3/files?q=${folderQ}&fields=${encodeURIComponent('files(id,name)')}`;
    let highlightFolderId = null;
    try {
      const subfolders = await driveList(folderUrl, token);
      const match = subfolders.find((f) => HIGHLIGHT_FOLDER_PATTERN.test(f.name || ''));
      if (match) highlightFolderId = match.id;
    } catch {
      // ignore — treat as no highlight folder
    }

    // 2. Fetch main-folder photos and, if we have one, highlight-folder photos
    //    in parallel. Both are sorted newest-first by Drive.
    const [mainFiles, highlightFiles] = await Promise.all([
      listImagesIn(FOLDER_ID, token),
      highlightFolderId ? listImagesIn(highlightFolderId, token) : Promise.resolve([]),
    ]);

    // 3. Merge: highlight folder first (they float to the top), then main.
    //    Dedupe by file id in case the same photo lives in both.
    const seen = new Set();
    const ordered = [];
    for (const f of highlightFiles) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      ordered.push({ ...f, _folderHighlight: true });
    }
    for (const f of mainFiles) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      ordered.push({ ...f, _folderHighlight: false });
    }

    // 4. Shape for the client, cap at 12.
    const photos = ordered.slice(0, 12).map((f) => ({
      id: f.id,
      name: f.name,
      date: f.createdTime ? f.createdTime.split('T')[0] : '',
      caption: cleanCaption(f),
      url: `https://drive.google.com/thumbnail?id=${f.id}&sz=w800`,
      fullUrl: `https://drive.google.com/thumbnail?id=${f.id}&sz=w1600`,
      highlight: f._folderHighlight || hasDescriptionMarker(f),
    }));

    // Single source of truth for the "View all photos" link on /gallery.
    // The page used to hardcode its own copy of the folder URL and would
    // drift behind FOLDER_ID after every session swap.
    return json({
      photos,
      folderUrl: `https://drive.google.com/drive/folders/${FOLDER_ID}?usp=sharing`,
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
