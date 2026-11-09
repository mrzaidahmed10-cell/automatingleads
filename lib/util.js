const enc = new TextEncoder();

export const COOKIE = '__Host-fl';
export const SESSION_DAYS = 7;

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
  try {
    return m ? decodeURIComponent(m[1]) : '';
  } catch {
    return '';
  }
}

/* ---------- sessions: signed, expiring, revocable ---------- */
const sessionKey = (env) => String(env.SESSION_SECRET || env.DASH_PASSWORD || '');

export async function makeSession(env) {
  const epoch = (await env.LEADS.get('auth:epoch')) || '0';
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const payload = `${exp}.${epoch}.${nonce}`;
  return `${payload}.${await hmacHex(sessionKey(env), 'sess:' + payload)}`;
}

export async function checkSession(env, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4 || !sessionKey(env)) return false;
  const [exp, epoch, nonce, sig] = parts;
  if (!/^\d{9,12}$/.test(exp) || !/^\d{1,9}$/.test(epoch) || !/^[a-f0-9]{12}$/.test(nonce)) return false;
  if (!safeEqual(sig, await hmacHex(sessionKey(env), `sess:${exp}.${epoch}.${nonce}`))) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  return epoch === ((await env.LEADS.get('auth:epoch')) || '0');
}

// Invalidates every existing session on every device
export async function revokeAllSessions(env) {
  const cur = Number((await env.LEADS.get('auth:epoch')) || '0') || 0;
  await env.LEADS.put('auth:epoch', String(cur + 1));
}

export const sessionCookie = (token, maxAge = SESSION_DAYS * 86400) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

/* ---------- settings / templates ---------- */
export const DEFAULT_SETTINGS = {
  senderName: '',
  businessName: 'FlightLine',
  address: '',
  replyTo: '',
  offer: 'I build clean, fast, mobile-friendly websites for local businesses, usually live within a week.',
  about: '',
  knowledge: '',
  tone: 'friendly',
  portfolioUrl: '',
  dailyLimit: 0, // 0 = no cap (your call)
  sendGap: 0, // seconds between bulk sends, 0 = none
  agencyV: 1,
  limitV: 1,
};

// {{business}}, {{contact}} and {{sender}} are filled in by the dashboard. [Brackets] are blanks for you to fill.
export const DEFAULT_TEMPLATES = [
  { id: 't1', name: 'How it works', body: "Hi {{contact}},\n\nThanks for getting back to me! Here's how it works: [describe your process in a sentence or two]. Most sites like this are live in [timeframe].\n\nWant me to start with a quick idea for {{business}}?\n\n{{sender}}" },
  { id: 't2', name: 'Pricing', body: 'Hi {{contact}},\n\nGood question. Sites like this usually run [your price range], depending on pages and features. That includes [what\'s included].\n\nIf you tell me a bit about what you\'d like the site to do, I can give you an exact number.\n\n{{sender}}' },
  { id: 't3', name: 'Book a call', body: "Hi {{contact}},\n\nHappy to chat. Are you free for a quick 10-minute call [day] or [day]? If neither works, tell me what does and I'll fit around you.\n\n{{sender}}" },
  { id: 't4', name: 'Gentle follow-up', body: "Hi {{contact}},\n\nJust floating this back up in case it got buried. No pressure at all. If it's useful, I can send a quick idea of what a site for {{business}} could look like.\n\n{{sender}}" },
  { id: 't5', name: 'Not now', body: "No problem at all, and thanks for letting me know. If things change down the road, you know where to find me. Wishing {{business}} a great season.\n\n{{sender}}" },
  { id: 't6', name: 'Remove me', body: "Understood. I've taken you off my list and you won't hear from me again. Sorry for the bother.\n\n{{sender}}" },
];

export const today = () => new Date().toISOString().slice(0, 10);
// Strict: no whitespace, commas, semicolons, quotes or angle brackets, so a value can never smuggle extra recipients or headers
export const isEmail = (e) => typeof e === 'string' && e.length <= 254 && /^[^\s@,;:<>()[\]"'\\]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(e);
// Accepts what people actually paste: "Joe <joe@x.com>", "mailto:joe@x.com", trailing dots or commas, stray spaces
export const cleanEmail = (s) => {
  s = String(s || '').trim();
  const m = s.match(/<([^>]+)>/);
  if (m) s = m[1];
  return s.replace(/^mailto:/i, '').replace(/\s+/g, '').replace(/[,;:.)\]]+$/, '').toLowerCase();
};
export const cap = (v, n) => String(v ?? '').slice(0, n);
export const MAX_LEADS = 5000;

export async function loadDB(env) {
  const raw = await env.LEADS.get('db');
  const db = raw ? JSON.parse(raw) : {};
  db.leads ||= {};
  db.suppress ||= [];
  db.sent ||= {};
  db.templates ||= DEFAULT_TEMPLATES.map((t) => ({ ...t }));
  const stored = db.settings || {};
  db.settings = { ...DEFAULT_SETTINGS, ...stored };
  // one-time: older saves stored an empty agency name; adopt FlightLine
  if (stored.agencyV !== 1) {
    if (!stored.businessName) db.settings.businessName = 'FlightLine';
    db.settings.agencyV = 1;
  }
  // one-time: the old default cap of 20 was never chosen by the user, so lift it
  if (stored.limitV !== 1) {
    db.settings.dailyLimit = 0;
    db.settings.sendGap = 0;
    db.settings.limitV = 1;
  }
  return db;
}

export async function saveDB(env, db) {
  const keep = Object.keys(db.sent).sort().slice(-14);
  db.sent = Object.fromEntries(keep.map((k) => [k, db.sent[k]]));
  const data = JSON.stringify(db);
  // KV allows ~1 write per second per key; back off and retry instead of failing
  for (let i = 0; ; i++) {
    try {
      return await env.LEADS.put('db', data);
    } catch (e) {
      if (i >= 3) throw new Error('Could not save (' + (e.message || e) + '). Try again in a moment.');
      await new Promise((r) => setTimeout(r, 1100));
    }
  }
}
