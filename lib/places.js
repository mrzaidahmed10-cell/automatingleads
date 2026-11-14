// Optional second source: Google Places (needs a GOOGLE_PLACES_KEY secret). Google knows far more small businesses than
// OpenStreetMap and tells us whether a website is listed, plus ratings and review counts.
const TERMS = {
  restaurants: ['restaurants', 'cafes', 'bakeries', 'pizza'],
  beauty: ['hair salons', 'barber shops', 'nail salons', 'beauty salons'],
  auto: ['auto repair', 'car wash', 'auto body shop', 'tire shop'],
  fitness: ['gyms', 'yoga studios', 'martial arts'],
  trades: ['plumbers', 'electricians', 'landscaping', 'contractors', 'roofing', 'HVAC'],
  health: ['dentists', 'chiropractors', 'veterinarians'],
  retail: ['boutiques', 'gift shops', 'florists'],
  offices: ['law offices', 'accountants', 'insurance agencies'],
};
import { serperPlaces } from './providers.js';
const MASK = 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.primaryTypeDisplayName,places.rating,places.userRatingCount,places.businessStatus,nextPageToken';

// Paid lookups scale with how many leads you asked for: a small request uses one or two searches, not eight.
const termBudget = (limit) => Math.max(1, Math.min(8, Math.ceil((limit || 20) / 10)));
export async function searchGoogle(env, place, { category = 'all', mode = 'none', radiusKm = 15, limit = 20 }) {
  const keys = category === 'all' ? ['restaurants', 'beauty', 'auto', 'trades', 'health', 'fitness'] : [category];
  const terms = keys.flatMap((k) => (TERMS[k] || []).slice(0, category === 'all' ? 2 : 4)).slice(0, termBudget(limit));
  const radius = Math.min(Math.max(radiusKm, 1), 50) * 1000;
  const items = [];
  const seen = new Set();
  let raw = 0;
  const errs = [];
  await Promise.all(
    terms.map(async (term) => {
      let token = '';
      for (let page = 0; page < (category === 'all' || limit <= 20 ? 1 : 3); page++) {
        const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GOOGLE_PLACES_KEY, 'x-goog-fieldmask': MASK },
          body: JSON.stringify({
            textQuery: term + ' in ' + place.label,
            pageSize: 20,
            ...(token ? { pageToken: token } : {}),
            locationBias: { circle: { center: { latitude: place.lat, longitude: place.lon }, radius: Math.min(radius, 50000) } },
          }),
        });
        if (!r.ok) {
          const t = await r.text().catch(() => '');
          errs.push(`HTTP ${r.status} ${t.replace(/\s+/g, ' ').slice(0, 140)}`);
          break;
        }
        const j = await r.json();
        for (const p of j.places || []) {
          raw++;
          if (seen.has(p.id) || p.businessStatus === 'CLOSED_PERMANENTLY') continue;
          seen.add(p.id);
          const site = p.websiteUri || '';
          if (mode === 'none' && site) continue;
          if (mode === 'has_site' && !site) continue;
          items.push({
            id: 'g' + p.id.replace(/[^a-z0-9]/gi, '').slice(0, 30),
            name: p.displayName?.text || '',
            category: (p.primaryTypeDisplayName?.text || term).toLowerCase(),
            address: (p.formattedAddress || '').replace(/, USA$/, ''),
            phone: p.nationalPhoneNumber || '',
            email: '',
            website: site,
            rating: p.rating || 0,
            reviews: p.userRatingCount || 0,
            source: 'google',
          });
        }
        token = j.nextPageToken || '';
        if (!token) break;
      }
    }),
  );
  if (!raw && errs.length) throw new Error('Google Places: ' + errs[0]);
  return { items: items.filter((i) => i.name), raw, errs };
}

// Google Maps data through Serper (SERPER_API_KEY): the same facts as Google Places, with a free starter quota and no card.
export async function searchSerper(env, place, { category = 'all', mode = 'none', limit = 20 }) {
  const keys = category === 'all' ? ['restaurants', 'beauty', 'auto', 'trades', 'health', 'fitness'] : [category];
  const terms = keys.flatMap((k) => (TERMS[k] || []).slice(0, category === 'all' ? 2 : 4)).slice(0, termBudget(limit));
  const items = [];
  const seen = new Set();
  let raw = 0;
  const errs = [];
  await Promise.all(
    terms.map(async (term) => {
      for (let page = 1; page <= (category === 'all' || limit <= 20 ? 1 : 2); page++) {
        let list;
        try {
          list = await serperPlaces(env, `${term} in ${place.label}`, page);
        } catch (e) {
          errs.push(e.message);
          break;
        }
        for (const p of list) {
          raw++;
          const name = String(p.title || p.name || '').trim();
          const key = String(p.cid || p.placeId || name + '|' + (p.address || ''));
          if (!name || seen.has(key)) continue;
          seen.add(key);
          const site = String(p.website || p.websiteUri || '').trim();
          if (mode === 'none' && site) continue;
          if (mode === 'has_site' && !site) continue;
          items.push({
            id: 's' + key.replace(/[^a-z0-9]/gi, '').slice(0, 30),
            name,
            category: String(p.category || p.type || term).toLowerCase(),
            address: String(p.address || '').replace(/, USA$/, ''),
            phone: String(p.phoneNumber || p.phone || ''),
            email: '',
            website: site,
            rating: Number(p.rating) || 0,
            reviews: Number(p.ratingCount || p.reviews || 0) || 0,
            source: 'serper',
          });
        }
        if (list.length < 15) break;
      }
    }),
  );
  if (!raw && errs.length) throw new Error('Serper: ' + errs[0]);
  return { items, raw, errs };
}
