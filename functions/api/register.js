import { readSheet, appendRow, json } from './_sheets.js';

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(text || '').replace(/[&<>"']/g, m => map[m]);
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

function generateRefCode(date, name) {
  const dd = date.slice(8, 10);
  const mm = date.slice(5, 7);
  const initial = (name || 'X')[0].toUpperCase();
  const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `KB-${mm}${dd}-${initial}${rand}`;
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const body = await context.request.json();
    let { date, name, phone, fee, sessionName, carPlate } = body;

    // Validate name
    if (!name || typeof name !== 'string') return json({ error: 'Name is required' }, 400);
    name = name.trim().replace(/\s+/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    if (name.length < 2 || name.length > 100) return json({ error: 'Name must be between 2 and 100 characters' }, 400);

    // Validate phone
    if (!phone || typeof phone !== 'string') return json({ error: 'Phone number is required' }, 400);
    if (!/^[\d\s\-+]+$/.test(phone)) return json({ error: 'Phone number contains invalid characters' }, 400);
    const cleanedPhone = phone.replace(/[\s\-+]/g, '');
    if (cleanedPhone.length < 10 || cleanedPhone.length > 15) return json({ error: 'Phone number must be 10-15 digits' }, 400);

    // Validate date
    if (!date || typeof date !== 'string' || !date.trim()) return json({ error: 'Session date is required' }, 400);

    // Validate fee
    const feeNum = Number(fee);
    if (fee === undefined || fee === null || fee === '' || isNaN(feeNum)) return json({ error: 'Fee must be a valid number' }, 400);
    if (feeNum < 0 || feeNum > 500) return json({ error: 'Fee must be between 0 and 500' }, 400);

    // Check duplicates
    const regs = await readSheet(context.env, 'Registrations');
    const taken = regs
      .filter((r) => String(r['Session Date']) === date)
      .map((r) => String(r['Player Name']).toLowerCase().trim());

    if (taken.includes(name.toLowerCase().trim())) {
      return json({ error: `Name "${name}" is already taken!` }, 400);
    }

    // Check if full
    const sessions = await readSheet(context.env, 'Sessions');
    const session = sessions.find((s) => s.Date === date);
    const maxPlayers = session ? parseInt(session['Max Players']) || 20 : 20;
    const activeCount = regs.filter(
      (r) => String(r['Session Date']) === date && ['Paid', 'Pending', 'Overdue'].includes(r['Payment Status'])
    ).length;

    // Validate car plate if session requires it
    const requiresCarPlate = session && session['Require Car Plate'] === 'Yes';
    let cleanedCarPlate = '';
    if (requiresCarPlate) {
      if (!carPlate || typeof carPlate !== 'string') return json({ error: 'Car plate number is required for this session' }, 400);
      cleanedCarPlate = carPlate.replace(/\s/g, '').toUpperCase();
      if (cleanedCarPlate.length < 2 || cleanedCarPlate.length > 10) return json({ error: 'Car plate must be 2-10 characters' }, 400);
      if (!/^[A-Z0-9]+$/.test(cleanedCarPlate)) return json({ error: 'Car plate must contain only letters and numbers' }, 400);
      if (!/[A-Z]/.test(cleanedCarPlate) || !/[0-9]/.test(cleanedCarPlate)) return json({ error: 'Car plate must contain at least 1 letter and 1 digit' }, 400);
    } else if (carPlate && typeof carPlate === 'string') {
      cleanedCarPlate = carPlate.replace(/\s/g, '').toUpperCase();
    }

    const status = activeCount >= maxPlayers ? 'Waitlist' : 'Pending';
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const cleanPhone = "'" + phone.replace(/[-\s]/g, '');
    const refCode = generateRefCode(date, name);

    // Columns: Session Date, Player Name, Phone, Payment Status, Amount, Timestamp, Ref Code, Refund, Car Plate
    await appendRow(context.env, 'Registrations', [date, name, cleanPhone, status, fee, timestamp, refCode, '', cleanedCarPlate]);

    // Send Telegram notification
    const spotsLeft = maxPlayers - activeCount - (status === 'Waitlist' ? 0 : 1);
    const emoji = status === 'Waitlist' ? '⏳' : '✅';
    const sessionLabel = session ? session['Session Name'] : 'Game';
    const sessionTime = session ? session.Time : '';
    const sessionLoc = session ? session.Location : '';
    const tgMsg = [
      `${emoji} <b>New Registration</b>`,
      ``,
      `👤 Player: <b>${escapeHtml(name)}</b>`,
      `📱 Phone: ${escapeHtml(phone)}`,
      `🏟 Session: <b>${escapeHtml(sessionLabel)}</b>`,
      `📅 Date: ${escapeHtml(date)}`,
      sessionTime ? `⏰ Time: ${escapeHtml(sessionTime)}` : '',
      sessionLoc ? `📍 Location: ${escapeHtml(sessionLoc)}` : '',
      `💳 Status: <b>${status}</b>`,
      `🔖 Ref: <code>${refCode}</code>`,
      `💰 Fee: RM ${fee}`,
      cleanedCarPlate ? `🚗 Car Plate: <b>${escapeHtml(cleanedCarPlate)}</b>` : '',
      ``,
      spotsLeft > 0 ? `📊 <b>${spotsLeft}</b> spot${spotsLeft > 1 ? 's' : ''} remaining out of ${maxPlayers}` : `🔴 Game is <b>FULL</b> (${maxPlayers}/${maxPlayers})`,
    ].filter(Boolean).join('\n');
    await sendTelegramNotification(context.env, tgMsg);

    return json({ success: true, status, refCode });
  } catch (e) {
    console.error('Registration error:', e);
    return json({ error: 'An error occurred. Please try again.' }, 500);
  }
}
