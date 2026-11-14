// Every outside data source in one place: web search, Google Maps data, page reading, DNS checks, and a live health test for each.
// Keys come from Cloudflare secrets only. Each source can fail on its own, and the next one takes over.
import { strip, get } from './audit.js';

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const T = (ms) => AbortSignal.timeout(ms);
const hit = (url, title, snippet) => ({ url, title: strip(title || ''), snippet: strip(snippet || '') });

/* ---------------- web search ---------------- */
async function viaSerper(env, q) {
  const r = await fetch('https://google.serper.dev/search', { method: 'POST', signal: T(8000), headers: { 'x-api-key': env.SERPER_API_KEY.trim(), 'content-type': 'application/json' }, body: JSON.stringify({ q, num: 8, gl: 'us', hl: 'en' }) });
  if (!r.ok) throw new Error('Serper HTTP ' + r.status);
  const j = await r.json();
  const out = [];
  const kg = j.knowledgeGraph;
  if (kg && kg.website) out.push(hit(kg.website, kg.title, [kg.description, ...Object.entries(kg.attributes || {}).map(([k, v]) => k + ': ' + v)].filter(Boolean).join('. ')));
  for (const x of j.organic || []) out.push(hit(x.link, x.title, x.snippet));
  return out.slice(0, 9);
}
async function viaTavily(env, q) {
  const r = await fetch('https://api.tavily.com/search', { method: 'POST', signal: T(9000), headers: { authorization: 'Bearer ' + env.TAVILY_API_KEY.trim(), 'content-type': 'application/json' }, body: JSON.stringify({ query: q, max_results: 8, search_depth: 'basic' }) });
  if (!r.ok) throw new Error('Tavily HTTP ' + r.status);
  const j = await r.json();
  return (j.results || []).map((x) => hit(x.url, x.title, x.content));
}
async function viaBrave(env, q) {
  const r = await fetch('https://api.search.brave.com/res/v1/web/search?count=8&q=' + encodeURIComponent(q), { signal: T(8000), headers: { 'x-subscription-token': env.BRAVE_API_KEY.trim(), accept: 'application/json' } });
  if (!r.ok) throw new Error('Brave HTTP ' + r.status);
  const j = await r.json();
  return (j.web?.results || []).map((x) => hit(x.url, x.title, x.description));
}
async function viaJina(env, q) {
  const r = await fetch('https://s.jina.ai/?q=' + encodeURIComponent(q), { signal: T(10000), headers: { authorization: 'Bearer ' + env.JINA_API_KEY.trim(), accept: 'application/json', 'x-respond-with': 'no-content' } });
  if (!r.ok) throw new Error('Jina HTTP ' + r.status);
  const j = await r.json();
  return (j.data || []).map((x) => hit(x.url, x.title, x.description));
}
async function viaDdg(_env, q) {
  const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), { signal: T(7000), headers: { 'user-agent': BROWSER_UA, accept: 'text/html', 'accept-language': 'en-US,en;q=0.9' } });
  if (r.status !== 200) throw new Error('DuckDuckGo HTTP ' + r.status + ' (blocks servers)');
  const html = (await r.text()).slice(0, 400000);
  if (!/result__a/.test(html)) {
    if (/no\s+results/i.test(html)) return Object.assign([], { explicit: true });
    throw new Error('DuckDuckGo showed a bot check');
  }
  return parseDdg(html);
}
export function parseDdg(html) {
  const out = [];
  for (const part of html.split(/<a[^>]+class="result__a"/i).slice(1)) {
    const hm = part.match(/href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!hm) continue;
    let u = hm[1].replace(/&amp;/g, '&');
    const d = u.match(/[?&]uddg=([^&]+)/);
    if (d) u = decodeURIComponent(d[1]);
    if (u.startsWith('//')) u = 'https:' + u;
    const sn = part.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)>/i);
    out.push(hit(u, hm[2], sn ? sn[1] : ''));
    if (out.length >= 8) break;
  }
  return out;
}
async function viaDdgLite(_env, q) {
  const r = await fetch('https://lite.duckduckgo.com/lite/', { method: 'POST', signal: T(7000), headers: { 'user-agent': BROWSER_UA, 'content-type': 'application/x-www-form-urlencoded', 'accept-language': 'en-US,en;q=0.9' }, body: new URLSearchParams({ q }) });
  if (r.status !== 200) throw new Error('DuckDuckGo Lite HTTP ' + r.status);
  const html = (await r.text()).slice(0, 400000);
  const out = [];
  for (const part of html.split(/<a[^>]+class=['"]result-link['"]/i).slice(1)) {
    const hm = part.match(/href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!hm) continue;
    let u = hm[1].replace(/&amp;/g, '&');
    const d = u.match(/[?&]uddg=([^&]+)/);
    if (d) u = decodeURIComponent(d[1]);
    if (u.startsWith('//')) u = 'https:' + u;
    const sn = part.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/i);
    out.push(hit(u, hm[2], sn ? sn[1] : ''));
    if (out.length >= 8) break;
  }
  if (!out.length && !/no\s+results/i.test(html)) throw new Error('DuckDuckGo Lite gave no parsable results');
  return out;
}
export function parseBing(html) {
  const out = [];
  for (const part of html.split(/<li[^>]+class="b_algo"/i).slice(1)) {
    const hm = part.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!hm) continue;
    let u = hm[1].replace(/&amp;/g, '&');
    const e = u.match(/[?&]u=a1([A-Za-z0-9_-]+)/); // Bing sometimes wraps links in a base64 redirect
    if (e) {
      try {
        u = atob(e[1].replace(/-/g, '+').replace(/_/g, '/'));
      } catch {}
    }
    if (!/^https?:/.test(u)) continue;
    const sn = part.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    out.push(hit(u, hm[2], sn ? sn[1] : ''));
    if (out.length >= 8) break;
  }
  return out;
}
async function viaBing(_env, q) {
  const r = await fetch('https://www.bing.com/search?setlang=en-US&cc=us&q=' + encodeURIComponent(q), { signal: T(7000), headers: { 'user-agent': BROWSER_UA, 'accept-language': 'en-US,en;q=0.9', accept: 'text/html' } });
  if (r.status !== 200) throw new Error('Bing HTTP ' + r.status);
  const html = (await r.text()).slice(0, 500000);
  const out = parseBing(html);
  if (!out.length && !/b_algo|no results/i.test(html)) throw new Error('Bing gave no parsable results');
  return out;
}
export function parseMojeek(html) {
  const out = [];
  for (const part of html.split(/<li[^>]*>\s*<h2>/i).slice(1)) {
    const hm = part.match(/<a[^>]+href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!hm) continue;
    const sn = part.match(/<p class="s">([\s\S]*?)<\/p>/i);
    out.push(hit(hm[1].replace(/&amp;/g, '&'), hm[2], sn ? sn[1] : ''));
    if (out.length >= 8) break;
  }
  return out;
}
async function viaMojeek(_env, q) {
  const r = await fetch('https://www.mojeek.com/search?q=' + encodeURIComponent(q), { signal: T(7000), headers: { 'user-agent': BROWSER_UA, 'accept-language': 'en-US,en;q=0.9' } });
  if (r.status !== 200) throw new Error('Mojeek HTTP ' + r.status);
  const out = parseMojeek((await r.text()).slice(0, 400000));
  return out;
}

