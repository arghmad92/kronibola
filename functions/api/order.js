import { appendRow, json } from './_sheets.js';
import { escapeHtml, sanitize, sheetSafe, sendTelegramNotification } from './_utils.js';

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
const ORDER_DEADLINE = new Date('2026-04-30T23:59:59+08:00');

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    // Check deadline
    if (Date.now() > ORDER_DEADLINE.getTime()) {
      return json({ error: 'Orders are now closed.' }, 400);
    }

    const body = await context.request.json();
    let { name, phone, items, delivery, address } = body;

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

    // Validate items (array of { size, qty })
    if (!Array.isArray(items) || items.length === 0) return json({ error: 'Select at least one size' }, 400);
    let totalQty = 0;
    for (const item of items) {
      if (!item.size || !VALID_SIZES.includes(item.size)) return json({ error: `Invalid size: ${item.size}` }, 400);
      const q = parseInt(item.qty) || 0;
      if (q < 1 || q > 5) return json({ error: `Quantity for ${item.size} must be 1-5` }, 400);
      totalQty += q;
    }
    if (totalQty > 20) return json({ error: 'Maximum 20 jerseys per order' }, 400);
    const sizesSummary = items.map(i => `${i.size} ×${i.qty}`).join(', ');

    // Validate delivery
    if (delivery && !['pickup', 'postage'].includes(delivery)) return json({ error: 'Invalid delivery option' }, 400);
    const isPostage = delivery === 'postage';
    const cleanAddress = isPostage ? sanitize(address).slice(0, 500) : '';
    if (isPostage && cleanAddress.length < 10) return json({ error: 'Full address required for postage delivery' }, 400);

    const total = PRICE * totalQty + (isPostage ? POSTAGE : 0);
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const orderDate = new Date().toISOString().slice(0, 10);
    const refCode = generateOrderRef(name);
    const phoneForSheet = "'" + cleanPhone;
    const deliveryLabel = isPostage ? 'Postage' : 'Pickup';

    // Columns: Order Date, Player Name, Phone, Size, Quantity, Total, Payment Status, Timestamp, Ref Code, Delivery, Address
    await appendRow(context.env, 'Orders', [orderDate, sheetSafe(name), phoneForSheet, sizesSummary, totalQty, total, 'Pending', timestamp, refCode, deliveryLabel, sheetSafe(cleanAddress)]);

    // Send Telegram notification
    const tgMsg = [
      `👕 <b>New Jersey Order</b>`,
      ``,
      `👤 Name: <b>${escapeHtml(name)}</b>`,
      `📱 Phone: ${escapeHtml(cleanPhone)}`,
      `📏 Sizes: <b>${sizesSummary}</b>`,
      `🔢 Total Qty: <b>${totalQty}</b>`,
      `🚚 Delivery: <b>${deliveryLabel}</b>`,
      isPostage ? `📍 Address: ${escapeHtml(cleanAddress)}` : '',
      `💰 Total: <b>RM ${total}</b>`,
      `🔖 Ref: <code>${refCode}</code>`,
      `💳 Status: <b>Pending</b>`,
    ].filter(Boolean).join('\n');
    await sendTelegramNotification(context.env, tgMsg);

    return json({ success: true, refCode, total });
  } catch (e) {
    console.error('Order error:', e && e.stack ? e.stack : e);
    return json({ error: 'Unable to save your order. Please try again in a moment — no order was placed.' }, 500);
  }
}
