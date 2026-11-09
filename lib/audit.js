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

function findEmails(html, siteHost = '') {
  const found = new Set();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) {
    try {
      found.add(decodeURIComponent(m[1]).toLowerCase().trim());
    } catch {}
  }
  for (const m of html.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) found.add(m[0].toLowerCase());
  const root = siteHost.replace(/^www\./, '');
  return [...found]
    .filter((e) => !BAD_EMAIL.test(e) && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e))
    .sort((a, b) => (b.endsWith('@' + root) ? 1 : 0) - (a.endsWith('@' + root) ? 1 : 0)) // the business's own domain first
    .slice(0, 5);
}

const FOOD = /(restaurant|cafe|coffee|fast food|bar\b|pub\b|bakery|ice cream|pizza|diner|bistro|grill|catering|deli|taqueria|brewery|food|kitchen|burger|sushi|bbq)/i;
const SOCIAL_ONLY = /(^|\.)(facebook|fb|instagram|linktr|linktree|yelp|tiktok|twitter|x)\.(com|ee|me)$/i;
const BLOCKED_STATUS = new Set([401, 403, 406, 429, 451, 999]);
const strip = (t) => t.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function pageLinks(html) {
  return [...html.matchAll(/<a\b[^>]*?href=["']([^"'#][^"']*)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)].map((m) => ({ href: m[1], text: strip(m[2]).toLowerCase() }));
}

function menuSignals(html) {
  const links = pageLinks(html);
  const menuLinks = links.filter((l) => /\b(menus?|food|drinks?|dinner|lunch|brunch|breakfast)\b/.test(l.text) || /\/(menus?|food|drinks?|eat|dining)(\/|\.|-|$)/i.test(l.href));
  const fileOnly = menuLinks.length > 0 && menuLinks.every((l) => /\.(pdf|jpe?g|png|webp)(\?|$)/i.test(l.href));
  const ordering = links.some((l) => /(toasttab|doordash|ubereats|grubhub|chownow|slicelife|clover\.com|square\.site|opentable|resy\.com|tock|order\.)/i.test(l.href) || /\border (online|now|pickup|delivery)\b/.test(l.text));
  const prices = (html.match(/\$\s?\d{1,3}(?:\.\d\d)?/g) || []).length;
  return { menuLinks: menuLinks.length, fileOnly, ordering, prices };
}

