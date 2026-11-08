// Scores how weak a business website is (higher = weaker site = better lead) and looks for a contact email.
// Every fetch goes through allowedUrl(), so a crafted website value can't make the server call internal or odd targets.
const BAD_EMAIL = /(sentry|wixpress|example\.|domain\.com|yourname|email@|user@|noreply|no-reply|\.(png|jpe?g|gif|svg|webp)$)/i;
const MAX_BYTES = 300000;

export function allowedUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(u.protocol)) return null;
  if (u.username || u.password) return null;
  if (u.port && !['80', '443'].includes(u.port)) return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || h.startsWith('[') || h.includes(':')) return null; // no single-label names or IPv6 literals
  if (h === 'localhost' || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(h)) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return null;
  }
  return u;
}

async function readLimited(r) {
  if (!r.body) return '';
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let out = '';
  let n = 0;
  while (n < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    out += dec.decode(value, { stream: true });
  }
  try {
    await reader.cancel();
  } catch {}
  return out.slice(0, MAX_BYTES);
}

async function get(url, ms = 8000) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), ms);
  let cur = url;
  try {
    for (let hop = 0; hop < 4; hop++) {
      const u = allowedUrl(cur);
      if (!u) return { ok: false, status: 0, url: cur, text: '', ms: Date.now() - t0, blocked: true };
      const r = await fetch(u.href, {
        signal: ctl.signal,
        redirect: 'manual',
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; SiteCheck/1.0)', accept: 'text/html' },
      });
      if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.get('location')) {
        try {
          r.body?.cancel();
        } catch {}
        try {
          cur = new URL(r.headers.get('location'), u).href;
        } catch {
          return { ok: false, status: 0, url: cur, text: '', ms: Date.now() - t0 };
        }
        continue;
      }
      const text = r.ok ? await readLimited(r) : '';
      return { ok: r.ok, status: r.status, url: u.href, text, ms: Date.now() - t0 };
    }
    return { ok: false, status: 0, url: cur, text: '', ms: Date.now() - t0 };
  } catch {
    return { ok: false, status: 0, url: cur, text: '', ms: Date.now() - t0 };
  } finally {
    clearTimeout(to);
  }
}

function findEmails(html) {
  const found = new Set();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) {
    try {
      found.add(decodeURIComponent(m[1]).toLowerCase());
    } catch {}
  }
  for (const m of html.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) found.add(m[0].toLowerCase());
  return [...found].filter((e) => !BAD_EMAIL.test(e) && e.length <= 254);
}

export async function auditSite(raw) {
  const input = String(raw || '').trim().slice(0, 300);
  const candidates = /^https?:\/\//i.test(input) ? [input] : ['https://' + input, 'http://' + input];
  let res = null;
  for (const c of candidates) {
    res = await get(c);
    if (res.ok || res.blocked) break;
  }

  const issues = [];
  let score = 0;
  const add = (pts, msg) => {
    score += pts;
    issues.push(msg);
  };

  if (!res.ok) {
    if (res.blocked) add(0, 'Website address could not be checked');
    else add(res.status ? 60 : 70, res.status ? `Site returns an error (HTTP ${res.status})` : 'Site did not load (timeout or connection error)');
    return { score: Math.min(score, 100), issues, email: '', ms: res.ms, finalUrl: res.url, checkedAt: Date.now() };
  }

  const html = res.text;
  if (!res.url.startsWith('https://')) add(25, 'Not served over HTTPS (browsers warn visitors)');
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) add(25, 'Not mobile-friendly (no viewport tag)');
  if (res.ms > 3500) add(10, `Slow to respond (${(res.ms / 1000).toFixed(1)}s)`);

  const years = [...html.matchAll(/(?:©|&copy;|copyright)[^0-9]{0,25}((?:19|20)\d\d)/gi)].map((m) => +m[1]);
  const newest = years.length ? Math.max(...years) : 0;
  if (newest && newest <= new Date().getFullYear() - 3) add(15, `Footer copyright still says ${newest}`);

  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  if (title.trim().length < 5) add(5, 'Missing or empty page title');
  if (html.length < 5000) add(10, 'Very thin page with little content');
  if ((html.match(/<table/gi) || []).length > 8 && !/display:\s*(flex|grid)/i.test(html)) add(10, 'Old table-based layout');
  if (/\.swf|<embed[^>]+flash/i.test(html)) add(10, 'Uses Flash');
  if (!/href=["']tel:/i.test(html) && !/<form/i.test(html)) add(10, 'No click-to-call or contact form');

  let emails = findEmails(html);
  if (!emails.length) {
    const c = await get(new URL('/contact', res.url).href, 6000);
    if (c.ok) emails = findEmails(c.text);
  }

  return { score: Math.min(score, 100), issues, email: emails[0] || '', ms: res.ms, finalUrl: res.url, checkedAt: Date.now() };
}
