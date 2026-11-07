// Sends one plain-text email through Gmail API, Resend (default) or SendGrid.
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
const cleanHeader = (v) => String(v).replace(/[\r\n]+/g, ' ');

export function buildMime({ from, to, subject, text, replyTo, headers }) {
  const lines = [];
  if (from) lines.push('From: ' + cleanHeader(from));
  lines.push('To: ' + cleanHeader(to));
  if (replyTo) lines.push('Reply-To: ' + cleanHeader(replyTo));
  lines.push('Subject: =?UTF-8?B?' + b64(enc.encode(cleanHeader(subject))) + '?=');
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: base64');
  for (const [k, v] of Object.entries(headers || {})) lines.push(`${k}: ${cleanHeader(v)}`);
  const body = (b64(enc.encode(text)).match(/.{1,76}/g) || []).join('\r\n');
  return lines.join('\r\n') + '\r\n\r\n' + body;
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
    const why = tj.error === 'invalid_grant'
      ? 'Gmail refresh token expired or revoked. Generate a new one (and publish your OAuth app so it stops expiring).'
      : `Gmail auth failed (${tj.error || tr.status}): ${tj.error_description || 'no details'}. ` +
        'Check that GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN all come from the same OAuth client, with no extra spaces.';
    throw new Error(why);
  }
  const raw = b64url(enc.encode(buildMime({ ...msg, from: env.EMAIL_FROM || '' })));
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${tj.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!r.ok) throw new Error('Gmail: ' + (await r.text()).slice(0, 200));
}

export async function sendEmail(env, { to, subject, text, replyTo, unsubUrl }) {
  const headers = {
    'List-Unsubscribe': `<${unsubUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };

  if (provider(env) === 'gmail') return sendGmail(env, { to, subject, text, replyTo, headers });

  if (provider(env) === 'sendgrid') {
    const m = env.EMAIL_FROM.match(/^(.*)<(.+)>$/);
    const from = m ? { name: m[1].trim().replace(/^"|"$/g, ''), email: m[2].trim() } : { email: env.EMAIL_FROM };
    const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.EMAIL_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from,
        reply_to: replyTo ? { email: replyTo } : undefined,
        subject,
        content: [{ type: 'text/plain', value: text }],
        headers,
      }),
    });
    if (!r.ok) throw new Error('SendGrid: ' + (await r.text()).slice(0, 200));
    return;
  }

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.EMAIL_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text, reply_to: replyTo || undefined, headers }),
  });
  if (!r.ok) throw new Error('Resend: ' + (await r.text()).slice(0, 200));
}
