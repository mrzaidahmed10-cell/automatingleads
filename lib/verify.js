// Checks whether a business really has no website. OpenStreetMap often lacks the website tag even when a site exists,
// so "no website listed" is only a hint. Two independent checks: guess likely domains and look at the page, and web search.
import { get, strip } from './audit.js';
import { search } from './providers.js';

const STOP = new Set(['the', 'and', 'llc', 'inc', 'co', 'corp', 'company', 'ltd', 'of', 'at', 'in', 'on', 'for', 'a', 'an', 'by']);
const GENERIC = new Set(['shop', 'salon', 'studio', 'barber', 'barbershop', 'restaurant', 'cafe', 'bar', 'grill', 'pizza', 'auto', 'repair', 'service', 'services', 'store', 'center', 'clinic']);

// listings and booking pages: a presence, but not the business's own website
export const LISTING = /(^|\.)(yelp|tripadvisor|yellowpages|mapquest|bbb|manta|chamberofcommerce|cylex|showmelocal|foursquare|nextdoor|angi|angieslist|thumbtack|homeadvisor|doordash|ubereats|grubhub|seamless|toasttab|opentable|zomato|restaurantji|menupix|alignable|bing|google|waze|apple|wikipedia|linkedin|pinterest|youtube|booksy|vagaro|fresha|styleseat|schedulicity|mindbodyonline|groupon|superpages|citysearch|loc8nearme|usnews|indeed|glassdoor|expertise|porch|bark|fixr|birdeye|trustpilot|local|data\.com|dnb|zoominfo|buzzfile|opengovus|opencorporates|bizapedia|mapcarta|findglocal|brownbook|hotfrog|tupalo|ezlocal|merchantcircle|yellowbot|yp)\.[a-z.]+$/i;
export const SOCIAL = /(^|\.)(facebook|fb|instagram|tiktok|twitter|x|linktr|linktree|snapchat|threads)\.(com|ee|me|net)$/i;
export const PARKED = /(domain (is )?for sale|buy this domain|this domain (may be|is) for sale|parked (free|domain)|sedo|hugedomains|godaddy\.com\/domains|is available for purchase|default web page|coming soon|under construction|website expired|account suspended)/i;