export const ENGINES = [
  { id: 'serper', name: 'Serper (Google results)', key: 'SERPER_API_KEY', run: viaSerper },
  { id: 'tavily', name: 'Tavily', key: 'TAVILY_API_KEY', run: viaTavily },
  { id: 'brave', name: 'Brave Search', key: 'BRAVE_API_KEY', run: viaBrave },
  { id: 'jina', name: 'Jina Search', key: 'JINA_API_KEY', run: viaJina },
  { id: 'ddg', name: 'DuckDuckGo', run: viaDdg },
  { id: 'ddglite', name: 'DuckDuckGo Lite', run: viaDdgLite },
  { id: 'bing', name: 'Bing (page)', run: viaBing },
  { id: 'mojeek', name: 'Mojeek', run: viaMojeek },
];

// Tries keyed engines first, then the free ones, until one answers. Returns { hits, via, tried } or null if none worked.
export async function searchWeb(env, q) {
  const tried = [];
  for (const e of ENGINES) {
    if (e.key && !env[e.key]) continue;
    try {
      const hits = await e.run(env, q);
      if (hits.length || e.key || hits.explicit) return { hits, via: e.id, tried };
      tried.push(e.id + ': no results');
    } catch (err) {
      tried.push(e.id + ': ' + String(err.message || err).slice(0, 80));
    }
  }
  return null;
}
export async function search(env, q) {
  const r = await searchWeb(env, q);
  if (!r) return null;
  const arr = r.hits;
  arr.via = r.via;
  return arr;
}

