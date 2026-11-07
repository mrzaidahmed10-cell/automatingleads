// Sends one email (plain text + simple HTML) through Gmail API, Resend (default) or SendGrid.
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
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Body + signature + a clickable "Unsubscribe" link (HTML) / plain URL (text fallback)
export function renderEmail(s, body, unsubUrl) {
  const sig = [s.senderName, s.businessName, s.address].filter(Boolean);
  const text = `${body}\n\n--\n${sig.join('\n')}\nUnsubscribe: ${unsubUrl}`;
  const linked = esc(body).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#1a56db">${u}</a>`);
  const html =
    `<div style="font:15px/1.6 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#222">` +
    `<div>${linked.replace(/\r?\n/g, '<br>')}</div>` +
    `<div style="margin-top:24px;font-size:12px;line-height:1.5;color:#777">${sig.map(esc).join('<br>')}<br>` +
    `<a href="${esc(unsubUrl)}" style="color:#777">Unsubscribe</a></div></div>`;
  return { text, html };
}

function parseFrom(v) {
  const m = String(v || '').match(/^(.*)<(.+)>$/);
  return m ? { name: m[1].trim().replace(/^"|"$/g, ''), email: m[2].trim() } : { name: '', email: String(v || '').trim() };
}

// Sender = your name (from Settings) + the configured address. Gmail: falls back to a gmail.com reply-to.
function senderFor(env, fromName, replyTo) {
  const base = parseFrom(env.EMAIL_FROM);
  let email = base.email;
  if (!email && provider(env) === 'gmail' && /@(gmail|googlemail)\.com$/i.test(replyTo || '')) email = replyTo;
  if (!email) return null;
  return { name: String(fromName || base.name || '').replace(/["<>\r\n]/g, '').trim(), email };
}

const nameHeader = (n) => (/[^\x20-\x7e]/.test(n) ? `=?UTF-8?B?${b64(enc.encode(n))}?=` : `"${n}"`);

export function buildMime({ from, to, subject, text, html, replyTo, headers }) {
  const b = 'b_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const lines = [];
  if (from) lines.push('From: ' + (from.name ? `${nameHeader(from.name)} <${clean(from.email)}>` : clean(from.email)));
  lines.push('To: ' + clean(to));
  if (replyTo) lines.push('Reply-To: ' + clean(replyTo));
  lines.push('Subject: =?UTF-8?B?' + b64(enc.encode(clean(subject))) + '?=');
  lines.push('MIME-Version: 1.0');
  for (const [k, v] of Object.entries(headers || {})) lines.push(`${k}: ${clean(v)}`);
  lines.push(`Content-Type: multipart/alternative; boundary="${b}"`);
  const part = (type, content) =>
    `--${b}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(b64(enc.encode(content)))}\r\n`;
  return lines.join('\r\n') + '\r\n\r\n' + part('text/plain', text) + part('text/html', html) + `--${b}--`;
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
        ? 'Gmail refresh token expired or revoked. Generate a new one (and publish your OAuth app so it stops expiring).'
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

export async function sendEmail(env, { to, subject, text, html, replyTo, unsubUrl, fromName }) {
  const headers = {
    'List-Unsubscribe': `<${unsubUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
  const from = senderFor(env, fromName, replyTo);

  if (provider(env) === 'gmail') return sendGmail(env, { from, to, subject, text, html, replyTo, headers });

  if (provider(env) === 'sendgrid') {
    const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.EMAIL_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: from.name ? from : { email: from.email },
        reply_to: replyTo ? { email: replyTo } : undefined,
        subject,
        content: [
          { type: 'text/plain', value: text },
          { type: 'text/html', value: html },
        ],
        headers,
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
      html,
      reply_to: replyTo || undefined,
      headers,
    }),
  });
  if (!r.ok) throw new Error('Resend: ' + (await r.text()).slice(0, 200));
}