export const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/['’`]/g, '');
const words = (s) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
export const sig = (name) => words(name).filter((w) => w.length >= 2 && !STOP.has(w));

export function candidateDomains(name, city = '') {
  const w = sig(name);
  if (!w.length) return [];
  const c = words(city.split(',')[0]).join('');
  const nog = w.filter((x) => !GENERIC.has(x));
  const bases = new Set();
  const add = (a) => a && a.length >= 3 && a.length <= 40 && bases.add(a);
  add(w.join(''));
  add(w.join('-'));
  if (nog.length && nog.length !== w.length) add(nog.join(''));
  if (w.length > 2) add(w.slice(0, 2).join(''));
  if (c) add(w.join('') + c);
  if (/s$/.test(w[0]) === false && w.length > 1) add(w[0] + 's' + w.slice(1).join(''));
  const bs = [...bases].slice(0, 5);
  const out = bs.map((b) => b + '.com'); // every spelling on .com first, then other endings for the best guesses
  if (bs[0]) out.push(bs[0] + '.net', bs[0] + '.co');
  if (bs[1]) out.push(bs[1] + '.net');
  return [...new Set(out)].slice(0, 8);
}

const digits = (s) => String(s || '').replace(/\D/g, '');

// Does this page look like THIS business? Needs the name plus a location or phone signal.
export function sameBusiness(html, lead, city = '') {
  const text = fold(strip(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')));
  const head = fold((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '') + ' ' + fold(strip((html.match(/<h1[\s\S]*?<\/h1>/i) || [])[0] || ''));
  const toks = sig(lead.name);
  if (!toks.length) return { ok: false, why: 'no name' };
  const inHead = toks.filter((t) => head.includes(t)).length / toks.length;
  const inText = toks.filter((t) => text.includes(t)).length / toks.length;
  const nameOk = toks.length === 1 ? inHead >= 1 : inHead >= 0.6 || inText >= 1;
  if (!nameOk) return { ok: false, why: 'name not on page' };
  const ph = digits(lead.phone).slice(-7);
  const phone = ph.length === 7 && digits(text).includes(ph);
  const cityWord = words(String(city).split(',')[0] || (lead.address || '').split(',').pop() || '').join(' ');
  const cityHit = cityWord.length >= 3 && text.includes(cityWord);
  const street = fold((lead.address || '').split(',')[0]).trim();
  const streetHit = street.length >= 6 && text.includes(street);
  if (phone || streetHit) return { ok: true, strong: true, why: phone ? 'phone number matches' : 'street address matches' };
  if (cityHit) return { ok: true, strong: false, why: 'name and city match' };
  return { ok: false, why: 'name matches but nothing places it near this business' };
}

async function probe(host, lead, city, tryHttp) {
  for (const scheme of tryHttp ? ['https://', 'http://'] : ['https://']) {
    const r = await get(scheme + host + '/', 4500);
    if (r.blocked) return null;
    if (!r.ok) {
      if (scheme === 'https://' && r.status === 0) continue; // may simply not do https
      return null;
    }
    if (r.text.length < 400) return null;
    if (PARKED.test(strip(r.text).slice(0, 6000)) && r.text.length < 30000) return { parked: true };
    const m = sameBusiness(r.text, lead, city);
    return m.ok ? { url: r.url.split(/[?#]/)[0], ...m } : { rejected: m.why };
  }
  return null;
}

export const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

export { search } from './providers.js';

export async function verifySite(env, lead, city = '') {
  const checkedAt = Date.now();
  const evidence = [];
  if (lead.website) return { status: 'site', site: lead.website, source: 'listed', evidence: ['A website is already on file'], checkedAt };

  // 1. likely domains
  const doms = candidateDomains(lead.name, city || String(lead.address || '').split(',').pop());
  const results = await Promise.all(doms.map((d, i) => probe(d, lead, city, d.endsWith('.com') && i <= 4).catch(() => null)));
  let best = null;
  results.forEach((r, i) => {
    if (r?.url && (!best || (r.strong && !best.strong))) best = { ...r, domain: doms[i] };
  });
  if (best) return { status: 'site', site: best.url, source: 'domain', evidence: [`${hostOf(best.url)}: ${best.why}`], checkedAt };
  const near = results.map((r, i) => (r?.rejected ? doms[i] : null)).filter(Boolean);
  if (near.length) evidence.push(`${near[0]} exists but is a different business`);

  // 2. web search
  const hits = await search(env, `"${lead.name}" ${city}`.trim());
  let searched = hits !== null;
  let social = null;
  if (hits) {
    const toks = sig(lead.name);
    for (const h of hits.slice(0, 6)) {
      const host = hostOf(h.url);
      if (!host) continue;
      const blob = fold(h.title + ' ' + h.snippet + ' ' + host);
      const named = toks.length && toks.filter((t) => blob.includes(t)).length / toks.length >= 0.6;
      if (!named) continue;
      if (SOCIAL.test(host)) {
        social ||= h.url;
        continue;
      }
      if (LISTING.test(host)) continue;
      const root = new URL(h.url).origin + '/';
      const r = await get(root, 5000);
      if (r.ok && !(PARKED.test(strip(r.text).slice(0, 6000)) && r.text.length < 30000)) {
        const m = sameBusiness(r.text, lead, city);
        if (m.ok) return { status: 'site', site: r.url.split(/[?#]/)[0], source: 'search', evidence: [`Found by web search: ${m.why}`], checkedAt };
        evidence.push(`${host} looked related but did not match`);
      }
    }
  }
  if (social) return { status: 'social', social, evidence: [...evidence, 'Only a social media page turned up'], checkedAt, searched };
  if (!searched) evidence.push('Web search was not available, so this is based on domain checks only');
  return { status: 'none', confidence: searched ? 'high' : 'medium', evidence: [...evidence, searched ? 'No website found by domain checks or web search' : 'No website found by domain checks'], checkedAt, searched };
}
