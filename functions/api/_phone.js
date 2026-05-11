/**
 * Shared phone-number helpers.
 *
 * Canonical storage format is E.164: `+<countrycode><nationalnumber>`
 * (e.g. `+60123456789`). The Registrations and Orders sheets store this
 * with a leading apostrophe (`'+60123456789`) so Google Sheets doesn't
 * try to parse it as a number.
 *
 * Mobile patterns below are for the *national* number only (no country
 * code, no leading 0). Adding a new country = one entry in COUNTRIES.
 */

// Mobile-only validation. Order matters for the dropdown — first entry
// is the default (Malaysia). When adding a country, double-check the
// national number pattern: leading 0 is dropped (national format), so
// e.g. MY mobile `0123456789` becomes `123456789` for matching.
export const COUNTRIES = [
  { code: '+60', flag: '🇲🇾', name: 'Malaysia',    re: /^1[0-9]{8,9}$/,         example: '123456789' },
  { code: '+65', flag: '🇸🇬', name: 'Singapore',   re: /^[89][0-9]{7}$/,        example: '81234567' },
  { code: '+62', flag: '🇮🇩', name: 'Indonesia',   re: /^8[0-9]{8,11}$/,        example: '812345678' },
  { code: '+66', flag: '🇹🇭', name: 'Thailand',    re: /^[689][0-9]{8}$/,       example: '812345678' },
  { code: '+63', flag: '🇵🇭', name: 'Philippines', re: /^9[0-9]{9}$/,           example: '9171234567' },
  { code: '+84', flag: '🇻🇳', name: 'Vietnam',     re: /^[35789][0-9]{8}$/,     example: '912345678' },
  { code: '+91', flag: '🇮🇳', name: 'India',       re: /^[6-9][0-9]{9}$/,       example: '9123456789' },
  { code: '+86', flag: '🇨🇳', name: 'China',       re: /^1[3-9][0-9]{9}$/,      example: '13812345678' },
  { code: '+81', flag: '🇯🇵', name: 'Japan',       re: /^[789]0[0-9]{8}$/,      example: '9012345678' },
  { code: '+82', flag: '🇰🇷', name: 'South Korea', re: /^10[0-9]{7,8}$/,        example: '1012345678' },
  { code: '+61', flag: '🇦🇺', name: 'Australia',   re: /^4[0-9]{8}$/,           example: '412345678' },
  { code: '+44', flag: '🇬🇧', name: 'UK',          re: /^7[0-9]{9}$/,           example: '7123456789' },
  { code: '+1',  flag: '🇺🇸', name: 'US/Canada',   re: /^[2-9][0-9]{2}[2-9][0-9]{6}$/, example: '4155551234' },
  { code: '+49', flag: '🇩🇪', name: 'Germany',     re: /^1[5-7][0-9]{8,9}$/,    example: '1512345678' },
];

// Country codes sorted longest-first so startsWith() doesn't false-match
// (e.g. so '+60' wins over '+6' if we ever add a country with just '+6').
const SORTED_CODES = COUNTRIES.map((c) => c.code).sort((a, b) => b.length - a.length);
const PATTERNS = Object.fromEntries(COUNTRIES.map((c) => [c.code, c.re]));

/**
 * Validate an E.164 mobile number against the supported country list.
 * Returns `{ valid: true, code, national }` or `{ valid: false, error }`.
 *
 * Strict — phone MUST be E.164 (`+<digits>`). Legacy formats (bare digits,
 * leading 0) are rejected here; the frontend is expected to normalize
 * before sending. Server-side rejection is the safety net.
 */
export function validateE164Mobile(phone) {
  if (!phone || typeof phone !== 'string') {
    return { valid: false, error: 'Phone number is required' };
  }
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    return { valid: false, error: 'Use international format, e.g. +60123456789' };
  }
  for (const code of SORTED_CODES) {
    if (phone.startsWith(code)) {
      const national = phone.slice(code.length);
      if (!PATTERNS[code].test(national)) {
        return { valid: false, error: 'That doesn\'t look like a valid mobile number for the selected country' };
      }
      return { valid: true, code, national };
    }
  }
  return { valid: false, error: 'Unsupported country code. Contact us if you need to register from this country.' };
}

/**
 * Fuzzy match two phone strings. Used for status lookup so a user can
 * find their registrations even if formats drifted between when they
 * registered and when they check.
 *
 * Handles legacy data:
 *   stored `'0123456789` + lookup `+60123456789`     → match
 *   stored `'60123456789` + lookup `0123456789`      → match
 *   stored `'+60123456789` + lookup `+60123456789`   → match
 *   stored `'+14155551234` + lookup `4155551234`     → match
 *
 * Strategy: strip everything except digits on both sides, then check
 * exact-equal OR one ends with the other (covers country-code variants).
 * Requires at least 7 digits on each side so a junk 1-2 digit input
 * doesn't match every row.
 */
export function phoneMatches(a, b) {
  const da = String(a || '').replace(/\D/g, '');
  const db = String(b || '').replace(/\D/g, '');
  if (da.length < 7 || db.length < 7) return false;
  if (da === db) return true;
  const shorter = da.length < db.length ? da : db;
  const longer = da.length < db.length ? db : da;
  return longer.endsWith(shorter);
}
