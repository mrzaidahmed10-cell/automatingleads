// Finds a business's contact details from public sources: its own website (contact/about pages, structured data),
// web search results, and its public Facebook / Yelp pages where those sites let a server read them.
// Social sites often block automated requests, so each source is best effort and the result says what was reached.
import { get, strip } from './audit.js';
import { search, fold, sig, hostOf, LISTING, SOCIAL, PARKED, sameBusiness } from './verify.js';

const BROWSER = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15', 'accept-language': 'en-US,en;q=0.9' };
const FREE = /(^|\.)(gmail|yahoo|outlook|hotmail|icloud|aol|live|msn|me|proton|protonmail|comcast|att|sbcglobal|verizon)\.(com|net|me)$/i;
const JUNK_DOMAIN = /(^|\.)(sentry|wixpress|wix|squarespace|godaddy|secureserver|cloudflare|google|gstatic|facebook|instagram|yelp|schema|w3|example|domain|yourdomain|email|mysite|website|company|test|sentry-next|shopify|weebly|wordpress|gravatar|jsdelivr|bootstrapcdn)\.[a-z.]+$/i;
const JUNK_USER = /^(example|test|user|name|email|your(name|email)?|john\.?doe|jane\.?doe|noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|webmaster|abuse|privacy|dpo|support@wix)$/i;
const ROLE = /^(info|contact|hello|hi|office|admin|sales|service|services|booking|bookings|appointments|orders|team|mail|enquiries|inquiries|reservations|manager|owner|frontdesk|help)$/i;

export function decodeCf(hex) {
  try {
    const k = parseInt(hex.slice(0, 2), 16);
    let s = '';
    for (let i = 2; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ k);
    return decodeURIComponent(escape(s));
  } catch {
    return '';
  }
}

const unobf = (t) =>
  t
    .replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, '@')
    .replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, '.')
    .replace(/&#0?64;|&commat;|%40/gi, '@')
    .replace(/&#0?46;|&period;/gi, '.');

export function goodEmail(e) {
  e = String(e || '').toLowerCase().trim().replace(/^mailto:/, '').replace(/[.,;:)>\]]+$/, '');
  if (!/^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/.test(e)) return '';
  const [u, d] = e.split('@');
  if (JUNK_USER.test(u) || JUNK_DOMAIN.test(d) || LISTING.test(d) || /\.(png|jpe?g|gif|svg|webp|css|js|woff2?)$/.test(d) || /^\d+x\d+$/.test(u) || /@\dx\./.test(e)) return '';
  if (d.includes('..') || u.includes('..')) return '';
  return e;
}

