// Scores how weak a business website is (higher = weaker site = better lead) and looks for a contact email.
const BAD_EMAIL = /(sentry|wixpress|example\.|domain\.com|yourname|email@|user@|noreply|no-reply|\.(png|jpe?g|gif|svg|webp)$)/i;

async function get(url, ms = 8000) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), ms);
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; SiteCheck/1.0)', accept: 'text/html' },
    });
    const text = r.ok ? (await r.text()).slice(0, 300000) : '';
    return { ok: r.ok, status: r.status, url: r.url, text, ms: Date.now() - t0 };
  } catch {
    return { ok: false, status: 0, url, text: '', ms: Date.now() - t0 };
  } finally {
    clearTimeout(to);
  }
}

function findEmails(html) {
  const found = new Set();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) found.add(decodeURIComponent(m[1]).toLowerCase());
  for (const m of html.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) found.add(m[0].toLowerCase());
  return [...found].filter((e) => !BAD_EMAIL.test(e));
}

export async function auditSite(raw) {
  const candidates = /^https?:\/\//i.test(raw) ? [raw] : ['https://' + raw, 'http://' + raw];
  let res = null;
  for (const c of candidates) {
    res = await get(c);
    if (res.ok) break;
  }

  const issues = [];
  let score = 0;
  const add = (pts, msg) => {
    score += pts;
    issues.push(msg);
  };

  if (!res.ok) {
    add(res.status ? 60 : 70, res.status ? `Site returns an error (HTTP ${res.status})` : 'Site did not load (timeout or connection error)');
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
    const base = new URL(res.url).origin;
    const c = await get(base + '/contact', 6000);
    if (c.ok) emails = findEmails(c.text);
  }

  return { score: Math.min(score, 100), issues, email: emails[0] || '', ms: res.ms, finalUrl: res.url, checkedAt: Date.now() };
}
