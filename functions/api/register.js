import { readSheet, appendRow, json } from './_sheets.js';
import { escapeHtml, sanitize, sheetSafe, sendTelegramNotification } from './_utils.js';
import { validateE164Mobile } from './_phone.js';
import { checkBlocked } from './_blocklist.js';

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
    name = sanitize(name).replace(/\s+/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    if (name.length < 2 || name.length > 100) return json({ error: 'Name must be between 2 and 100 characters' }, 400);
    if (!/^[a-zA-Z\s'.@\-]+$/.test(name)) return json({ error: 'Name contains invalid characters' }, 400);

    // Validate phone — must be E.164 international format (+<code><digits>)
    // for a supported country. Frontend normalizes the user's input before
    // sending; this server-side check is the safety net.
    const trimmedPhone = typeof phone === 'string' ? phone.replace(/[\s\-()]/g, '') : '';
    const phoneCheck = validateE164Mobile(trimmedPhone);
    if (!phoneCheck.valid) return json({ error: phoneCheck.error }, 400);
    phone = trimmedPhone; // canonical E.164 from this point on

    // Capture request metadata (IP, country, UA) — used for blocklist
    // check below and stored alongside the registration for tracing.
    const reqHeaders = context.request.headers;
    const reqIp = reqHeaders.get('CF-Connecting-IP') || reqHeaders.get('X-Forwarded-For') || '';
    const reqCountry = reqHeaders.get('CF-IPCountry') || '';
    const reqUA = (reqHeaders.get('User-Agent') || '').slice(0, 300);

    // Blocklist check — reject phones or IPs flagged by admins. Returns a
    // generic 403 so we don't tell the actor whether their phone, their IP,
    // or both are blocked (no enumeration).
    const block = await checkBlocked(context.env, { phone, ip: reqIp });
    if (block.blocked) {
      console.warn(`Blocked registration attempt: kind=${block.kind} phone=${phone} ip=${reqIp}`);
      return json({ error: 'Registration unavailable. Please contact us if you believe this is a mistake.' }, 403);
    }

    // Validate date
    if (!date || typeof date !== 'string' || !date.trim()) return json({ error: 'Session date is required' }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return json({ error: 'Invalid date format' }, 400);

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
    // Stored as `'+60123456789` — leading apostrophe stops Sheets from
    // parsing the `+` and interpreting it as a formula or scientific number.
    const cleanPhone = "'" + phone;
    const refCode = generateRefCode(date, name);

    // Columns: Session Date, Player Name, Phone, Payment Status, Amount,
    // Timestamp, Ref Code, Refund, Car Plate, IP, Country, User Agent.
    // The last three are for tracing fake-receipt abuse — IP from
    // Cloudflare's CF-Connecting-IP header, Country from CF-IPCountry,
    // UA truncated to 300 chars to stay sane on long mobile UAs.
    await appendRow(context.env, 'Registrations', [date, sheetSafe(name), cleanPhone, status, fee, timestamp, refCode, '', cleanedCarPlate, reqIp, reqCountry, sheetSafe(reqUA)]);

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
    console.error('Registration error:', e && e.stack ? e.stack : e);
    return json({ error: 'Unable to save your registration. Please try again in a moment — no spot was taken.' }, 500);
  }
}
