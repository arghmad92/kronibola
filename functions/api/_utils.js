/**
 * Shared utilities for Cloudflare Pages Functions.
 * Keep pure helpers here — no Sheets/HTTP logic.
 */

// Escape HTML entities (for Telegram HTML parse_mode, and safe echo into markup).
export function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(text || '').replace(/[&<>"']/g, (m) => map[m]);
}

// Strip HTML tags and angle brackets from free-form user input.
export function sanitize(text) {
  return String(text || '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '').trim();
}

// Prevent Google Sheets formula injection — prefix dangerous leading chars.
export function sheetSafe(value) {
  const s = String(value || '');
  if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
  return s;
}

// Send a Telegram notification. Silently no-ops if creds are missing or the
// request fails — notifications must never break the user-facing flow.
export async function sendTelegramNotification(env, message) {
  const token = env.TG_BOT_TOKEN;
  const chatId = env.TG_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    });
  } catch {}
}