// ---- static look at button CSS: can't render the page here, so this reads the declared sizes ----
const num = (decl, prop) => {
  const m = decl.match(new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*(\\d+(?:\\.\\d+)?)px', 'i'));
  return m ? parseFloat(m[1]) : null;
};
function buttonProblems(css) {
  const out = [];
  const heights = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    if (!/(^|[\s,.#>:])(btn|button|cta|book[a-z-]*|submit|order[a-z-]*)\b|input\[type=["']?(submit|button)/i.test(sel) || /:(hover|focus|active)\b/.test(sel)) continue;
    const d = m[2];
    const h = num(d, 'height') ?? num(d, 'min-height');
    const w = num(d, 'width') ?? num(d, 'min-width');
    const fs = num(d, 'font-size');
    const pad = (d.match(/(?:^|;)\s*padding\s*:\s*([^;]+)/i) || [])[1];
    let pv = null, ph = null;
    if (pad) {
      const v = [...pad.matchAll(/(\d+(?:\.\d+)?)px/g)].map((x) => parseFloat(x[1]));
      if (v.length === 1) pv = ph = v[0];
      else if (v.length >= 2) { pv = v[0]; ph = v[1]; }
    }
    const name = sel.split(',')[0].slice(0, 40);
    if (h) heights.push(h);
    if (h >= 80) out.push(`"${name}" buttons are set ${h}px tall (oversized)`);
    else if (h && h <= 24) out.push(`"${name}" buttons are only ${h}px tall (too small to tap)`);
    if (w >= 420 && !/max-width/.test(d)) out.push(`"${name}" buttons are fixed ${w}px wide (will overflow on phones)`);
    if (fs && fs <= 10) out.push(`"${name}" button text is ${fs}px (hard to read)`);
    if (fs && fs >= 32) out.push(`"${name}" button text is ${fs}px (oversized)`);
    if (pv != null && pv >= 32) out.push(`"${name}" buttons have ${pv}px of vertical padding (oversized)`);
    if (pv != null && ph != null && pv > 0 && ph / pv >= 8 && ph >= 48) out.push(`"${name}" buttons are stretched out of proportion (${pv}px by ${ph}px padding)`);
  }
  if (heights.length >= 2 && Math.max(...heights) / Math.min(...heights) >= 2.5) out.push('Buttons on the site vary a lot in size');
  return [...new Set(out)].slice(0, 3);
}

async function collectCss(html, base) {
  let css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  for (const m of html.matchAll(/<(?:div|a|button|input|span)[^>]*\sstyle=["']([^"']{0,300})["'][^>]*>/gi)) css += `\n.inline{${m[1]}}`;
  const hrefs = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)]
    .map((m) => (m[0].match(/href=["']([^"']+)["']/i) || [])[1])
    .filter((h) => h && !/(bootstrap|font-?awesome|googleapis|gstatic|jquery|normalize|animate|swiper|slick)/i.test(h))
    .slice(0, 2);
  const sheets = await Promise.all(
    hrefs.map(async (h) => {
      try {
        const u = new URL(h, base);
        if (u.hostname !== new URL(base).hostname) return ''; // only the site's own stylesheets
        const r = await get(u.href, 6000);
        return r.ok ? r.text : '';
      } catch {
        return '';
      }
    }),
  );
  return css + '\n' + sheets.join('\n');
}

export async function auditSite(raw, ctx = {}) {
  const input = String(raw || '').trim().slice(0, 300);
  const candidates = /^https?:\/\//i.test(input) ? [input] : ['https://' + input, 'http://' + input];
  let res = null;
  for (const c of candidates) {
    res = await get(c);
    if (res.ok || res.blocked) break;
  }
  const out = (score, issues, extra = {}) => ({ score: Math.min(Math.round(score), 100), issues, good: [], emails: [], email: '', ms: res.ms, finalUrl: res.url, checkedAt: Date.now(), ...extra });

  let siteHost = '';
  try {
    siteHost = new URL(res.url).hostname;
  } catch {}
  if (SOCIAL_ONLY.test(siteHost)) return out(55, ['Their "website" is just a social media page, not a real site of their own']);

  if (!res.ok) {
    if (res.blocked) return out(0, ['Website address could not be checked']);
    if (BLOCKED_STATUS.has(res.status) || res.status === 503) return out(0, [`Site blocks automated checks (HTTP ${res.status}), so it could not be judged. Look at it yourself.`], { unverified: true });
    return out(res.status ? 60 : 70, [res.status ? `Site returns an error (HTTP ${res.status})` : 'Site did not load (timeout or connection error)']);
  }

  const html = res.text;
  const issues = [];
  const good = [];
  let score = 0;
  const add = (pts, msg) => {
    score += pts;
    issues.push(msg);
  };
  const text = strip(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')).toLowerCase();

  if (html.length < 25000 && /(coming soon|under construction|domain (is )?for sale|buy this domain|parked (free|domain)|default web page|site (is )?not (yet )?published)/i.test(text)) add(50, 'Site looks parked, unfinished or "coming soon"');
  if (!res.url.startsWith('https://')) add(25, 'Not served over HTTPS (browsers warn visitors)');
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) add(25, 'Not mobile-friendly (no viewport tag)');
  if (res.ms > 3500) add(10, `Slow to respond (${(res.ms / 1000).toFixed(1)}s)`);

  const years = [...html.matchAll(/(?:©|&copy;|copyright)[^0-9]{0,25}((?:19|20)\d\d)/gi)].map((m) => +m[1]);
  const newest = years.length ? Math.max(...years) : 0;
  if (newest && newest <= new Date().getFullYear() - 3) add(15, `Footer copyright still says ${newest}`);

  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  if (title.trim().length < 5) add(5, 'Missing or empty page title');
  if (!/<meta[^>]+name=["']description["'][^>]+content=["'][^"']{20,}/i.test(html)) add(4, 'No search description (hurts how it shows on Google)');
  if (!/<h1[\s>]/i.test(html)) add(4, 'No main heading on the homepage');
  if (html.length < 5000) add(10, 'Very thin page with little content');
  if ((html.match(/<table/gi) || []).length > 8 && !/display:\s*(flex|grid)/i.test(html)) add(10, 'Old table-based layout');
  if (/\.swf|<embed[^>]+flash/i.test(html)) add(10, 'Uses Flash');
  if ((html.match(/<(font|center|marquee|blink)[\s>]/gi) || []).length >= 3) add(8, 'Built with old-style HTML (font and center tags)');
  if (/jquery[-.]?(1\.|2\.)\d/i.test(html)) add(4, 'Runs very old software (jQuery 1 or 2)');

  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  if (imgs.length >= 4 && imgs.filter((t) => !/\balt=["'][^"']+["']/i.test(t)).length / imgs.length >= 0.6) add(4, 'Most images have no descriptions (bad for accessibility and search)');

  const links = pageLinks(html);
  const hasTel = /href=["']tel:/i.test(html) || /\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/.test(text);
  if (!/href=["']tel:/i.test(html) && !/<form/i.test(html)) add(10, 'No click-to-call or contact form');
  if (!hasTel) add(5, 'Phone number is not easy to find on the homepage');
  if (!/\b(hours|open (daily|mon|tue|wed|thu|fri|sat|sun)|mon(day)?\s*[-–:]|monday|closed)\b/i.test(text)) add(4, 'Opening hours are not on the homepage');

  // ---- business-specific checks ----
  const category = String(ctx.category || '');
  const isFood = FOOD.test(category) || FOOD.test(String(ctx.name || ''));
  let signals = { food: isFood };
  if (isFood) {
    const ms = menuSignals(html);
    signals = { ...signals, ...ms };
    if (ms.menuLinks || ms.prices >= 4) {
      if (ms.fileOnly) add(14, 'Menu is only a PDF or photo, which is slow and hard to read on a phone');
      else good.push('Has a menu');
    } else {
      let found = false;
      for (const p of ['/menu', '/menus']) {
        const r = await get(new URL(p, res.url).href, 5000);
        if (r.ok && (menuSignals(r.text).prices >= 3 || /menu/i.test(strip(r.text).slice(0, 4000)))) {
          found = true;
          break;
        }
      }
      if (found) add(6, 'Their menu exists but is not linked from the homepage');
      else add(25, 'No menu on the website (the first thing a hungry visitor looks for)');
    }
    if (!ms.ordering) add(5, 'No online ordering or reservation link');
    else good.push('Has online ordering or reservations');
  } else if (/(hair|beauty|barber|nail|massage|spa|salon|tattoo|dentist|clinic|chiropract|fitness|gym|yoga|repair|detail|clean|plumb|electric)/i.test(category + ' ' + (ctx.name || ''))) {
    if (!/\b(book|schedule|appointment|reserve|get a quote|free quote|estimate)\b/i.test(text)) add(8, 'No way to book or request a quote online');
    else good.push('Has booking or quote option');
  }

  // ---- buttons ----
  try {
    const css = await collectCss(html, res.url);
    const bp = buttonProblems(css);
    if (bp.length) {
      add(Math.min(6 + bp.length * 4, 16), ...[bp.length === 1 ? 'Button problem: ' + bp[0] : 'Buttons look out of proportion: ' + bp.join('; ')]);
    }
    signals.buttonProblems = bp.length;
  } catch {}

  let emails = findEmails(html, siteHost);
  if (!emails.length) {
    const c = await get(new URL('/contact', res.url).href, 6000);
    if (c.ok) emails = findEmails(c.text, siteHost);
  }

  return out(score, issues, { good, emails, email: emails[0] || '', signals });
}