/* ---------------- Google Maps data through Serper ---------------- */
export async function serperPlaces(env, query, page = 1) {
  const r = await fetch('https://google.serper.dev/places', { method: 'POST', signal: T(10000), headers: { 'x-api-key': env.SERPER_API_KEY.trim(), 'content-type': 'application/json' }, body: JSON.stringify({ q: query, gl: 'us', hl: 'en', ...(page > 1 ? { page } : {}) }) });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Serper HTTP ${r.status} ${t.replace(/\s+/g, ' ').slice(0, 100)}`);
  }
  return (await r.json()).places || [];
}

/* ---------------- page reading through Jina when a site refuses servers ---------------- */
export async function jinaFetch(env, url) {
  const headers = { accept: 'text/html', 'x-return-format': 'html', 'x-timeout': '8' };
  if (env.JINA_API_KEY) headers.authorization = 'Bearer ' + env.JINA_API_KEY.trim();
  const r = await fetch('https://r.jina.ai/' + url, { signal: T(12000), headers });
  if (!r.ok) return null;
  const text = (await r.text()).slice(0, 600000);
  return text.length > 200 ? text : null;
}

/* ---------------- DNS: does this email domain accept mail? ---------------- */
const mxCache = new Map();
export async function hasMx(domain) {
  domain = String(domain || '').toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return false;
  if (mxCache.has(domain)) return mxCache.get(domain);
  let res = null;
  for (const base of ['https://cloudflare-dns.com/dns-query', 'https://dns.google/resolve']) {
    try {
      const r = await fetch(`${base}?name=${encodeURIComponent(domain)}&type=MX`, { signal: T(3500), headers: { accept: 'application/dns-json' } });
      if (!r.ok) continue;
      const j = await r.json();
      if (j.Status === 3) { res = false; break; } // NXDOMAIN: the domain does not exist
      if (j.Status === 0) {
        res = (j.Answer || []).some((x) => x.type === 15); // no MX record means mail to it bounces
        break;
      }
    } catch {
      /* try the next resolver */
    }
  }
  if (res !== null) mxCache.set(domain, res);
  return res; // null = could not tell
}

/* ---------------- live health test, one source at a time ---------------- */
export const CATALOG = [
  { id: 'osm', name: 'OpenStreetMap', role: 'Finds businesses', free: 'Free, no key', recommended: false },
  { id: 'serper', name: 'Serper', role: 'Google Maps data (phone, website, ratings) and Google search', key: 'SERPER_API_KEY', signup: 'https://serper.dev', free: '2,500 free searches, no card', recommended: true },
  { id: 'tavily', name: 'Tavily', role: 'Web search for website and contact checks', key: 'TAVILY_API_KEY', signup: 'https://app.tavily.com', free: '1,000 free searches a month, no card', recommended: true },
  { id: 'jina', name: 'Jina Reader', role: 'Reads pages that block servers. Key is optional and raises the limit', key: 'JINA_API_KEY', signup: 'https://jina.ai/reader', free: 'Works with no key (20 per minute). Free key gives 500 per minute', recommended: false },
  { id: 'google', name: 'Google Places', role: 'Google Maps data, official', key: 'GOOGLE_PLACES_KEY', signup: 'https://console.cloud.google.com', free: 'Needs a billing card (monthly free credit)', recommended: false },
  { id: 'brave', name: 'Brave Search', role: 'Web search', key: 'BRAVE_API_KEY', signup: 'https://brave.com/search/api', free: 'Needs a card on file', recommended: false },
  { id: 'free-search', name: 'Free search engines', role: 'DuckDuckGo, Bing and Mojeek pages. Often blocked on shared server addresses', free: 'No key', recommended: false },
  { id: 'dns', name: 'Email domain check', role: 'Drops addresses whose domain cannot receive mail', free: 'Free, no key', recommended: false },
  { id: 'gmail', name: 'Gmail sending', role: 'Sends your emails', recommended: false },
  { id: 'groq', name: 'Groq AI', role: 'Writes drafts and powers the assistant', key: 'GROQ_API_KEY', signup: 'https://console.groq.com', free: 'Free', recommended: false },
];

const timed = async (fn) => {
  const t = Date.now();
  try {
    const detail = await fn();
    return { ok: true, ms: Date.now() - t, detail: detail || 'Working' };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, detail: String(e.message || e).slice(0, 160) };
  }
};

export async function testSource(env, id, extra = {}) {
  switch (id) {
    case 'osm':
      return timed(async () => {
        const q = '[out:json][timeout:8];node(41.6611,-91.5302,41.6613,-91.5300);out 1;';
        const hosts = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
        const h = await Promise.any(hosts.map(async (u) => { const r = await fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: T(9000), headers: { 'content-type': 'application/x-www-form-urlencoded' } }); if (!r.ok) throw new Error('HTTP ' + r.status); await r.json(); return new URL(u).hostname; })).catch(() => { throw new Error('Every OpenStreetMap server refused this request. Searches will use the backup sources and your browser.'); });
        return 'Reached ' + h;
      });
    case 'serper':
      return timed(async () => {
        const p = await serperPlaces(env, 'barber shop in Iowa City, Iowa');
        return `Working. Google Maps returned ${p.length} places`;
      });
    case 'tavily':
      return timed(async () => (await viaTavily(env, 'Iowa City barber shop')).length + ' results');
    case 'brave':
      return timed(async () => (await viaBrave(env, 'Iowa City barber shop')).length + ' results');
    case 'jina':
      return timed(async () => {
        const t = await jinaFetch(env, 'https://example.com/');
        if (!t) throw new Error('Reader returned nothing');
        return env.JINA_API_KEY ? 'Reader works (with your key)' : 'Reader works (no key, 20 per minute)';
      });
    case 'google':
      return timed(async () => {
        const r = await fetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST', signal: T(8000), headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GOOGLE_PLACES_KEY, 'x-goog-fieldmask': 'places.id' }, body: JSON.stringify({ textQuery: 'barber Iowa City', pageSize: 1 }) });
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).replace(/\s+/g, ' ').slice(0, 100));
        return 'Working';
      });
    case 'free-search': {
      const rs = await Promise.all(['ddg', 'ddglite', 'bing', 'mojeek'].map(async (e) => [e, await timed(async () => (await ENGINES.find((x) => x.id === e).run(env, 'Iowa City barber shop')).length + ' results')]));
      const ok = rs.filter(([, r]) => r.ok && !/^0 /.test(r.detail));
      return { ok: ok.length > 0, ms: Math.max(...rs.map(([, r]) => r.ms)), detail: rs.map(([e, r]) => `${e}: ${r.ok ? r.detail : r.detail.split(' (')[0]}`).join(' · ') };
    }
    case 'dns':
      return timed(async () => {
        const a = await hasMx('gmail.com'), b = await hasMx('this-domain-should-not-exist-flightline.com');
        if (a !== true) throw new Error('Could not reach a DNS resolver');
        return b === false ? 'Working' : 'Reachable';
      });
    case 'gmail':
      return timed(async () => {
        const { gmailAccessToken } = await import('./email.js');
        await gmailAccessToken(env);
        return 'Signed in. Sending is ready';
      });
    default:
      return { ok: false, ms: 0, detail: 'Unknown source' };
  }
}

export const configuredMap = (env) => ({
  serper: !!env.SERPER_API_KEY, tavily: !!env.TAVILY_API_KEY, brave: !!env.BRAVE_API_KEY, jina: !!env.JINA_API_KEY, google: !!env.GOOGLE_PLACES_KEY, groq: !!env.GROQ_API_KEY,
});
export { get };
