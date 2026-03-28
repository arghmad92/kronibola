import { json } from '../_sheets.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'POST only' }, 405);

  const { password } = await context.request.json();
  const adminPassword = context.env.ADMIN_PASSWORD;

  if (!adminPassword) return json({ error: 'Admin not configured' }, 500);

  if (password === adminPassword) {
    // Simple token (in production, use a proper JWT)
    const token = btoa(`admin:${Date.now()}`);
    return json({ success: true, token });
  }

  return json({ success: false, error: 'Wrong password' }, 401);
}
