// Lead discovery via OpenStreetMap (free, no API key), with fallbacks so one blocked server doesn't break it.
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

async function overpass(query) {
  const errs = [];
  for (const url of ENDPOINTS) {
    const host = new URL(url).host;
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 28000);
      const r = await fetch(url, {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA, accept: 'application/json' },
        body: 'data=' + encodeURIComponent(query),
      }).finally(() => clearTimeout(to));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (/runtime error|timed out|out of memory/i.test(j.remark || '')) throw new Error('server overloaded');
      return { data: j, host };
    } catch (e) {
      errs.push(`${host}: ${e.name === 'AbortError' ? 'timeout' : e.message}`);
    }
  }
  throw new Error('All map data servers failed (' + errs.join('; ') + '). Wait a minute and retry, or try a smaller radius or a single category.');
}

export async function findBusinesses({ city, category = 'all', mode = 'none', radiusKm = 15 }) {
  const place = await geocode(city);
  const keys = category === 'all' ? ALL : [category];
  const sels = keys.map((k) => CATS[k]).filter(Boolean);
  if (!sels.length) throw new Error('Unknown category');
  const r = Math.round(Math.min(Math.max(radiusKm, 1), 50) * 1000);
  const around = `(around:${r},${place.lat},${place.lon})`;
  const filter = mode === 'has_site' ? '["website"]' : '[!"website"][!"contact:website"][!"url"]';
  const body = sels.map((s) => `nwr${s}["name"]${filter}${around};`).join('');
  const { data, host } = await overpass(`[out:json][timeout:25];(${body});out tags center 300;`);

  const items = [];
  let chains = 0;
  const seen = new Set();
  for (const el of data.elements || []) {
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
  return {
    items,
    debug: { place: place.label, geocoder: place.via, server: host, raw: (data.elements || []).length, chains },
  };
}
