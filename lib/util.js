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
  about: '',
  knowledge: '',
  tone: 'friendly',
  portfolioUrl: '',
  dailyLimit: 20,
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
export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e || '');

export async function loadDB(env) {
  const raw = await env.LEADS.get('db');
  const db = raw ? JSON.parse(raw) : {};
  db.leads ||= {};
  db.suppress ||= [];
  db.sent ||= {};
  db.templates ||= DEFAULT_TEMPLATES.map((t) => ({ ...t }));
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
