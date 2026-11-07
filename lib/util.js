const enc = new TextEncoder();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

export async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function getCookie(request, name) {
  const m = (request.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

export const DEFAULT_SETTINGS = {
  senderName: '',
  businessName: '',
  address: '',
  replyTo: '',
  offer: 'I build clean, fast, mobile-friendly websites for local businesses, usually live within a week.',
  portfolioUrl: '',
  dailyLimit: 20,
};

export const today = () => new Date().toISOString().slice(0, 10);
export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e || '');

export async function loadDB(env) {
  const raw = await env.LEADS.get('db');
  const db = raw ? JSON.parse(raw) : {};
  db.leads ||= {};
  db.suppress ||= [];
  db.sent ||= {};
  db.settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
  return db;
}

export async function saveDB(env, db) {
  const keep = Object.keys(db.sent).sort().slice(-14);
  db.sent = Object.fromEntries(keep.map((k) => [k, db.sent[k]]));
  await env.LEADS.put('db', JSON.stringify(db));
}

export function unsubToken(env, email) {
  return hmacHex(env.UNSUB_SECRET || env.DASH_PASSWORD, 'unsub:' + String(email).toLowerCase());
}
