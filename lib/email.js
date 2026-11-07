// Sends one plain-text email through Resend (default) or SendGrid.
export async function sendEmail(env, { to, subject, text, replyTo, unsubUrl }) {
  const provider = (env.EMAIL_PROVIDER || 'resend').toLowerCase();
  const headers = {
    'List-Unsubscribe': `<${unsubUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };

  if (provider === 'sendgrid') {
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
