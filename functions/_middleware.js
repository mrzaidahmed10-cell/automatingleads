import { json, getCookie, checkSession, COOKIE } from '../lib/util.js';

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' https://overpass-api.de https://overpass.kumi.systems https://overpass.private.coffee https://overpass.openstreetmap.fr https://geocoding-api.open-meteo.com https://nominatim.openstreetmap.org",
  "font-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'content-security-policy': CSP,
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'x-robots-tag': 'noindex, nofollow, noarchive',
};

const harden = (res) => {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
};

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return harden(await next());

  const method = request.method;
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return harden(json({ error: 'method not allowed' }, 405));

  // CSRF: writes must come from this site (Origin) and carry a custom header a cross-site page cannot send
  if (method !== 'GET') {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(request.headers.get('origin') || '').host === url.host;
    } catch {}
    if (!sameOrigin || request.headers.get('x-requested-by') !== 'flightline') return harden(json({ error: 'forbidden' }, 403));
    if (Number(request.headers.get('content-length') || 0) > 300000) return harden(json({ error: 'request too large' }, 413));
  }

  if (url.pathname === '/api/login') return harden(await next());

  if (!env.DASH_PASSWORD || !env.LEADS) {
    return harden(json({ error: 'Not configured: add the DASH_PASSWORD secret and bind a KV namespace named LEADS.' }, 500));
  }
  if (!(await checkSession(env, getCookie(request, COOKIE)))) return harden(json({ error: 'unauthorized' }, 401));
  return harden(await next());
}
