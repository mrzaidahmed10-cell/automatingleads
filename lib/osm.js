// Lead discovery via OpenStreetMap (free, no API key), with fallbacks so one blocked server doesn't break it.
import { searchGoogle, searchSerper } from './places.js';
const UA = 'automatingleads/1.0 (personal lead research tool)';

const CATS = {
  restaurants: '["amenity"~"^(restaurant|cafe|fast_food|bar|pub|bakery|ice_cream)$"]',
  beauty: '["shop"~"^(hairdresser|beauty|barber|nails|massage|tattoo)$"]',
  auto: '["shop"~"^(car_repair|car|car_parts|tyres|car_wash)$"]',
  fitness: '["leisure"~"^(fitness_centre|sports_centre|dance)$"]',
  trades: '["craft"]',
  health: '["amenity"~"^(dentist|clinic|doctors|veterinary|chiropractor)$"]',
  retail: '["shop"]',
  offices: '["office"]',
};
// "Everything" skips the two huge, low-value buckets so the query stays fast
const ALL = ['restaurants', 'beauty', 'auto', 'fitness', 'trades', 'health'];

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];

const US = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida',
  GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine',
  MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
};

async function getJson(url, opt = {}, ms = 12000) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opt, signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(to);
  }
}

async function geocodeOpenMeteo(q) {
  const parts = q.split(',').map((s) => s.trim()).filter(Boolean);
  const name = parts[0];
  const hint = (parts.slice(1).join(' ') || '').toLowerCase();
  const hintFull = (US[hint.toUpperCase()] || hint).toLowerCase();
  const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json`);
  const res = j.results || [];
  if (!res.length) throw new Error('no match');
  const match = hintFull
    ? res.find((r) => [r.admin1, r.admin2, r.country, r.country_code].some((v) => v && (String(v).toLowerCase().includes(hintFull) || hintFull.includes(String(v).toLowerCase()))))
    : null;
  const pick = match || res[0];
  return { lat: pick.latitude, lon: pick.longitude, label: [pick.name, pick.admin1, pick.country_code].filter(Boolean).join(', '), via: 'open-meteo' };
}

async function geocodeNominatim(q) {
  const j = await getJson('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q), {
    headers: { 'user-agent': UA, 'accept-language': 'en' },
  });
  if (!j[0]) throw new Error('no match');
  return { lat: +j[0].lat, lon: +j[0].lon, label: j[0].display_name, via: 'nominatim' };
}

export async function geocode(q) {
  const m = q.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (m) return { lat: +m[1], lon: +m[2], label: q, via: 'coordinates' };
  const errs = [];
  for (const fn of [geocodeOpenMeteo, geocodeNominatim]) {
    try {
      return await fn(q);
    } catch (e) {
      errs.push(`${fn.name.replace('geocode', '')}: ${e.message}`);
    }
  }
  throw new Error(`Couldn't find "${q}" (${errs.join('; ')}). Try "City, State" like "Cedar Rapids, Iowa".`);
}

