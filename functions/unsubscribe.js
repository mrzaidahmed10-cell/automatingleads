import { loadDB, saveDB, unsubToken, safeEqual, isEmail } from '../lib/util.js';

async function handle(request, env) {
  const url = new URL(request.url);
  const email = (url.searchParams.get('e') || '').toLowerCase();
  const token = url.searchParams.get('t') || '';
  let ok = false;
  if (env.LEADS && (env.UNSUB_SECRET || env.DASH_PASSWORD) && isEmail(email)) {
    ok = safeEqual(token, await unsubToken(env, email));
    if (ok) {
      const db = await loadDB(env);
      if (!db.suppress.includes(email)) db.suppress.push(email);
      for (const l of Object.values(db.leads)) if (l.email === email) l.status = 'unsub';
      await saveDB(env, db);
    }
  }
  return ok;
}

const page = (msg) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Unsubscribe</title>` +
      `<body style="font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#f6f7f9;color:#0f172a"><div style="background:#fff;padding:32px 36px;border-radius:14px;box-shadow:0 4px 24px #0001;max-width:360px;text-align:center"><h2 style="margin:0 0 8px">${msg}</h2><p style="margin:0;color:#64748b">You won't receive any more emails from us.</p></div>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  );

export async function onRequestGet({ request, env }) {
  return (await handle(request, env)) ? page("You're unsubscribed") : new Response('Invalid or expired link.', { status: 400 });
}

// RFC 8058 one-click unsubscribe (mail clients POST here)
export async function onRequestPost({ request, env }) {
  return (await handle(request, env)) ? new Response('ok') : new Response('invalid', { status: 400 });
}
