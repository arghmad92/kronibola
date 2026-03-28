export async function onRequest(context) {
  try {
    const raw = context.env.GCP_CREDENTIALS || 'NOT SET';

    // Try parsing
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e1) {
      try {
        parsed = JSON.parse(raw.replace(/\\n/g, '\n'));
      } catch (e2) {
        return new Response(JSON.stringify({
          error: 'JSON parse failed',
          raw_length: raw.length,
          first_50: raw.substring(0, 50),
          last_50: raw.substring(raw.length - 50),
          parse_error_1: e1.message,
          parse_error_2: e2.message,
        }), { headers: { 'Content-Type': 'application/json' } });
      }
    }

    const key = parsed.private_key || 'NO KEY';
    const cleaned = key
      .replace(/\\n/g, '\n')
      .replace(/-----BEGIN PRIVATE KEY-----/g, '')
      .replace(/-----END PRIVATE KEY-----/g, '')
      .replace(/[\n\r\s]/g, '');

    return new Response(JSON.stringify({
      has_credentials: true,
      client_email: parsed.client_email,
      key_length: key.length,
      cleaned_key_length: cleaned.length,
      key_starts_with: key.substring(0, 40),
      cleaned_first_20: cleaned.substring(0, 20),
      cleaned_last_20: cleaned.substring(cleaned.length - 20),
      has_backslash_n: key.includes('\\n'),
      has_real_newline: key.includes('\n'),
      spreadsheet_id: context.env.SPREADSHEET_ID || 'NOT SET',
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { headers: { 'Content-Type': 'application/json' } });
  }
}
