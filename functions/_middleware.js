import { json, getCookie, hmacHex, safeEqual } from '../lib/util.js';

// Everything under /api/ (except login) requires the signed session cookie.
export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/') || url.pathname === '/api/login') return next();

  if (!env.DASH_PASSWORD || !env.LEADS) {
    return json({ error: 'Not configured: add the DASH_PASSWORD secret and bind a KV namespace named LEADS.' }, 500);
  }

  // Block cross-site writes
  const origin = request.headers.get('origin');
  if (request.method !== 'GET' && origin && new URL(origin).host !== url.host) {
    return json({ error: 'forbidden' }, 403);
  }

  const token = getCookie(request, 'ls');
  const expected = await hmacHex(env.DASH_PASSWORD, 'leads-session-v1');
  if (!token || !safeEqual(token, expected)) return json({ error: 'unauthorized' }, 401);
  return next();
}
