// Spotting businesses that have shut down, from listing fields and from the words search results and sites use.
const WEEKDAY = /(sun|mon|tues?|wed(nes)?|thu(rs)?|fri|sat(ur)?)day|weekends?|holidays?/i;
const CLOSED = /permanently\s+closed|closed\s+permanently|permanent(ly)?\s+closure|closed\s+for\s+good|closing\s+for\s+good|out\s+of\s+business|no\s+longer\s+(in\s+business|operating|open)|(has|have)\s+(now\s+)?(closed|shut)\s+down|(has|have)\s+closed\s+(its|their)\s+doors|ceased\s+operations?|went\s+out\s+of\s+business|business\s+is\s+closed|(we|store|shop|location|restaurant)\s+(is|are|has)\s+(now\s+)?closed\s+(permanently|for\s+good)|\bCLOSED\b\s*\((permanent|for good)/i;

export function looksClosed(text) {
  const s = String(text || '');
  const m = CLOSED.exec(s);
  if (!m) return false;
  // "permanently closed on Sundays" is opening hours, not a closure
  const around = s.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30);
  return !WEEKDAY.test(around);
}

// A map listing: any status field or label that says closed (temporary closures are skipped too, since a lead that is not open is not worth a call)
export function closedListing(p) {
  const status = String(p.businessStatus || p.business_status || p.status || '').toUpperCase();
  if (status.startsWith('CLOSED') || status === 'PERMANENTLY_CLOSED') return true;
  if (p.permanentlyClosed || p.permanently_closed || p.isPermanentlyClosed || p.closed === true) return true;
  if (p.temporarilyClosed || p.temporarily_closed) return true;
  return looksClosed([p.title, p.name, p.type, p.category, p.hours, p.openingHours, p.state, p.description].filter((x) => typeof x === 'string').join(' | '));
}

// OpenStreetMap: lifecycle tags that mean it is gone
export function closedOsm(t) {
  if (!t) return false;
  const keys = Object.keys(t);
  if (keys.some((k) => /^(disused|abandoned|razed|demolished|was|former|closed|removed):/i.test(k))) return true;
  if (/^(closed|no)$/i.test(t.opening_hours || '') && /^off$/i.test(t.opening_hours || '')) return true;
  if (/^(closed|permanently_closed)$/i.test(t.status || t['operational_status'] || '')) return true;
  return /\b(closed|permanently closed|former)\b/i.test(t.name || '') && /\(?(permanently\s+)?closed\)?/i.test(t.name || '');
}
