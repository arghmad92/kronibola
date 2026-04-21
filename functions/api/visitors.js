/**
 * Self-hosted visitor counter backed by Cloudflare KV.
 *
 * Replaces the counterapi.dev dependency (which went down and took the
 * footer counter with it). Runs on the same Cloudflare Pages infra as the
 * rest of the site — no third-party calls.
 *
 * Setup (one-time, in the Cloudflare dashboard):
 *   1. Workers & Pages → your Pages project → Settings → Bindings
 *   2. Add binding → KV namespace
 *      - Variable name: VISITORS_KV
 *      - KV namespace: create a new one named "kronibola-visitors"
 *   3. Save + trigger a redeploy (or push an empty commit)
 *
 * Behaviour:
 *   POST /api/visitors  → increments and returns { count }
 *   GET  /api/visitors  → returns { count } without incrementing
 *
 * If the KV binding is missing, we return count: 0 with a non-blocking error
 * flag so the frontend can gracefully hide the counter instead of crashing.
 *
 * Seeded at 3835 (the last reading from counterapi.dev before it went down)
 * so the migration is seamless — the counter doesn't visibly reset to zero.
 *
 * Known limitation: KV increments are not atomic. Under concurrent load, two
 * near-simultaneous POSTs can both read the same count and both write N+1,
 * effectively losing one visit. Fine for a vanity footer counter at this
 * site's traffic level; if we ever need exact counts, switch to D1.
 */

const INITIAL_SEED = 3835;
const KEY = 'total';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function onRequest(context) {
  const kv = context.env && context.env.VISITORS_KV;
  if (!kv) {
    return json({ count: 0, configured: false });
  }

  try {
    const raw = await kv.get(KEY);
    let current = parseInt(raw || '', 10);
    if (isNaN(current)) current = INITIAL_SEED;

    if (context.request.method === 'POST') {
      current += 1;
      await kv.put(KEY, String(current));
    }

    return json({ count: current });
  } catch (e) {
    console.error('visitors counter error:', e && e.stack ? e.stack : e);
    return json({ count: 0, error: 'counter unavailable' }, 500);
  }
}
