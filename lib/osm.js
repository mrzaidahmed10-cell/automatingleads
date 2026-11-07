// Lead discovery via OpenStreetMap (free, no API key).
const UA = 'automatingleads/1.0 (personal lead research tool)';

const CATS = {
  restaurants: '["amenity"~"^(restaurant|cafe|fast_food|bar|pub|bakery)$"]',
  beauty: '["shop"~"^(hairdresser|beauty|barber|nails|massage|tattoo)$"]',
  auto: '["shop"~"^(car_repair|car|car_parts|tyres|car_wash)$"]',
  fitness: '["leisure"~"^(fitness_centre|sports_centre|dance)$"]',
  trades: '["craft"]',
  health: '["amenity"~"^(dentist|clinic|doctors|veterinary)$"]',
  retail: '["shop"]',
  offices: '["office"]',
};

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

async function geocode(q) {
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q), {
    headers: { 'user-agent': UA, 'accept-language': 'en' },
  });
  if (!r.ok) throw new Error('Geocoding failed (' + r.status + ')');
  const j = await r.json();
  if (!j[0]) throw new Error('Could not find that place. Try "City, State".');
  return { lat: +j[0].lat, lon: +j[0].lon };
}

async function overpass(query) {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!r.ok) throw new Error('Overpass ' + r.status);
      return await r.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error('Map data service is busy, try again in a minute (' + (lastErr?.message || 'error') + ')');
}

export async function findBusinesses({ city, category = 'all', mode = 'none', radiusKm = 15 }) {
  const { lat, lon } = await geocode(city);
  const keys = category === 'all' ? Object.keys(CATS) : [category];
  const sels = keys.map((k) => CATS[k]).filter(Boolean);
  if (!sels.length) throw new Error('Unknown category');
  const around = `(around:${Math.round(Math.min(Math.max(radiusKm, 1), 50) * 1000)},${lat},${lon})`;
  const filter = mode === 'has_site' ? '["website"]' : '[!"website"][!"contact:website"][!"url"]';
  const body = sels.map((s) => `nwr${s}["name"]${filter}${around};`).join('');
  const data = await overpass(`[out:json][timeout:25];(${body});out tags center 250;`);

  const out = [];
  for (const el of data.elements || []) {
    const t = el.tags || {};
    if (!t.name) continue;
    if (t.brand || t['brand:wikidata']) continue; // skip chains
    const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
    const address = [street, t['addr:city']].filter(Boolean).join(', ');
    const cat = (t.shop || t.amenity || t.craft || t.leisure || t.office || '').replace(/_/g, ' ');
    out.push({
      id: (el.type || 'x')[0] + el.id,
      name: t.name,
      category: cat,
      address,
      phone: t.phone || t['contact:phone'] || '',
      email: (t.email || t['contact:email'] || '').toLowerCase(),
      website: t.website || t['contact:website'] || t.url || '',
      source: 'osm',
    });
  }
  return out;
}
