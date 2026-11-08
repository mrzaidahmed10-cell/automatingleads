// Sends one plain-text email through Gmail API, Resend (default) or SendGrid.
// Plain text only: no tracking, no footer, no unsubscribe link or headers. Reads like a normal one-to-one email.
export const provider = (env) => (env.EMAIL_PROVIDER || 'resend').toLowerCase();

export function emailReady(env) {
  if (provider(env) === 'gmail') return !!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN);
  return !!(env.EMAIL_API_KEY && env.EMAIL_FROM);
}

const enc = new TextEncoder();
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const b64url = (bytes) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const clean = (v) => String(v).replace(/[\r\n]+/g, ' ');
const wrap = (b) => (b.match(/.{1,76}/g) || []).join('\r\n');

// The email is exactly what you wrote: no footer, no signature block, no links added.
export function renderEmail(_settings, body) {
  return { text: String(body).trim() };
}

function parseFrom(v) {
  const m = String(v || '').match(/^(.*)<(.+)>$/);
  return m ? { name: m[1].trim().replace(/^"|"$/g, ''), email: m[2].trim() } : { name: '', email: String(v || '').trim() };
}

// Sender = your name (from Settings) + the configured address. For Gmail with no EMAIL_FROM, use your reply-to address.
function senderFor(env, fromName, replyTo) {
  const base = parseFrom(env.EMAIL_FROM);
  let email = base.email;
  if (!email && provider(env) === 'gmail' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo || '')) email = replyTo;
  const name = String(fromName || base.name || '').replace(/["<>\r\n]/g, '').trim();
  return email ? { name, email } : { name, email: '' };
}

const nameHeader = (n) => (/[^\x20-\x7e]/.test(n) ? `=?UTF-8?B?${b64(enc.encode(n))}?=` : `"${n}"`);

export function buildMime({ from, to, subject, text, replyTo }) {
  const lines = [];
  if (from?.email) lines.push('From: ' + (from.name ? `${nameHeader(from.name)} <${clean(from.email)}>` : clean(from.email)));
  lines.push('To: ' + clean(to));
  if (replyTo && replyTo.toLowerCase() !== (from?.email || '').toLowerCase()) lines.push('Reply-To: ' + clean(replyTo));
  lines.push('Subject: =?UTF-8?B?' + b64(enc.encode(clean(subject))) + '?=');
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: base64');
  return lines.join('\r\n') + '\r\n\r\n' + wrap(b64(enc.encode(text)));
}

async function sendGmail(env, msg) {
  const tr = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID.trim(),
      client_secret: env.GMAIL_CLIENT_SECRET.trim(),
      refresh_token: env.GMAIL_REFRESH_TOKEN.trim(),
      grant_type: 'refresh_token',
    }),
  });
  const tj = await tr.json().catch(() => ({}));
  if (!tr.ok || !tj.access_token) {
    const why =
      tj.error === 'invalid_grant'
        ? 'Gmail refresh token expired or revoked. Generate a new one in the OAuth Playground (tokens from apps in Testing mode last about 7 days).'
        : `Gmail auth failed (${tj.error || tr.status}): ${tj.error_description || 'no details'}. ` +
          'Check that GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN all come from the same OAuth client, with no extra spaces.';
    throw new Error(why);
  }
  const raw = b64url(enc.encode(buildMime(msg)));
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${tj.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!r.ok) throw new Error('Gmail: ' + (await r.text()).slice(0, 200));
}

export async function sendEmail(env, { to, subject, text, replyTo, fromName }) {
  const from = senderFor(env, fromName, replyTo);

  if (provider(env) === 'gmail') return sendGmail(env, { from, to, subject, text, replyTo });

  if (provider(env) === 'sendgrid') {
    const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.EMAIL_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: from.name ? from : { email: from.email },
        reply_to: replyTo ? { email: replyTo } : undefined,
        subject,
        content: [{ type: 'text/plain', value: text }],
        tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false } },
      }),
    });
    if (!r.ok) throw new Error('SendGrid: ' + (await r.text()).slice(0, 200));
    return;
  }

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.EMAIL_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: from.name ? `${from.name} <${from.email}>` : from.email,
      to: [to],
      subject,
      text,
      reply_to: replyTo || undefined,
    }),
  });
  if (!r.ok) throw new Error('Resend: ' + (await r.text()).slice(0, 200));
}