// Ask every mirror at once and take the first good answer. One slow or blocking server can no longer sink the search.
async function overpass(query) {
  const errs = [];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 22000);
  const one = async (url) => {
    const host = new URL(url).host;
    try {
      const r = await fetch(url, {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA, accept: 'application/json' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (/runtime error|timed out|out of memory/i.test(j.remark || '')) throw new Error('server overloaded');
      return { data: j, host };
    } catch (e) {
      errs.push(`${host}: ${e.name === 'AbortError' ? 'timeout' : e.message}`);
      throw e;
    }
  };
  try {
    return await Promise.any(ENDPOINTS.map(one));
  } catch {
    throw new Error('Overpass servers failed (' + errs.join('; ') + ')');
  } finally {
    clearTimeout(timer);
    ctl.abort();
  }
}

export function buildQuery(place, { category = 'all', mode = 'none', radiusKm = 15 }) {
  const keys = category === 'all' ? ALL : [category];
  const sels = keys.map((k) => CATS[k]).filter(Boolean);
  if (!sels.length) throw new Error('Unknown category');
  const r = Math.round(Math.min(Math.max(radiusKm, 1), 50) * 1000);
  const around = `(around:${r},${place.lat},${place.lon})`;
  const filter = mode === 'any' ? '' : mode === 'has_site' ? '["website"]' : '[!"website"][!"contact:website"][!"url"]';
  const body = sels.map((s) => `nwr${s}["name"]${filter}${around};`).join('');
  return `[out:json][timeout:20];(${body});out tags center 300;`;
}

export function parseElements(elements) {
  const items = [];
  let chains = 0;
  const seen = new Set();
  for (const el of elements || []) {
    const t = el.tags || {};
    if (!t.name) continue;
    if (t.brand || t['brand:wikidata']) {
      chains++;
      continue;
    }
    const id = (el.type || 'x')[0] + el.id;
    if (seen.has(id)) continue;
    seen.add(id);
    const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
    items.push({
      id,
      name: t.name,
      category: (t.shop || t.amenity || t.craft || t.leisure || t.office || '').replace(/_/g, ' '),
      address: [street, t['addr:city']].filter(Boolean).join(', '),
      phone: t.phone || t['contact:phone'] || '',
      email: (t.email || t['contact:email'] || '').toLowerCase(),
      website: t.website || t['contact:website'] || t.url || '',
      source: 'osm',
    });
  }
  return { items, chains };
}

// Backup source when every Overpass mirror is down: Nominatim place search inside a box around the city.
const TERMS = {
  restaurants: ['restaurant', 'cafe', 'pizza', 'bakery'],
  beauty: ['hair salon', 'barber', 'nail salon', 'beauty salon'],
  auto: ['car repair', 'auto body', 'car wash', 'tire shop'],
  fitness: ['gym', 'fitness center', 'yoga studio'],
  trades: ['plumber', 'electrician', 'contractor', 'landscaping'],
  health: ['dentist', 'chiropractor', 'veterinary', 'clinic'],
  retail: ['boutique', 'gift shop', 'florist'],
  offices: ['law office', 'accountant', 'insurance agency'],
};
async function nominatimFallback(place, { category, mode, radiusKm }) {
  const dLat = Math.min(Math.max(radiusKm, 1), 50) / 111;
  const dLon = dLat / Math.max(Math.cos((place.lat * Math.PI) / 180), 0.2);
  const box = [place.lon - dLon, place.lat + dLat, place.lon + dLon, place.lat - dLat].map((n) => n.toFixed(5)).join(',');
  const keys = category === 'all' ? ['restaurants', 'beauty', 'auto', 'trades', 'health'] : [category];
  const terms = keys.flatMap((k) => (TERMS[k] || []).slice(0, category === 'all' ? 2 : 4)).slice(0, 8);
  const out = [];
  const seen = new Set();
  for (const term of terms) {
    try {
      const j = await getJson(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=40&extratags=1&addressdetails=1&bounded=1&viewbox=${box}&q=${encodeURIComponent(term)}`,
        { headers: { 'user-agent': UA, 'accept-language': 'en' } },
        9000,
      );
      for (const r of j) {
        if (!r.name || seen.has(r.osm_id)) continue;
        seen.add(r.osm_id);
        const x = r.extratags || {};
        const site = x.website || x['contact:website'] || x.url || '';
        if (mode === 'none' ? !!site : mode === 'has_site' ? !site : false) continue;
        if (x.brand || x['brand:wikidata']) continue;
        const a = r.address || {};
        out.push({ type: (r.osm_type || 'node')[0] === 'w' ? 'way' : (r.osm_type || 'node')[0] === 'r' ? 'relation' : 'node', id: r.osm_id, tags: { name: r.name, [r.category === 'shop' ? 'shop' : r.category === 'craft' ? 'craft' : r.category === 'leisure' ? 'leisure' : 'amenity']: r.type, website: site || undefined, phone: x.phone || x['contact:phone'], email: x.email || x['contact:email'], 'addr:housenumber': a.house_number, 'addr:street': a.road, 'addr:city': a.city || a.town || a.village } });
      }
    } catch {
      /* keep going with the other terms */
    }
    await new Promise((r) => setTimeout(r, 1100)); // Nominatim asks for at most one request per second
  }
  return out;
}

const nk = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export async function findBusinesses({ city, category = 'all', mode = 'none', radiusKm = 15, limit = 20 }, env = {}) {
  const place = await geocode(city);
  const opts = { category, mode, radiusKm, limit };
  const osmTask = (async () => {
    try {
      const { data: { elements }, host } = await overpass(buildQuery(place, opts));
      return { elements, host };
    } catch (e) {
      const elements = await nominatimFallback(place, opts);
      if (!elements.length) throw new Error(`${e.message}. The backup search found nothing either.`);
      return { elements, host: 'nominatim (backup)', note: e.message };
    }
  })();
  const extra = [
    ['serper', env.SERPER_API_KEY, searchSerper],
    ['google', env.GOOGLE_PLACES_KEY, searchGoogle],
  ];
  const extraTasks = extra.map(([name, key, fn]) => (key ? fn(env, place, opts).catch((e) => ({ error: e.message })) : Promise.resolve(null)));
  const [osm, ...extras] = await Promise.all([osmTask.catch((e) => ({ error: e.message })), ...extraTasks]);
  const goodExtras = extras.filter((x) => x && !x.error);
  if (osm.error && !goodExtras.length) {
    const err = new Error([osm.error, ...extras.map((x) => x?.error)].filter(Boolean).join(' | '));
    err.code = 'NET';
    throw err;
  }
  let items = [];
  let chains = 0;
  if (!osm.error) ({ items, chains } = parseElements(osm.elements));
  // one business can be in several sources: keep one entry. Google-based sources are the most reliable about websites, so they win.
  const byKey = new Map(items.map((i) => [nk(i.name), i]));
  const added = {};
  extra.forEach(([name], idx) => {
    const r = extras[idx];
    if (!r || r.error) return;
    added[name] = 0;
    for (const g of r.items) {
      const hit = byKey.get(nk(g.name));
      if (hit) {
        hit.rating ||= g.rating;
        hit.reviews ||= g.reviews;
        hit.phone ||= g.phone;
        hit.address ||= g.address;
        continue;
      }
      items.push(g);
      byKey.set(nk(g.name), g);
      added[name]++;
    }
  });
  const stat = (name, key, r, off) => (!key ? off : !r ? off : r.error ? 'error: ' + r.error : `${r.raw} places, ${added[name]} extra`);
  return {
    items,
    debug: {
      place: place.label,
      geocoder: place.via,
      server: osm.error ? 'map data from ' + extra.filter((_, i) => extras[i] && !extras[i].error).map((x) => x[0]).join(' + ') : osm.host,
      raw: (osm.elements || []).length + goodExtras.reduce((n, x) => n + (x.raw || 0), 0),
      chains,
      google: stat('google', env.GOOGLE_PLACES_KEY, extras[1], 'off (no GOOGLE_PLACES_KEY)'),
      serper: stat('serper', env.SERPER_API_KEY, extras[0], 'off (add SERPER_API_KEY for Google Maps data)'),
      note: osm.error ? 'OpenStreetMap: ' + osm.error : osm.note || '',
    },
  };
}