export function findEmails(html) {
  const out = new Set();
  const t = unobf(html);
  for (const m of t.matchAll(/mailto:([^"'?>\s<]+)/gi)) {
    try {
      out.add(decodeURIComponent(m[1]));
    } catch {
      out.add(m[1]);
    }
  }
  for (const m of t.matchAll(/data-cfemail=["']([0-9a-f]{6,})["']/gi)) out.add(decodeCf(m[1]));
  for (const m of t.matchAll(/(?:\/cdn-cgi\/l\/email-protection#)([0-9a-f]{6,})/gi)) out.add(decodeCf(m[1]));
  for (const m of t.matchAll(/"email"\s*:\s*"([^"]+)"/gi)) out.add(m[1]);
  for (const m of strip(t).matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) out.add(m[0]);
  return [...out].map(goodEmail).filter(Boolean);
}

export function fmtPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (d.length !== 10) return '';
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return '';
  if (/^(\d)\1{9}$/.test(d) || d.slice(3, 6) === '555' || /^(\d{3})\1/.test(d.slice(0, 6) + d.slice(0, 3)) && false) return '';
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function findPhones(html) {
  const out = [];
  const add = (p, strong) => {
    const f = fmtPhone(p);
    if (f && !out.some((o) => o.phone === f)) out.push({ phone: f, strong });
  };
  for (const m of html.matchAll(/href=["']tel:([^"']+)["']/gi)) add(decodeURIComponent(m[1]), true);
  for (const m of html.matchAll(/"telephone"\s*:\s*"([^"]+)"/gi)) add(m[1], true);
  const text = strip(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' '));
  for (const m of text.matchAll(/(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/g)) add(m[0], /(call|phone|tel|text|contact)/i.test(text.slice(Math.max(0, m.index - 40), m.index)));
  return out;
}

const SOCIAL_RX = {
  facebook: /https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/(?!sharer|share|dialog|plugins|tr\b|login|events|groups|watch|policies|help|legal|photo|story)([A-Za-z0-9._\-\/]{3,80})/i,
  instagram: /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|reel|explore|accounts|about)([A-Za-z0-9._]{2,40})/i,
  yelp: /https?:\/\/(?:www\.)?yelp\.com\/biz\/([A-Za-z0-9\-_%]{3,100})/i,
  linkedin: /https?:\/\/(?:www\.)?linkedin\.com\/(company|in)\/([A-Za-z0-9\-_%]{2,80})/i,
  tiktok: /https?:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9._]{2,40})/i,
};
export function findSocial(html) {
  const out = {};
  const m = (k) => html.match(SOCIAL_RX[k]);
  let x;
  if ((x = m('facebook'))) out.facebook = 'https://www.facebook.com/' + x[1].replace(/\/+$/, '').replace(/\/(about|posts|photos|reviews|videos)\b.*$/, '');
  if ((x = m('instagram'))) out.instagram = 'https://www.instagram.com/' + x[1].replace(/\.$/, '');
  if ((x = m('yelp'))) out.yelp = 'https://www.yelp.com/biz/' + x[1];
  if ((x = m('linkedin'))) out.linkedin = `https://www.linkedin.com/${x[1]}/${x[2]}`;
  if ((x = m('tiktok'))) out.tiktok = 'https://www.tiktok.com/@' + x[1];
  return out;
}

function ldAddress(html) {
  for (const m of html.matchAll(/"address"\s*:\s*\{[^}]*\}/gi)) {
    const g = (k) => (m[0].match(new RegExp('"' + k + '"\\s*:\\s*"([^"]+)"')) || [])[1];
    const s = g('streetAddress');
    if (s) return [s, g('addressLocality'), g('addressRegion')].filter(Boolean).join(', ');
  }
  return '';
}

function contactLinks(html, base) {
  const links = [...html.matchAll(/<a\b[^>]*?href=["']([^"'#][^"']*)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)];
  const out = [];
  for (const m of links) {
    const text = strip(m[2]).toLowerCase();
    if (!/(contact|about|reach us|get in touch|location|hours|find us|visit)/.test(text) && !/\/(contact|about|location|find-us|reach)[a-z-]*\/?($|\?)/i.test(m[1])) continue;
    try {
      const u = new URL(m[1], base);
      if (u.hostname.replace(/^www\./, '') !== new URL(base).hostname.replace(/^www\./, '')) continue;
      if (!out.includes(u.href)) out.push(u.href);
    } catch {}
  }
  return out.slice(0, 2);
}

function nameNear(blob, toks) {
  return toks.length > 0 && toks.filter((t) => blob.includes(t)).length / toks.length >= 0.6;
}

// Collects raw findings. Returns { emails: Map, phones: Map, social, website, address, reached: [], notes: [] }
export async function enrichContacts(env, lead, city = '') {
  const toks = sig(lead.name);
  const emails = new Map(); // email -> {source, via, own}
  const phones = new Map();
  const social = {};
  const reached = [];
  const notes = [];
  let address = '';
  let website = '';

  const addEmail = (e, source, via, own = false) => {
    const ok = goodEmail(e);
    if (!ok) return;
    const cur = emails.get(ok);
    if (!cur || (own && !cur.own)) emails.set(ok, { source, via, own });
  };
  const addPhone = (p, source, strong) => {
    if (!phones.has(p)) phones.set(p, { source, strong });
  };
  const takePage = (html, source, via, base) => {
    const root = base ? hostOf(base) : '';
    for (const e of findEmails(html)) addEmail(e, source, via, !!root && (e.endsWith('@' + root) || e.split('@')[1] === root));
    for (const p of findPhones(html)) addPhone(p.phone, source, p.strong);
    Object.assign(social, Object.fromEntries(Object.entries(findSocial(html)).filter(([k]) => !social[k])));
    address ||= ldAddress(html);
  };

  const ownSite = lead.website && !LISTING.test(hostOf(lead.website)) && !SOCIAL.test(hostOf(lead.website)) ? lead.website : '';
  if (lead.website && SOCIAL.test(hostOf(lead.website))) {
    const k = /instagram/i.test(lead.website) ? 'instagram' : 'facebook';
    social[k] ||= lead.website;
  }

  // 1. the business's own website
  if (ownSite) {
    const home = await get(ownSite.startsWith('http') ? ownSite : 'https://' + ownSite, 6000, BROWSER);
    if (home.ok) {
      reached.push('website');
      takePage(home.text, 'website', home.url, home.url);
      const pages = contactLinks(home.text, home.url);
      if (!pages.length) pages.push(new URL('/contact', home.url).href);
      const subs = await Promise.all(pages.map((u) => get(u, 5000, BROWSER)));
      subs.forEach((r) => r.ok && takePage(r.text, 'website', r.url, home.url));
    } else notes.push('Their website did not load');
  }

  // 2. web search
  const where = city || String(lead.address || '').split(',').slice(-2).join(' ');
  const q1 = await search(env, `"${lead.name}" ${where} email phone`.trim());
  let q2 = null;
  if (q1 === null) notes.push('Web search was not available');
  else {
    reached.push('search');
    const sites = [];
    for (const h of q1.slice(0, 8)) {
      const host = hostOf(h.url);
      const blob = fold(h.title + ' ' + h.snippet + ' ' + h.url);
      if (!nameNear(blob, toks)) continue;
      const snippetHtml = h.title + ' ' + h.snippet;
      for (const e of findEmails(snippetHtml)) addEmail(e, 'search', h.url, false);
      for (const p of findPhones(snippetHtml)) addPhone(p.phone, 'search', p.strong);
      const s = findSocial(h.url);
      for (const [k, v] of Object.entries(s)) social[k] ||= v;
      if (!SOCIAL.test(host) && !LISTING.test(host)) sites.push(h.url);
    }
    // a site the search found that the directory did not know about
    if (!ownSite && sites[0]) {
      const r = await get(new URL(sites[0]).origin + '/', 5000, BROWSER);
      if (r.ok && !(PARKED.test(strip(r.text).slice(0, 6000)) && r.text.length < 30000) && sameBusiness(r.text, lead, city).ok) {
        website = r.url.split(/[?#]/)[0];
        reached.push('website');
        takePage(r.text, 'website', r.url, r.url);
      }
    }
  }

  // 3. Facebook page (public pages sometimes show email and phone in their description)
  if (!social.facebook && q1 !== null) {
    q2 = await search(env, `${lead.name} ${where} facebook`);
    for (const h of q2 || []) {
      const s = findSocial(h.url);
      if (s.facebook && nameNear(fold(h.title + ' ' + h.snippet), toks)) {
        social.facebook = s.facebook;
        for (const e of findEmails(h.title + ' ' + h.snippet)) addEmail(e, 'facebook', h.url, false);
        for (const p of findPhones(h.title + ' ' + h.snippet)) addPhone(p.phone, 'facebook', p.strong);
        break;
      }
    }
  }
  if (social.facebook) {
    const path = social.facebook.replace(/^https?:\/\/[^/]+\//, '');
    const fb = await get('https://m.facebook.com/' + path + '/about', 6000, BROWSER);
    const blocked = !fb.ok || /(log in|login)[^<]{0,80}(facebook|continue)/i.test(fb.text.slice(0, 20000)) && fb.text.length < 60000 && !/mailto:|tel:|@[a-z0-9-]+\.[a-z]/i.test(fb.text);
    if (!blocked) {
      reached.push('facebook');
      const meta = (fb.text.match(/<meta[^>]+(?:og:description|name="description")[^>]+content="([^"]*)"/i) || [])[1] || '';
      takePage(fb.text + ' ' + meta, 'facebook', social.facebook, '');
    } else notes.push('Facebook would not show its page to a server');
  }

  // 4. Yelp page: shows phone, address and a link to the business's real website
  if (!social.yelp && q1) {
    for (const h of q1) if (/yelp\.com\/biz\//i.test(h.url) && nameNear(fold(h.title + ' ' + h.snippet), toks)) social.yelp = findSocial(h.url).yelp;
  }
  if (social.yelp) {
    const y = await get(social.yelp, 6000, BROWSER);
    if (y.ok && y.text.length > 5000) {
      reached.push('yelp');
      for (const p of findPhones(y.text)) addPhone(p.phone, 'yelp', p.strong);
      address ||= ldAddress(y.text);
      const redir = y.text.match(/biz_redir\?url=([^&"']+)/i);
      if (redir && !ownSite && !website) {
        try {
          const u = decodeURIComponent(redir[1]);
          if (!LISTING.test(hostOf(u)) && !SOCIAL.test(hostOf(u))) {
            const r = await get(new URL(u).origin + '/', 5000, BROWSER);
            if (r.ok && sameBusiness(r.text, lead, city).ok) {
              website = r.url.split(/[?#]/)[0];
              reached.push('website');
              takePage(r.text, 'website', r.url, r.url);
            }
          }
        } catch {}
      }
    } else notes.push('Yelp would not show its page to a server');
  }

  return { emails, phones, social, website, address, reached: [...new Set(reached)], notes };
}

// Ranks what was found. Best address first: on the business's own domain, then a person/role at a free mailbox that the business itself published.
export function rank(found, leadPhone = '') {
  const em = [...found.emails].map(([email, v]) => {
    const [u, d] = email.split('@');
    let score = 1;
    if (v.own) score = 4;
    else if (FREE.test(d) && (v.source === 'website' || v.source === 'facebook')) score = 3;
    else if (v.source === 'website') score = 2.5;
    else if (v.source === 'facebook') score = 2.5;
    else if (v.source === 'search') score = 2;
    if (ROLE.test(u) && v.own) score += 0.3;
    return { email, source: v.source, via: v.via, score };
  });
  em.sort((a, b) => b.score - a.score);
  const own = fmtPhone(leadPhone);
  const ph = [...found.phones].map(([phone, v]) => ({ phone, source: v.source, score: (v.strong ? 2 : 1) + (v.source === 'website' ? 1 : 0) + (phone === own ? 3 : 0) }));
  ph.sort((a, b) => b.score - a.score);
  return { emails: em.slice(0, 6), phones: ph.slice(0, 4) };
}
