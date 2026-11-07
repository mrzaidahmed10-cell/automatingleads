import { json, hmacHex, safeEqual } from '../../lib/util.js';

export async function onRequestPost({ request, env }) {
  if (!env.DASH_PASSWORD) return json({ error: 'DASH_PASSWORD secret is not set.' }, 500);
  const { password = '' } = await request.json().catch(() => ({}));
  // Compare hashes so length differences don't leak
  const ok = safeEqual(await hmacHex('cmp', String(password)), await hmacHex('cmp', env.DASH_PASSWORD));
  if (!ok) {
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: 'Wrong password' }, 401);
  }
  const token = await hmacHex(env.DASH_PASSWORD, 'leads-session-v1');
  return json({ ok: true }, 200, {
    'set-cookie': `ls=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`,
  });
}
