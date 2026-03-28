import { readSheet, appendRow, json } from './_sheets.js';

const TG_BOT_TOKEN = '8660743894:AAG_Sj6N1NE2faGOXBmR77cBhdvf_xPaehw';
const TG_CHAT_ID = '-5247564101';

async function sendTelegramNotification(message) {
  try {
    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text: message, parse_mode: 'HTML' }),
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
    const { date, name, phone, fee, sessionName } = await context.request.json();
    if (!date || !name || !phone) return json({ error: 'Missing fields' }, 400);

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

    const status = activeCount >= maxPlayers ? 'Waitlist' : 'Pending';
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const cleanPhone = "'" + phone.replace(/[-\s]/g, '');
    const refCode = generateRefCode(date, name);

    // Columns: Session Date, Player Name, Phone, Payment Status, Amount, Timestamp, Ref Code, Refund
    await appendRow(context.env, 'Registrations', [date, name, cleanPhone, status, fee, timestamp, refCode, '']);

    // Send Telegram notification
    const spotsLeft = maxPlayers - activeCount - (status === 'Waitlist' ? 0 : 1);
    const emoji = status === 'Waitlist' ? '⏳' : '✅';
    const sessionLabel = session ? session['Session Name'] : 'Game';
    const sessionTime = session ? session.Time : '';
    const sessionLoc = session ? session.Location : '';
    const tgMsg = [
      `${emoji} <b>New Registration</b>`,
      ``,
      `👤 Player: <b>${name}</b>`,
      `📱 Phone: ${phone}`,
      `🏟 Session: <b>${sessionLabel}</b>`,
      `📅 Date: ${date}`,
      sessionTime ? `⏰ Time: ${sessionTime}` : '',
      sessionLoc ? `📍 Location: ${sessionLoc}` : '',
      `💳 Status: <b>${status}</b>`,
      `🔖 Ref: <code>${refCode}</code>`,
      `💰 Fee: RM ${fee}`,
      ``,
      spotsLeft > 0 ? `📊 <b>${spotsLeft}</b> spot${spotsLeft > 1 ? 's' : ''} remaining out of ${maxPlayers}` : `🔴 Game is <b>FULL</b> (${maxPlayers}/${maxPlayers})`,
    ].filter(Boolean).join('\n');
    await sendTelegramNotification(tgMsg);

    return json({ success: true, status, refCode });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
