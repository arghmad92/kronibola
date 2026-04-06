import { readSheet, appendRow, json } from './_sheets.js';

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(text || '').replace(/[&<>"']/g, m => map[m]);
}

// Strip HTML tags and dangerous characters
function sanitize(text) {
  return String(text || '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '').trim();
}

// Prevent Google Sheets formula injection — prefix dangerous first chars
function sheetSafe(value) {
  const s = String(value || '');
  if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
  return s;
}

async function sendTelegramNotification(env, message) {
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

function generateOrderRef(name) {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const initial = (name || 'X')[0].toUpperCase();
  const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `KBJ-${mm}${dd}-${initial}${rand}`;
}

const VALID_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL', '7XL', '8XL'];
const PRICE = 48;
const POSTAGE = 10;

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const body = await context.request.json();
    let { name, phone, size, quantity, delivery, address } = body;

    // Validate name
    if (!name || typeof name !== 'string') return json({ error: 'Name is required' }, 400);
    name = sanitize(name).replace(/\s+/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    if (name.length < 2 || name.length > 100) return json({ error: 'Name must be between 2 and 100 characters' }, 400);
    if (!/^[a-zA-Z\s'.@\-]+$/.test(name)) return json({ error: 'Name contains invalid characters' }, 400);

    // Validate phone
    if (!phone || typeof phone !== 'string') return json({ error: 'Phone number is required' }, 400);
    if (!/^[\d\s\-+]+$/.test(phone)) return json({ error: 'Phone number contains invalid characters' }, 400);
    const cleanPhone = phone.replace(/[\s\-+]/g, '');
    if (cleanPhone.length < 10 || cleanPhone.length > 15) return json({ error: 'Phone number must be 10-15 digits' }, 400);

    // Validate size
    if (!size || !VALID_SIZES.includes(size)) return json({ error: 'Invalid size. Choose from: S, M, L, XL, 2XL, 3XL' }, 400);

    // Validate quantity
    const qty = parseInt(quantity) || 1;
    if (qty < 1 || qty > 5) return json({ error: 'Quantity must be between 1 and 5' }, 400);

    // Validate delivery
    if (delivery && !['pickup', 'postage'].includes(delivery)) return json({ error: 'Invalid delivery option' }, 400);
    const isPostage = delivery === 'postage';
    const cleanAddress = isPostage ? sanitize(address).slice(0, 500) : '';
    if (isPostage && cleanAddress.length < 10) return json({ error: 'Full address required for postage delivery' }, 400);

    const total = PRICE * qty + (isPostage ? POSTAGE : 0);
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const orderDate = new Date().toISOString().slice(0, 10);
    const refCode = generateOrderRef(name);
    const phoneForSheet = "'" + cleanPhone;
    const deliveryLabel = isPostage ? 'Postage' : 'Pickup';

    // Columns: Order Date, Player Name, Phone, Size, Quantity, Total, Payment Status, Timestamp, Ref Code, Delivery, Address
    await appendRow(context.env, 'Orders', [orderDate, sheetSafe(name), phoneForSheet, size, qty, total, 'Pending', timestamp, refCode, deliveryLabel, sheetSafe(cleanAddress)]);

    // Send Telegram notification
    const tgMsg = [
      `👕 <b>New Jersey Order</b>`,
      ``,
      `👤 Name: <b>${escapeHtml(name)}</b>`,
      `📱 Phone: ${escapeHtml(cleanPhone)}`,
      `📏 Size: <b>${size}</b>`,
      `🔢 Qty: <b>${qty}</b>`,
      `🚚 Delivery: <b>${deliveryLabel}</b>`,
      isPostage ? `📍 Address: ${escapeHtml(cleanAddress)}` : '',
      `💰 Total: <b>RM ${total}</b>`,
      `🔖 Ref: <code>${refCode}</code>`,
      `💳 Status: <b>Pending</b>`,
    ].filter(Boolean).join('\n');
    await sendTelegramNotification(context.env, tgMsg);

    return json({ success: true, refCode, total });
  } catch (e) {
    return json({ error: 'An error occurred. Please try again.' }, 500);
  }
}
