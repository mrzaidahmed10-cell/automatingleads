import { json, hmacHex, safeEqual, makeSession, sessionCookie } from '../../lib/util.js';

const WINDOW = 15 * 60 * 1000;

// Per-IP lockout: 5 wrong passwords locks sign-in for 15 min, doubling each time (max 6 h).
export async function onRequestPost({ request, env }) {
  if (!env.DASH_PASSWORD || !env.LEADS) return json({ error: 'Not configured: add the DASH_PASSWORD secret and bind a KV namespace named LEADS.' }, 500);

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const key = 'rl:' + ip;
  const now = Date.now();
  let rec = { n: 0, t: 0, until: 0, locks: 0 };
  try {
    rec = { ...rec, ...JSON.parse((await env.LEADS.get(key)) || '{}') };
  } catch {}

  if (rec.until > now) {
    const secs = Math.ceil((rec.until - now) / 1000);
    return json({ error: `Too many attempts. Try again in ${Math.ceil(secs / 60)} minute${secs > 90 ? 's' : ''}.` }, 429, { 'retry-after': String(secs) });
  }

  const body = await request.json().catch(() => ({}));
  const password = String(body.password || '').slice(0, 256);
  // Compare hashes in constant time so length and content don't leak
  const ok = safeEqual(await hmacHex('cmp', password), await hmacHex('cmp', String(env.DASH_PASSWORD)));

  if (!ok) {
    if (now - rec.t > WINDOW) rec.n = 0;
    rec.n += 1;
    rec.t = now;
    if (rec.n >= 5) {
      rec.locks += 1;
      rec.until = now + Math.min(WINDOW * 2 ** (rec.locks - 1), 6 * 3600 * 1000);
      rec.n = 0;
    }
    try {
      await env.LEADS.put(key, JSON.stringify(rec), { expirationTtl: 86400 });
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
    return json({ error: rec.until > now ? 'Too many attempts. Sign-in is locked for a while.' : 'Wrong password' }, 401);
  }

  if (rec.n || rec.until || rec.locks) {
    try {
      await env.LEADS.delete(key);
    } catch {}
  }
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(await makeSession(env)) });
}
