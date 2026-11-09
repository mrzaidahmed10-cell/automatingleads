'use strict';
/* Browser-side lead search. Used when the server cannot reach the map servers (it only ever runs from your own signed-in page). */
const FINDER = (() => {
  const CATS = {
    restaurants: '["amenity"~"^(restaurant|cafe|fast_food|bar|pub|bakery|ice_cream)$"]',
    beauty: '["shop"~"^(hairdresser|beauty|barber|nails|massage|tattoo)$"]',
    auto: '["shop"~"^(car_repair|car|car_parts|tyres|car_wash)$"]',
    fitness: '["leisure"~"^(fitness_centre|sports_centre|dance)$"]',
    trades: '["craft"]', health: '["amenity"~"^(dentist|clinic|doctors|veterinary|chiropractor)$"]',
    retail: '["shop"]', offices: '["office"]',
  };
  const ALL = ['restaurants', 'beauty', 'auto', 'fitness', 'trades', 'health'];
  const EP = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.openstreetmap.fr/api/interpreter'];
  const US = { IA: 'Iowa', IL: 'Illinois', MN: 'Minnesota', MO: 'Missouri', WI: 'Wisconsin', NE: 'Nebraska', TX: 'Texas', CA: 'California', NY: 'New York', FL: 'Florida' };

  const tj = async (url, opt = {}, ms = 14000) => {
    const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
    try { const r = await fetch(url, { ...opt, signal: c.signal, credentials: 'omit', referrerPolicy: 'no-referrer' }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
    finally { clearTimeout(t); }
  };
  async function geocode(q) {
    const m = q.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (m) return { lat: +m[1], lon: +m[2], label: q };
    const parts = q.split(',').map((x) => x.trim()).filter(Boolean), hint = (parts.slice(1).join(' ') || '').toLowerCase();
    const full = (US[hint.toUpperCase()] || hint).toLowerCase();
    try {
      const j = await tj('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(parts[0]) + '&count=10&language=en&format=json');
      const rs = j.results || [];
      const pick = (full && rs.find((r) => [r.admin1, r.admin2, r.country, r.country_code].some((v) => v && (String(v).toLowerCase().includes(full) || full.includes(String(v).toLowerCase()))))) || rs[0];
      if (pick) return { lat: pick.latitude, lon: pick.longitude, label: [pick.name, pick.admin1, pick.country_code].filter(Boolean).join(', ') };
    } catch {}
    const j = await tj('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q));
    if (!j[0]) throw new Error('Could not find "' + q + '". Try "City, State".');
    return { lat: +j[0].lat, lon: +j[0].lon, label: j[0].display_name };
  }
  function query(pl, { category, mode, radius }) {
    const sels = (category === 'all' ? ALL : [category]).map((k) => CATS[k]).filter(Boolean);
    const r = Math.round(Math.min(Math.max(+radius || 15, 1), 50) * 1000), around = `(around:${r},${pl.lat},${pl.lon})`;
    const f = mode === 'has_site' ? '["website"]' : '[!"website"][!"contact:website"][!"url"]';
    return `[out:json][timeout:20];(${sels.map((s) => `nwr${s}["name"]${f}${around};`).join('')});out tags center 300;`;
  }
  async function overpass(q) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), 24000), errs = [];
    try {
      return await Promise.any(EP.map(async (u) => {
        try {
          const r = await fetch(u, { method: 'POST', signal: c.signal, credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const j = await r.json(); if (/runtime error|timed out|out of memory/i.test(j.remark || '')) throw new Error('overloaded');
          return j.elements || [];
        } catch (e) { errs.push(new URL(u).host + ': ' + (e.name === 'AbortError' ? 'timeout' : e.message)); throw e; }
      }));
    } catch { throw new Error('Map servers did not answer (' + errs.join('; ') + ')'); }
    finally { clearTimeout(t); c.abort(); }
  }
  function parse(els) {
    const items = [], seen = new Set(); let chains = 0;
    for (const el of els) {
      const t = el.tags || {}; if (!t.name) continue;
      if (t.brand || t['brand:wikidata']) { chains++; continue; }
      const id = (el.type || 'x')[0] + el.id; if (seen.has(id)) continue; seen.add(id);
      items.push({ id, name: t.name, category: (t.shop || t.amenity || t.craft || t.leisure || t.office || '').replace(/_/g, ' '), address: [[t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '), t['addr:city']].filter(Boolean).join(', '), phone: t.phone || t['contact:phone'] || '', email: (t.email || t['contact:email'] || '').toLowerCase(), website: t.website || t['contact:website'] || t.url || '' });
    }
    return { items, chains };
  }
  return { async run(opt) { const pl = await geocode(opt.city); const els = await overpass(query(pl, opt)); const { items, chains } = parse(els); return { items, chains, place: pl.label, raw: els.length }; } };
})();
