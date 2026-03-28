export async function onRequest(context) {
  try {
    const raw = context.env.GCP_CREDENTIALS || 'NOT SET';

    // Fix: replace real newlines with escaped ones before parsing
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = JSON.parse(raw.replace(/\n/g, '\\n').replace(/\r/g, ''));
    }

    const key = parsed.private_key || 'NO KEY';
    const cleaned = key
      .replace(/\\n/g, '')
      .replace(/-----BEGIN PRIVATE KEY-----/g, '')
      .replace(/-----END PRIVATE KEY-----/g, '')
      .replace(/[\n\r\s]/g, '')
      .trim();

    // Check for invalid base64 characters
    const invalidChars = cleaned.replace(/[A-Za-z0-9+/=]/g, '');

    return new Response(JSON.stringify({
      ok: true,
      client_email: parsed.client_email,
      key_length: key.length,
      cleaned_key_length: cleaned.length,
      cleaned_mod4: cleaned.length % 4,
      invalid_base64_chars: invalidChars || '(none)',
      invalid_char_codes: [...invalidChars].map(c => c.charCodeAt(0)),
      spreadsheet_id: context.env.SPREADSHEET_ID || 'NOT SET',
      admin_password_set: !!context.env.ADMIN_PASSWORD,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), { headers: { 'Content-Type': 'application/json' } });
  }
}
