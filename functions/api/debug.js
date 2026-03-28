export async function onRequest(context) {
  try {
    const raw = context.env.GCP_CREDENTIALS || 'NOT SET';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = JSON.parse(raw.replace(/\n/g, '\\n').replace(/\r/g, ''));
    }

    const key = parsed.private_key || 'NO KEY';

    // Exact same logic as _sheets.js
    const pem = key
      .replace(/\\n/g, '')
      .replace(/\n/g, '')
      .replace(/\r/g, '')
      .replace(/-+BEGIN PRIVATE KEY-+/g, '')
      .replace(/-+END PRIVATE KEY-+/g, '')
      .replace(/\s/g, '')
      .trim();

    const invalidChars = pem.replace(/[A-Za-z0-9+/=]/g, '');

    // Try atob
    let atobOk = false;
    let atobErr = '';
    try {
      atob(pem);
      atobOk = true;
    } catch(e) {
      atobErr = e.message;
    }

    return new Response(JSON.stringify({
      ok: true,
      pem_length: pem.length,
      pem_mod4: pem.length % 4,
      pem_first_20: pem.substring(0, 20),
      pem_last_20: pem.substring(pem.length - 20),
      invalid_chars: invalidChars || '(none)',
      invalid_codes: [...invalidChars].map(c => c.charCodeAt(0)),
      atob_ok: atobOk,
      atob_err: atobErr,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { headers: { 'Content-Type': 'application/json' } });
  }
}
