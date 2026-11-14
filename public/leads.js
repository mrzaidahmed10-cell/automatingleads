'use strict';
/* ---------- leads page ---------- */
const FILTERS = [['all', 'All'], ['hot', 'Hot'], ['unver', 'Unchecked'], ['email', 'Has email'], ['noemail', 'Needs email'], ['nosite', 'No website'], ['poor', 'Poor site'], ['drafted', 'Drafted'], ['sent', 'Sent'], ['replied', 'Replied']];
// Worth pitching: not contacted yet, and either confirmed to have no real website or a poor one
const isHot = (l) => ['new', 'drafted'].includes(l.status) && ((!l.website && !!l.web && ['none', 'social'].includes(l.web.status)) || (!!l.website && !!l.audit && !l.audit.unverified && l.audit.score >= 40));
let busyBulk = false;
const SORTS = {
  smart: (a, b) => (isHot(b) ? 1 : 0) - (isHot(a) ? 1 : 0) || (validEmail(b.email) ? 1 : 0) - (validEmail(a.email) ? 1 : 0),
  new: (a, b) => b.createdAt - a.createdAt,
  name: (a, b) => a.name.localeCompare(b.name),
  poor: (a, b) => (b.audit ? b.audit.score : -1) - (a.audit ? a.audit.score : -1),
  rating: (a, b) => (b.reviews || 0) - (a.reviews || 0),
};

function leadMatches(l, f) {
  switch (f) {
    case 'email': return validEmail(l.email);
    case 'noemail': return !validEmail(l.email) && !['unsub', 'skip'].includes(l.status);
    case 'hot': return isHot(l);
    case 'unver': return !l.website && !l.web;
    case 'nosite': return !l.website;
    case 'poor': return !!(l.audit && l.audit.score >= 40);
    case 'drafted': return l.status === 'drafted';
    case 'sent': return l.status === 'sent';
    case 'replied': return l.status === 'replied';
    default: return true;
  }
}
const siteCell = (l) => {
  if (!l.website) {
    const w = l.web;
    if (!w) return '<span class="pill warn">Not checked</span><br><span class="sub">none listed on the map</span>';
    if (w.status === 'social') return `<span class="pill acc">Social page only</span>${w.social ? `<br><a href="${esc(href(w.social))}" target="_blank" rel="noopener noreferrer" class="sub">${esc(host(w.social))}</a>` : ''}`;
    if (w.status === 'none') return `<span class="pill ok">No website ✓</span><br><span class="sub">${w.confidence === 'medium' ? 'likely, search was unavailable' : 'verified'}</span>`;
    return '<span class="pill">Could not check</span>';
  }
  const found = l.web && l.web.status === 'site' && l.web.source && l.web.source !== 'listed' ? '<span class="sub"> · found online</span>' : '';
  const a = `<a href="${esc(href(l.website))}" target="_blank" rel="noopener noreferrer">${esc(host(l.website))}</a>${found}`;
  if (!l.audit) return a + '<br><span class="pill">Not audited</span>';
  if (l.audit.unverified) return a + '<br><span class="pill">Blocked · check by hand</span>';
  const sc = l.audit.score, c = sc >= 50 ? 'bad' : sc >= 25 ? 'warn' : 'ok';
  return a + `<br><span class="pill ${c}">${sc >= 50 ? 'Poor' : sc >= 25 ? 'Dated' : 'Decent'} · ${sc}</span>`;
};

const SOC = { facebook: 'Facebook', instagram: 'Instagram', yelp: 'Yelp', linkedin: 'LinkedIn', tiktok: 'TikTok' };
const socialLinks = (l) => { const e = Object.entries(l.social || {}).filter(([k, v]) => SOC[k] && v); return e.length ? `<div class="soc">${e.map(([k, v]) => `<a href="${esc(href(v))}" target="_blank" rel="noopener noreferrer" aria-label="${esc(l.name)} on ${SOC[k]}">${SOC[k]}</a>`).join('')}</div>` : ''; };
const SRC = { website: 'their site', search: 'web search', facebook: 'Facebook', yelp: 'Yelp' };
function emailAlts(l) {
  const c = l.contacts;
  if (!c) return validEmail(l.email) ? '' : `<button class="mini" data-act="findOne" data-id="${esc(l.id)}">Find contact info</button>`;
  const alts = (c.emails || []).filter((e) => e.email !== l.email).slice(0, 2);
  if (alts.length) return `<div class="alts">${alts.map((e) => `<button class="chip" data-act="rowUse" data-id="${esc(l.id)}" data-v="${esc(e.email)}" title="From ${esc(SRC[e.source] || e.source)}. Click to use this one">${esc(e.email)}</button>`).join('')}</div>`;
  if (!validEmail(l.email)) return `<div class="sub nof" title="${esc((c.notes || []).join('. '))}">No email found${c.reached?.length ? ' (looked at ' + c.reached.join(', ') + ')' : ''}</div>`;
  return '';
}
const statusPill = (l) => {
  const m = { new: ['New', ''], drafted: ['Drafted', 'acc'], sent: ['Sent', 'ok'], replied: ['Replied', 'ok'], unsub: ['Do not contact', 'bad'], skip: ['Skipped', ''] }[l.status] || ['New', ''];
  return `<span class="pill ${m[1]}">${m[0]}</span>`;
};

// number box with - / + buttons that move in steps of 5, plus typing any number you like
const stepper = (id, val, min, max, unit) => `<div class="step"><button type="button" class="btn s g" data-act="stepDn" data-t="${id}" aria-label="Fewer ${unit}">−</button><input id="${id}" type="number" inputmode="numeric" min="${min}" max="${max}" step="1" value="${esc(val)}" data-min="${min}" data-max="${max}" aria-label="${unit}"><button type="button" class="btn s g" data-act="stepUp" data-t="${id}" aria-label="More ${unit}">+</button></div>`;
const numVal = (id, def, min, max) => { const e = document.getElementById(id); const v = Math.round(Number(e && e.value)); return Math.min(Math.max(Number.isFinite(v) && v > 0 ? v : def, min), max); };
const stepBy = (id, dir) => { const e = document.getElementById(id); if (!e) return; const min = +e.dataset.min, max = +e.dataset.max; const v = numVal(id, min, min, max); e.value = Math.min(max, Math.max(min, dir > 0 ? Math.floor(v / 5) * 5 + 5 : Math.ceil(v / 5) * 5 - 5)); };
A.stepUp = (t) => stepBy(t.dataset.t, 1);
A.stepDn = (t) => stepBy(t.dataset.t, -1);
function vLeads() {
  const open = ui.finderOpen ?? S.leads.length === 0;
  const opt = (v, t, sel) => `<option value="${v}" ${sel ? 'selected' : ''}>${t}</option>`;
  $('#view').innerHTML = `
    <div class="card pad" id="finder">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div><h3>Find leads</h3><div class="hint">Local businesses near a city. The best leads have no website or an outdated one.</div></div>
        <div class="sp"></div>
        <button class="btn s" data-act="toggleFinder">${open ? 'Hide' : 'Show finder'}</button>
        <button class="btn s" data-act="addLeadModal">+ Add lead</button>
      </div>
      <div id="finderBody" class="${open ? '' : 'hide'}" style="margin-top:14px">
        <div class="row">
          <div style="flex:2"><label>City</label><input id="fCity" value="${esc(store.get('city', 'Iowa City, Iowa'))}" placeholder="City, State"></div>
          <div><label>Category</label><select id="fCat">${[['all', 'Everything'], ['restaurants', 'Food & drink'], ['beauty', 'Salons & beauty'], ['auto', 'Auto'], ['fitness', 'Fitness'], ['trades', 'Trades & crafts'], ['health', 'Health & vet'], ['retail', 'Retail'], ['offices', 'Offices']].map(([v, t]) => opt(v, t, store.get('cat', 'all') === v)).join('')}</select></div>
          <div class="fmode"><label id="fModeL">Looking for</label><div id="fModeMount" class="seg"></div></div>
          <div class="stp"><label for="fLim">How many leads</label>${stepper('fLim', store.get('lim', '20'), 1, 100, 'leads')}</div>
          <div class="stp"><label for="fRad">Distance (miles)</label>${stepper('fRad', store.get('radmi', '10'), 1, 30, 'miles')}</div>
          <div style="flex:0 0 auto;min-width:0"><button class="btn p" data-act="find">${ico('mapPin')} Find leads</button></div>
        </div>
        <label class="chk" style="margin-top:10px"><input type="checkbox" id="fAuto" ${store.get('auto', '1') === '1' ? 'checked' : ''}> Check every result for a real website, then audit the ones that have one <span class="hint">(OpenStreetMap often misses websites, so this is what separates real leads from false ones)</span></label>
        <label class="chk" style="margin-top:6px"><input type="checkbox" id="fCon" ${store.get('con', '1') === '1' ? 'checked' : ''}> Also look up email, phone and social pages <span class="hint">(their site, web search, Facebook, Yelp)</span></label>
      </div>
      <div id="findres"></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="tools"><div class="chips" id="chips"></div><div class="sp"></div><div id="qMount" class="qm"></div></div>
      <div class="tools">
        <select id="qsel" class="qsel" data-change="quickSel" aria-label="Quick select"></select>
        <select id="sortSel" class="qsel" data-change="sortBy" aria-label="Sort leads">${[['smart', 'Best leads first'], ['new', 'Newest'], ['name', 'Name A–Z'], ['poor', 'Weakest site first'], ['rating', 'Most reviews']].map(([v, t]) => `<option value="${v}" ${(ui.sort || 'smart') === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <span id="selbar" class="selbar hide" role="group" aria-label="Selection"></span>
        <div class="sp"></div>
        <button class="btn s g" data-act="exportCsv" title="Download your selection (or the current filter) as a spreadsheet">Export CSV</button>
        <button class="btn s" data-act="bulkVerify" title="Look for a website for every lead that has none listed">${ico('shield')} Verify websites</button>
        <button class="btn s" data-act="bulkContacts" title="Look up email, phone and social pages for leads that still need them (uses your selection if you picked some)">${ico('mail')} Find contacts</button>
        <button class="btn s" data-act="bulkAudit">Audit sites</button>
        <button class="btn s" data-act="bulkDraft" title="Write a draft for every new lead that has an email">Draft all</button>
        <button class="btn s p" data-act="bulkSend">${ico('send')} Send drafted</button>
        <span class="hint" id="prog"></span>
      </div>
      <div class="tw"><table class="rt"><thead><tr><th class="ck"><input type="checkbox" id="selAll" data-act="selAll" aria-label="Select all shown"></th><th>Business</th><th>Website</th><th>Email</th><th>Status</th><th class="dl"></th></tr></thead><tbody id="tb"></tbody></table></div>
      <div class="empty hide" id="empty"></div>
    </div>`;
  mountSearch(); mountMode();
  renderFindRes(); renderLeadsTable();
}

// Glisse controls when available, plain inputs if the glass bundle did not load
function mountSearch() {
  const m = $('#qMount'); if (!m) return;
  const on = (v) => { ui.query = v; renderLeadsTable(); };
  if (G()) return G().mount(m, 'Search', { label: 'Search leads', placeholder: 'Search leads', value: ui.query, onValueChange: on });
  m.innerHTML = `<input id="q" aria-label="Search leads" placeholder="Search leads…" value="${esc(ui.query)}">`;
  $('#q').oninput = (e) => on(e.target.value);
}
function mountMode() {
  const m = $('#fModeMount'); if (!m) return;
  const cur = ['has_site', 'any'].includes(store.get('mode', 'none')) ? store.get('mode') : 'none';
  const set = (v) => { store.set('mode', v); mountMode(); };
  if (G()) return G().mount(m, 'Seg', { label: 'Looking for', value: cur, onValueChange: set, items: [{ value: 'none', label: 'No site' }, { value: 'has_site', label: 'Has site' }, { value: 'any', label: 'Both' }] });
  m.innerHTML = `<select id="fModeSel" aria-labelledby="fModeL"><option value="none" ${cur === 'none' ? 'selected' : ''}>No website</option><option value="has_site" ${cur === 'has_site' ? 'selected' : ''}>Has a website (audit it)</option><option value="any" ${cur === 'any' ? 'selected' : ''}>Both</option></select>`;
  $('#fModeSel').onchange = (e) => set(e.target.value);
}
function renderFindRes() {
  const el = $('#findres'); if (!el) return;
  const r = ui.lastFind;
  if (!r) { el.innerHTML = ''; return; }
  if (r.error) { el.innerHTML = `<div class="banner" style="margin:14px 0 0">${esc(r.error)}</div>`; return; }
  const d = r.debug || {};
  const c = r.check;
  el.innerHTML = `<div class="hint" style="margin-top:14px">Searched <b>${esc(d.place || '')}</b> · ${d.raw ?? r.found} places found · <b style="color:var(--ok)">${r.added} new</b> · ${r.dupes} already in your list${r.hidden ? ' · ' + r.hidden + ' you deleted earlier' : ''}${d.chains ? ' · ' + d.chains + ' chains skipped' : ''}${d.serper && !/^off/.test(d.serper) ? ' · Google Maps (Serper): ' + esc(d.serper) : ''}${d.google && !/^off/.test(d.google) ? ' · Google Places: ' + esc(d.google) : ''}</div>${(!d.serper || /^off/.test(d.serper)) && (!d.google || /^off/.test(d.google)) ? '<div class="hint">Tip: add a free <b>SERPER_API_KEY</b> (Settings, Data sources) to search Google Maps data. It lists phone numbers and whether a business really has a website.</div>' : ''}` +
    (c ? `<div class="hint" style="margin-top:4px">Website check: <b style="color:var(--ok)">${c.none + c.social} have no real site</b> (${c.none} none, ${c.social} social page only) · ${c.site} already had a site${c.audited ? ` (${c.poor} poor)` : ''}${c.unsure ? ` · ${c.unsure} could not be checked` : ''}</div>` : '') +
    (c && c.contacts != null ? `<div class="hint" style="margin-top:4px">Contact info: <b style="color:var(--ok)">${c.emails} email${c.emails === 1 ? '' : 's'}</b> and ${c.phones} new phone number${c.phones === 1 ? '' : 's'} found across ${c.contacts} leads</div>` : '') +
    '<div id="findprog" class="hint" style="margin-top:6px"></div>' +
    (r.asked && r.found > 0 && r.added < r.asked ? `<div class="hint" style="margin-top:4px">You asked for ${r.asked}; ${r.added} new ${r.added === 1 ? 'lead was' : 'leads were'} available here. Try a larger distance or another category for more.</div>` : '') +
    (r.found === 0 ? `<div class="banner" style="margin:10px 0 0">Nothing matched. Try a bigger radius, the "Everything" category, or switch to "Has a website" to find outdated sites. Map coverage varies by town.</div>` : '');
}

function renderLeadsTable() {
  const tb = $('#tb'); if (!tb) return;
  const q = ui.query.toLowerCase();
  const base = S.leads.filter((l) => !q || `${l.name} ${l.category} ${l.address} ${l.email} ${l.website}`.toLowerCase().includes(q));
  $('#chips').innerHTML = FILTERS.map(([k, t]) => `<button class="chip ${ui.filter === k ? 'on' : ''}" data-act="setFilter" data-f="${k}">${t}<small>${base.filter((l) => leadMatches(l, k)).length}</small></button>`).join('');
  const rows = base.filter((l) => leadMatches(l, ui.filter)).sort(SORTS[ui.sort || 'smart']);
  const empty = $('#empty');
  if (!rows.length) {
    empty.classList.remove('hide');
    empty.innerHTML = S.leads.length ? '<b>No leads match</b>Try a different filter or search.' : '<b>No leads yet</b>Use the finder above to search a city, or add a lead by hand.';
  } else empty.classList.add('hide');
  tb.innerHTML = rows.map(rowHtml).join('');
  renderSel();
}
const rowHtml = (l) => `<tr class="lead ${sel().has(l.id) ? 'picked' : ''}" tabindex="0" aria-label="Open ${esc(l.name)}" data-act="openLead" data-id="${esc(l.id)}">
    <td class="ck"><input type="checkbox" class="sel" data-act="selRow" data-id="${esc(l.id)}" aria-label="Select ${esc(l.name)}" ${sel().has(l.id) ? 'checked' : ''}></td>
    <td><div class="nm">${esc(l.name)}${isHot(l) ? ' <span class="pill acc">Hot</span>' : ''}</div><div class="sub">${esc([l.category, l.rating ? `${l.rating}★${l.reviews ? ' (' + l.reviews + ')' : ''}` : '', l.address, l.phone].filter(Boolean).join(' · '))}</div>${socialLinks(l)}</td>
    <td>${siteCell(l)}</td>
    <td><input class="em" type="email" inputmode="email" autocapitalize="off" spellcheck="false" data-change="rowEmail" aria-label="Email for ${esc(l.name)}" data-id="${esc(l.id)}" placeholder="add email" value="${esc(l.email)}">${emailAlts(l)}</td>
    <td>${statusPill(l)}</td>
    <td class="dl"><button class="btn s g rowdel" data-act="rowDel" data-id="${esc(l.id)}" aria-label="Delete ${esc(l.name)}" title="Delete">${ico('trash')}</button></td></tr>`;
// Update one row in place so a save never wipes what you are typing in the next row
function patchRow(l) {
  const tr = $(`#tb tr[data-id="${CSS.escape(l.id)}"]`);
  if (!tr) return;
  const t = document.createElement('tbody'); t.innerHTML = rowHtml(l);
  const nt = t.firstElementChild, inp = tr.querySelector('input.em');
  if (inp && inp === document.activeElement) { [1, 2, 4].forEach((i) => (tr.children[i].innerHTML = nt.children[i].innerHTML)); }
  else tr.replaceWith(nt);
}
function chipsOnly() {
  const q = ui.query.toLowerCase(), c = $('#chips'); if (!c) return;
  const base = S.leads.filter((l) => !q || `${l.name} ${l.category} ${l.address} ${l.email} ${l.website}`.toLowerCase().includes(q));
  c.innerHTML = FILTERS.map(([k, t]) => `<button class="chip ${ui.filter === k ? 'on' : ''}" data-act="setFilter" data-f="${k}">${t}<small>${base.filter((l) => leadMatches(l, k)).length}</small></button>`).join('');
}
A.rowUse = async (t) => { try { const r = await api('leads/' + t.dataset.id, { method: 'PATCH', body: { email: t.dataset.v } }); upd(r.lead, true); toast('Email switched', 1800); } catch (e) { toast(e.message, 4500); } };
A.findOne = (t) => act(t, async () => {
  const r = await api('enrich', { method: 'POST', body: { ids: [t.dataset.id], city: store.get('city', '') } });
  r.leads.forEach((l) => upd(l, true));
  const g = Object.values(r.got || {})[0] || {};
  toast(g.email ? `Found ${g.email}` : g.phone ? `No email, but found ${g.phone}` : 'Nothing public found for this one', 3500);
});
C.sortBy = (i) => { ui.sort = i.value; renderLeadsTable(); };
A.exportCsv = () => {
  const ls = sel().size ? S.leads.filter((l) => sel().has(l.id)) : S.leads.filter((l) => leadMatches(l, ui.filter));
  if (!ls.length) return toast('Nothing to export');
  const q = (v) => { v = String(v ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; }; // quoted, and defused for spreadsheet formulas
  const cols = [['Name', (l) => l.name], ['Category', (l) => l.category], ['Email', (l) => l.email], ['Phone', (l) => l.phone], ['Website', (l) => l.website], ['Website status', (l) => (l.website ? 'has site' : l.web ? l.web.status : 'unchecked')], ['Audit score', (l) => (l.audit ? l.audit.score : '')], ['Address', (l) => l.address], ['Facebook', (l) => (l.social || {}).facebook], ['Instagram', (l) => (l.social || {}).instagram], ['Yelp', (l) => (l.social || {}).yelp], ['Status', (l) => l.status], ['Notes', (l) => l.notes]];
  const csv = [cols.map((c) => q(c[0])).join(','), ...ls.map((l) => cols.map((c) => q(c[1](l))).join(','))].join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' })); a.download = 'flightline-leads.csv'; document.body.appendChild(a); a.click(); a.remove();
  toast(`Exported ${ls.length} lead${ls.length === 1 ? '' : 's'}`, 2500);
};
A.setFilter = (t) => { ui.filter = t.dataset.f; renderLeadsTable(); };
A.toggleFinder = (t) => { const b = $('#finderBody'); b.classList.toggle('hide'); ui.finderOpen = !b.classList.contains('hide'); t.textContent = ui.finderOpen ? 'Hide' : 'Show finder'; };
C.rowEmail = async (i) => {
  const id = i.dataset.id, before = (S.leads.find((x) => x.id === id) || {}).email || '', v = cleanEmail(i.value);
  if (v === before) { i.value = before; return; }
  if (v && !validEmail(v)) { i.setAttribute('aria-invalid', 'true'); toast(`"${i.value.slice(0, 50)}" doesn't look like an email.`, 4500); return; }
  i.removeAttribute('aria-invalid'); i.value = v;
  try {
    const r = await api('leads/' + id, { method: 'PATCH', body: { email: v } });
    upd(r.lead, true); toast(r.lead.status === 'drafted' && before ? 'Saved. Moved back to Drafted so you can email the new address.' : 'Email saved', 2200);
  } catch (e) { toast(e.message, 4500); i.value = before; }
};
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches && e.target.matches('input.em')) e.target.blur(); });
function upd(l, rowOnly) { setLead(l); chrome(); if (rowOnly) { patchRow(l); chipsOnly(); } else renderLeadsTable(); if (ui.cur === l.id) drawer(); }

A.find = (btn) => act(btn, async () => {
  const body = { city: $('#fCity').value, category: $('#fCat').value, mode: ['has_site', 'any'].includes(store.get('mode', 'none')) ? store.get('mode') : 'none', radius: Math.round(numVal('fRad', 10, 1, 30) * 1.609344 * 10) / 10, limit: numVal('fLim', 20, 1, 100) };
  const auto = $('#fAuto') ? $('#fAuto').checked : true; CONTACTS.on = $('#fCon') ? $('#fCon').checked : true; store.set('con', CONTACTS.on ? '1' : '0');
  store.set('city', body.city); store.set('cat', body.category); store.set('mode', body.mode); store.set('radmi', String(numVal('fRad', 10, 1, 30))); store.set('lim', String(body.limit)); store.set('auto', auto ? '1' : '0');
  try { ui.lastFind = await api('discover', { method: 'POST', body }); }
  catch (e) {
    if (!(e.data && e.data.clientFallback)) { ui.lastFind = { error: e.message }; renderFindRes(); throw e; }
    // The server could not reach the map servers. Try straight from this browser instead.
    const el = $('#findres'); if (el) el.innerHTML = '<div class="hint" style="margin-top:14px">Server could not reach the map. Searching from your browser…</div>';
    try {
      const f = await FINDER.run(body);
      const r = await api('discover-import', { method: 'POST', body: { items: f.items, place: f.place, limit: body.limit } });
      ui.lastFind = { ...r, debug: { ...r.debug, place: f.place, raw: f.raw, chains: f.chains, server: 'your browser' } };
    } catch (e2) { ui.lastFind = { error: 'Search failed. Server: ' + e.message + '. Browser: ' + e2.message }; renderFindRes(); throw e2; }
  }
  S = await api('state'); chrome(); renderFindRes(); renderLeadsTable();
  const ids = (ui.lastFind && ui.lastFind.ids) || [];
  if (auto && ids.length) {
    const st = await checkAndAudit(ids, pipeSay);
    ui.lastFind.check = st; pipeSay(''); chrome(); renderFindRes(); renderLeadsTable();
    toast(`${ids.length} new · ${st.none + st.social} have no real website · ${st.site} had one${st.emails != null ? ' · ' + st.emails + ' emails found' : ''}`, 6500);
  } else toast(`${ui.lastFind.added} new leads added`);
});

/* ---------- bulk ---------- */
async function bulk(btn, fn) {
  if (busyBulk) return; busyBulk = true; btn.disabled = true;
  const p = (t) => { const e = $('#prog'); if (e) e.textContent = t; };
  try { await fn(p); } catch (e) { toast(e.message, 5200); }
  finally { busyBulk = false; btn.disabled = false; p(''); chrome(); renderLeadsTable(); }
}
A.bulkContacts = (btn) => bulk(btn, async (p) => {
  if (PIPE.on) return toast('A check is already running');
  const picked = sel().size ? S.leads.filter((l) => sel().has(l.id)) : S.leads;
  const ids = picked.filter((l) => !contacted(l) && !validEmail(l.email) && !['unsub', 'skip'].includes(l.status)).map((l) => l.id);
  if (!ids.length) return toast(sel().size ? 'Everything selected already has an email' : 'Every lead already has an email');
  PIPE.stop = false; PIPE.on = true;
  let done = 0, em = 0, ph = 0;
  try {
    const ch = []; for (let i = 0; i < ids.length; i += 2) ch.push(ids.slice(i, i + 2));
    await pool(ch, 2, async (c) => {
      try {
        const r = await api('enrich', { method: 'POST', body: { ids: c, city: store.get('city', '') } });
        r.leads.forEach((l) => { setLead(l); const g = (r.got || {})[l.id] || {}; if (g.email) em++; if (g.phone) ph++; if ($('#tb')) patchRow(l); });
      } catch {}
      done += c.length; p(`Finding contacts ${Math.min(done, ids.length)}/${ids.length} · ${em} emails`);
    });
  } finally { PIPE.on = false; }
  chrome(); renderLeadsTable();
  toast(`Looked up ${ids.length} leads: found ${em} email${em === 1 ? '' : 's'} and ${ph} phone${ph === 1 ? '' : 's'}`, 6000);
});
A.bulkAudit = (btn) => bulk(btn, async (p) => {
  const ids = S.leads.filter((l) => l.website && !l.audit).map((l) => l.id);
  if (!ids.length) return toast('Nothing to audit');
  for (let i = 0; i < ids.length; i += 4) {
    p(`Auditing ${Math.min(i + 4, ids.length)}/${ids.length}…`);
    const r = await api('audit', { method: 'POST', body: { ids: ids.slice(i, i + 4) } });
    r.leads.forEach(setLead);
  }
  toast('Audit done. Emails found were added to leads.');
});
A.bulkDraft = (btn) => bulk(btn, async (p) => {
  const ls = S.leads.filter((l) => validEmail(l.email) && l.status === 'new');
  if (!ls.length) return toast('No new leads with an email yet');
  for (let i = 0; i < ls.length; i++) {
    p(`Writing ${i + 1}/${ls.length}…`);
    let r;
    for (let t = 0; t < 3; t++) {
      try { r = await api('draft', { method: 'POST', body: { id: ls[i].id } }); break; }
      catch (e) {
        if (/rate limit/i.test(e.message) && t < 2) { p(`AI rate limit, waiting a moment (${i + 1}/${ls.length})…`); await sleep(20000); continue; }
        throw e;
      }
    }
    setLead(r.lead);
    await sleep(2300); // stay under Groq free-tier rate limits
  }
  toast('Drafts ready. Skim a few before sending.');
});
A.bulkSend = (btn) => bulk(btn, async (p) => {
  const ls = S.leads.filter((l) => l.status === 'drafted' && validEmail(l.email) && l.draft);
  if (!ls.length) return toast('No drafted leads with an email');
  const cap = Number(S.settings.dailyLimit) || 0, gap = Number(S.settings.sendGap) || 0;
  const room = cap ? Math.max(cap - S.sentToday, 0) : ls.length, n = Math.min(ls.length, room);
  if (!n) return toast('Your daily cap is reached. Change it in Settings.');
  if (!confirm(`Send ${n} email${n === 1 ? '' : 's'}?${gap ? `\n\nThey go out one at a time, about ${gap} seconds apart, so keep this tab open.` : '\n\nThey go out one at a time. Keep this tab open until it finishes.'}`)) return;
  let sent = 0;
  for (const l of ls.slice(0, n)) {
    p(`Sending ${sent + 1}/${n}…`);
    const r = await api('send', { method: 'POST', body: { id: l.id } }); setLead(r.lead); S.sentToday++; sent++;
    if (sent < n && gap) { p(`Sent ${sent}/${n}. Next one in ~${gap}s…`); await jitter(gap * 0.7, gap * 1.3); }
  }
  toast(`Sent ${sent}`);
});

/* ---------- add lead ---------- */
A.addLeadModal = () => {
  $('#ov').innerHTML = `<div class="scrim c" data-act="closeBg"><div class="card modal stack">
    <div class="dh"><h2 style="flex:1">Add a lead</h2><button class="x" data-act="closeOv" aria-label="Close">×</button></div>
    <div><label>Business name</label><input id="mName" autofocus></div>
    <div><label>Email to approach</label><input id="mEmail" type="email" placeholder="owner@business.com"></div>
    <div class="row"><div><label>Website (optional)</label><input id="mSite"></div><div><label>Phone (optional)</label><input id="mPhone"></div></div>
    <button class="btn p" data-act="addLead" style="width:100%;justify-content:center">Add lead</button></div></div>`;
};
A.addLead = (btn) => act(btn, async () => {
  const r = await api('leads', { method: 'POST', body: { name: $('#mName').value, email: $('#mEmail').value, website: $('#mSite').value, phone: $('#mPhone').value } });
  closeOv(); upd(r.lead); toast('Lead added');
});
function closeOv() { const a = document.activeElement; if (a && a.closest && a.closest('#ov')) a.blur(); /* fires the change event so nothing typed is lost */ ui.cur = null; $('#ov').innerHTML = ''; }
A.closeOv = closeOv;
A.closeBg = (t, e) => { if (e.target === t) closeOv(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#ov').innerHTML) closeOv(); });

/* ---------- lead drawer ---------- */
A.openLead = (t, e) => { if (e.target.closest('input,a,select,button,label')) return; ui.cur = t.dataset.id; drawer(); };
const curLead = () => S.leads.find((x) => x.id === ui.cur);

function drawer() {
  const l = curLead(); if (!l) { closeOv(); return; }
  const d = l.draft || { subject: '', body: '' }, top = $('.drawer')?.scrollTop || 0;
  const tone = S.settings.tone || 'friendly';
  const STAT = { new: 'New', drafted: 'Drafted', sent: 'Sent', replied: 'Replied', unsub: 'Do not contact', skip: 'Skipped' };
  $('#ov').innerHTML = `<div class="scrim" data-act="closeBg"><div class="drawer">
    <div class="dh"><div style="flex:1"><h2>${esc(l.name)}</h2><div class="sub">${esc([l.category, l.address, l.phone].filter(Boolean).join(' · '))}</div></div>${statusPill(l)}<button class="x" data-act="closeOv" aria-label="Close">×</button></div>

    <div class="card sec stack"><h4>Contact <span class="hint" style="text-transform:none;letter-spacing:0;font-weight:500">· saves automatically</span></h4>
      <div><label for="dName">Business name</label><input id="dName" data-change="saveContact" value="${esc(l.name)}"></div>
      <div class="grid g2"><div><label for="dEmail">Email to approach</label><input id="dEmail" type="email" inputmode="email" autocapitalize="off" spellcheck="false" data-change="saveContact" value="${esc(l.email)}" placeholder="owner@business.com">
        ${(() => {
          const seen = new Set([l.email]); const chips = [];
          for (const e of l.contacts?.emails || []) if (!seen.has(e.email)) { seen.add(e.email); chips.push([e.email, SRC[e.source] || e.source]); }
          for (const e of [...(l.audit?.emails || []), ...(l.prevEmails || [])]) if (e && !seen.has(e)) { seen.add(e); chips.push([e, '']); }
          return chips.length ? `<div class="alts" aria-label="Other emails found">${chips.slice(0, 6).map(([e, s]) => `<button class="chip" data-act="useEmail" data-v="${esc(e)}" title="${s ? 'From ' + esc(s) + '. ' : ''}Switch to this address">${esc(e)}${s ? ` <small>${esc(s)}</small>` : ''}</button>`).join('')}</div>` : '';
        })()}</div>
      <div><label for="dSite">Website</label><input id="dSite" data-change="saveContact" value="${esc(l.website)}" placeholder="none"></div></div>
      <div class="grid g2"><div><label for="dPhone">Phone</label><input id="dPhone" type="tel" data-change="saveContact" value="${esc(l.phone)}">
        ${(() => { const p = (l.contacts?.phones || []).filter((x) => x.phone !== l.phone).slice(0, 3); return p.length ? `<div class="alts">${p.map((x) => `<button class="chip" data-act="usePhone" data-v="${esc(x.phone)}" title="From ${esc(SRC[x.source] || x.source)}">${esc(x.phone)}</button>`).join('')}</div>` : ''; })()}</div>
      <div><label for="dAddr">Address</label><input id="dAddr" data-change="saveContact" value="${esc(l.address)}"></div></div>
      <div><label for="dNotes">Notes</label><input id="dNotes" data-change="saveContact" value="${esc(l.notes)}" placeholder="Anything to remember"></div>
      ${Object.keys(l.social || {}).length ? `<div class="soc">${socialLinks(l).replace(/<\/?div[^>]*>/g, '')}</div>` : ''}
      ${l.contacts ? `<div class="hint">Looked at ${l.contacts.reached?.length ? esc(l.contacts.reached.join(', ')) : 'nothing reachable'} ${ago(l.contacts.checkedAt)}${l.contacts.notes?.length ? '. ' + esc(l.contacts.notes.join('. ')) : ''}.</div>` : ''}
      <div class="acts"><button class="btn s" data-act="dSave">Save contact</button><button class="btn s" data-act="dFind">${ico('search')} ${l.contacts ? 'Look again' : 'Find contact info'}</button>${l.website ? '<button class="btn s" data-act="dAudit">Audit site</button>' : ''}${contacted(l) ? '<button class="btn s" data-act="dToReplies">Quick reply / follow-up</button>' : ''}</div>
    </div>

    ${l.audit ? `<div class="card sec"><h4>Site audit · ${l.audit.unverified ? 'could not be judged' : l.audit.score + '/100 (higher = weaker site)'}</h4>${l.audit.issues.length ? '<ul class="iss">' + l.audit.issues.map((i) => `<li>${esc(i)}</li>`).join('') + '</ul>' : '<span class="sub">No obvious problems found.</span>'}${l.audit.good?.length ? '<div class="chips" style="margin-top:8px">' + l.audit.good.map((g) => `<span class="pill ok">${esc(g)}</span>`).join('') + '</div>' : ''}</div>` : ''}

    <div class="card sec stack"><h4>Email${d.angle ? ` · angle: ${esc(d.angle)}` : ''}</h4>
      <div><label>Subject</label><input id="dSub" data-change="saveDraft" value="${esc(d.subject)}">
        ${d.alts?.length ? `<div class="alts">${d.alts.map((a) => `<button class="chip" data-act="useAlt" data-v="${esc(a)}">${esc(a)}</button>`).join('')}</div>` : ''}</div>
      <div><label>Body (plain text, sent exactly as written)</label><textarea id="dBody" data-change="saveDraft">${esc(d.body)}</textarea></div>
      <div class="acts">
        <select id="dTone" style="width:auto">${[['friendly', 'Friendly'], ['casual', 'Casual'], ['direct', 'Direct'], ['professional', 'Professional']].map(([v, t]) => `<option value="${v}" ${tone === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <button class="btn s" data-act="dGen">${ico('spark')} ${l.draft ? 'Rewrite' : 'Write with AI'}</button>
        <button class="btn s" data-act="dTest">Send test to me</button>
        <span class="sp"></span>
        <button class="btn p" data-act="dSend">${ico('send')} Send</button>
      </div>
    </div>

    <div class="card sec"><h4>Pipeline</h4>
      <div class="acts"><select id="dStat" data-change="dStat" style="width:auto">${Object.entries(STAT).map(([s, t]) => `<option value="${s}" ${s === l.status ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <span class="sp"></span><button class="btn s d" data-act="dDel">Delete lead</button></div>
    </div>
  </div></div>`;
  $('.drawer').scrollTop = top;
}
const draftNow = () => ({ subject: $('#dSub').value, body: $('#dBody').value });
const hasBlanks = (t) => /\[[^\]\n]{2,}\]/.test(t);

C.saveDraft = async () => {
  const l = curLead(); if (!l || (!$('#dSub').value && !$('#dBody').value)) return;
  try { const r = await api('leads/' + l.id, { method: 'PATCH', body: { draft: draftNow() } }); setLead(r.lead); } catch (e) { toast(e.message); }
};
C.dStat = async (s) => { const l = curLead(); const r = await api('leads/' + l.id, { method: 'PATCH', body: { status: s.value } }); upd(r.lead); };
A.usePhone = (t) => { $('#dPhone').value = t.dataset.v; C.saveContact(); };
A.dFind = (btn) => act(btn, async () => {
  const l = curLead(); if (!l) return;
  const r = await api('enrich', { method: 'POST', body: { ids: [l.id], city: store.get('city', '') } });
  r.leads.forEach((x) => upd(x));
  const g = Object.values(r.got || {})[0] || {};
  toast(g.email ? `Found ${g.email}` : (r.leads[0]?.contacts?.emails?.length ? 'Found other addresses. Pick one below.' : 'Nothing public found'), 3500);
});
A.useAlt = (t) => { $('#dSub').value = t.dataset.v; C.saveDraft(); };
const contactBody = () => {
  const l = curLead(), b = {}, f = { name: '#dName', email: '#dEmail', website: '#dSite', phone: '#dPhone', address: '#dAddr', notes: '#dNotes' };
  for (const [k, sel] of Object.entries(f)) {
    const el = $(sel); if (!el) continue;
    let v = el.value; if (k === 'email') v = cleanEmail(v);
    if (v.trim() !== String(l[k] || '').trim()) b[k] = v;
  }
  return b;
};
async function saveContact(quiet) {
  const l = curLead(); if (!l) return;
  const b = contactBody(), em = $('#dEmail');
  if ('email' in b && b.email && !validEmail(b.email)) { em.setAttribute('aria-invalid', 'true'); toast(`"${em.value.slice(0, 50)}" doesn't look like an email.`, 4500); delete b.email; }
  else if (em) em.removeAttribute('aria-invalid');
  if (!Object.keys(b).length) { if (!quiet) toast('Nothing to save'); return; }
  const was = l.status;
  const r = await api('leads/' + l.id, { method: 'PATCH', body: b });
  upd(r.lead);
  toast('email' in b && was !== 'drafted' && r.lead.status === 'drafted' ? 'Saved. Moved back to Drafted so you can email the new address.' : 'Saved', 2200);
}
C.saveContact = () => saveContact(true).catch((e) => toast(e.message, 4500));
A.dSave = (btn) => act(btn, () => saveContact(false));
A.useEmail = (t) => { $('#dEmail').value = t.dataset.v; C.saveContact(); };
A.dAudit = (btn) => act(btn, async () => {
  const l = curLead(), b = contactBody();
  if (b.website !== undefined) await api('leads/' + l.id, { method: 'PATCH', body: { website: b.website } });
  const r = await api('audit', { method: 'POST', body: { ids: [l.id] } });
  upd(r.leads[0]); toast('Audit done');
});
A.dGen = (btn) => act(btn, async () => {
  const l = curLead();
  const r = await api('draft', { method: 'POST', body: { id: l.id, tone: $('#dTone').value } });
  upd(r.lead);
});
A.dTest = (btn) => act(btn, async () => {
  const l = curLead();
  await api('send', { method: 'POST', body: { id: l.id, test: true, ...draftNow() } });
  toast('Test sent to your reply-to address');
});
A.dSend = (btn) => act(btn, async () => {
  const l = curLead(), email = cleanEmail($('#dEmail').value);
  if (!validEmail(email)) return toast('Add a valid email first.');
  const d = draftNow();
  if (hasBlanks(d.body) && !confirm('Your email still has [bracketed] placeholders. Send anyway?')) return;
  await api('leads/' + l.id, { method: 'PATCH', body: { email } });
  if (!confirm(`Send this email to ${email}?`)) return;
  const r = await api('send', { method: 'POST', body: { id: l.id, ...d } });
  S.sentToday++; upd(r.lead); toast('Sent');
});
A.dDel = async () => {
  const l = curLead(); if (!l || !confirm('Delete this lead?')) return;
  await api('leads/' + l.id, { method: 'DELETE' });
  S.leads = S.leads.filter((x) => x.id !== l.id); closeOv(); chrome(); renderLeadsTable();
};
A.dToReplies = () => { const id = ui.cur; closeOv(); go('replies', { replyLead: id, replyFilter: 'all' }); };

/* ---------- selection and delete ---------- */
const sel = () => (ui.sel ||= new Set());
const visibleRows = () => {
  const q = ui.query.toLowerCase();
  return S.leads.filter((l) => (!q || `${l.name} ${l.category} ${l.address} ${l.email} ${l.website}`.toLowerCase().includes(q)) && leadMatches(l, ui.filter)).sort((a, b) => (isHot(b) ? 1 : 0) - (isHot(a) ? 1 : 0));
};
const QS = [
  ['all', 'Everything shown'], ['fresh', 'Not emailed yet'], ['nothot', 'Everything that is not hot (keeps emailed)'], ['noemail', 'No email address'],
  ['hassite', 'Has a website'], ['decent', 'Decent sites (score under 25)'], ['blocked', 'Site blocked or unchecked'], ['lastfind', 'From my last search'], ['invert', 'Invert selection'], ['none', 'Clear selection'],
];
function renderSel() {
  const q = $('#qsel'); if (!q) return;
  const keep = ui.sel ? [...ui.sel].filter((id) => S.leads.some((l) => l.id === id)) : [];
  ui.sel = new Set(keep);
  if (!q.options.length) q.innerHTML = '<option value="">Select…</option>' + QS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  const vis = visibleRows(), n = ui.sel.size, inView = vis.filter((l) => ui.sel.has(l.id)).length;
  const all = $('#selAll');
  if (all) { all.checked = vis.length > 0 && inView === vis.length; all.indeterminate = inView > 0 && inView < vis.length; }
  document.querySelectorAll('#tb input.sel').forEach((c) => { c.checked = ui.sel.has(c.dataset.id); c.closest('tr').classList.toggle('picked', c.checked); });
  const bar = $('#selbar');
  bar.classList.toggle('hide', !n);
  const hidden = n - inView;
  bar.innerHTML = n ? `<b>${n}</b> selected${hidden > 0 ? ` <span class="hint">(${hidden} hidden by the filter)</span>` : ''}
    <button class="btn s d" data-act="bulkDelAsk">${ico('trash')} Delete</button><button class="btn s g" data-act="selNone">Clear</button>` : '';
}
A.selRow = (t, e) => {
  const id = t.dataset.id, rows = visibleRows().map((l) => l.id);
  if (e.shiftKey && ui.lastSel && rows.includes(ui.lastSel) && rows.includes(id)) {
    const a = rows.indexOf(ui.lastSel), b = rows.indexOf(id);
    rows.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => (t.checked ? sel().add(x) : sel().delete(x)));
  } else (t.checked ? sel().add(id) : sel().delete(id));
  ui.lastSel = id; renderSel();
};
A.selAll = (t) => { visibleRows().forEach((l) => (t.checked ? sel().add(l.id) : sel().delete(l.id))); renderSel(); };
A.selNone = () => { ui.sel = new Set(); renderSel(); };
C.quickSel = (s) => {
  const v = s.value; s.value = '';
  const vis = visibleRows(), pick = (fn) => { ui.sel = new Set(vis.filter(fn).map((l) => l.id)); };
  const last = new Set((ui.lastFind && ui.lastFind.ids) || []);
  if (v === 'all') pick(() => true);
  else if (v === 'none') ui.sel = new Set();
  else if (v === 'fresh') pick((l) => ['new', 'drafted'].includes(l.status));
  else if (v === 'nothot') pick((l) => !isHot(l) && !contacted(l));
  else if (v === 'noemail') pick((l) => !validEmail(l.email) && !contacted(l));
  else if (v === 'hassite') pick((l) => !!l.website && !contacted(l));
  else if (v === 'decent') pick((l) => !!l.audit && !l.audit.unverified && l.audit.score < 25 && !contacted(l));
  else if (v === 'blocked') pick((l) => !contacted(l) && ((l.audit && l.audit.unverified) || (l.website && !l.audit) || (!l.website && !l.web)));
  else if (v === 'lastfind') pick((l) => last.has(l.id));
  else if (v === 'invert') ui.sel = new Set(vis.filter((l) => !ui.sel.has(l.id)).map((l) => l.id));
  renderSel();
  const n = ui.sel.size; if (v !== 'none') toast(n ? `${n} selected` : 'Nothing matched that');
};
async function deleteLeads(ids, dismiss) {
  const removed = S.leads.filter((l) => ids.includes(l.id));
  await api('leads-bulk', { method: 'POST', body: { action: 'delete', ids, dismiss } });
  const gone = new Set(ids); S.leads = S.leads.filter((l) => !gone.has(l.id)); ids.forEach((id) => sel().delete(id));
  chrome(); if ($('#tb')) renderLeadsTable();
  toastAct(`Deleted ${removed.length} lead${removed.length === 1 ? '' : 's'}`, 'Undo', async () => {
    const r = await api('leads-undo', { method: 'POST', body: {} });
    S = await api('state'); chrome(); if ($('#tb')) renderLeadsTable(); toast(`Restored ${r.restored}`);
  }, 12000);
}
A.rowDel = (t) => deleteLeads([t.dataset.id], true).catch((e) => toast(e.message, 4500));
A.bulkDelAsk = () => {
  const ls = S.leads.filter((l) => sel().has(l.id)); if (!ls.length) return;
  const sent = ls.filter(contacted).length, names = ls.slice(0, 5).map((l) => esc(l.name)).join(', ');
  $('#ov').innerHTML = `<div class="scrim c" data-act="closeBg"><div class="card modal stack">
    <div class="dh"><h2>Delete ${ls.length} lead${ls.length === 1 ? '' : 's'}?</h2><div class="sp"></div><button class="x" data-act="closeOv" aria-label="Close">×</button></div>
    <div class="hint">${names}${ls.length > 5 ? ` and ${ls.length - 5} more` : ''}</div>
    ${sent ? `<div class="banner" style="margin:0"><b>${sent}</b> of these ${sent === 1 ? 'was' : 'were'} already emailed. Their history goes with them.</div>` : ''}
    <label class="chk"><input type="checkbox" id="delDismiss" checked> Don't bring these back when I search again</label>
    <div class="acts"><button class="btn d" data-act="bulkDelGo">${ico('trash')} Delete ${ls.length}${sent ? ' (including emailed)' : ''}</button><button class="btn" data-act="closeOv">Cancel</button></div>
    <div class="hint">You can undo right after.</div></div></div>`;
};
A.bulkDelGo = (btn) => act(btn, async () => { const dismiss = $('#delDismiss').checked, ids = [...sel()]; closeOv(); await deleteLeads(ids, dismiss); });
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Delete') && ui.sel && ui.sel.size && $('#tb') && !$('#ov').innerHTML.trim() && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { e.preventDefault(); A.bulkDelAsk(); }
});
A.dDel = async () => {
  const l = curLead(); if (!l) return;
  closeOv(); await deleteLeads([l.id], true).catch((e) => toast(e.message, 4500));
};

/* ---------- website check pipeline ---------- */
const PIPE = { stop: false, on: false };
const CONTACTS = { on: true };
A.stopPipe = () => { PIPE.stop = true; };
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length && !PIPE.stop) { const k = i++; await fn(items[k], k); } }));
}
async function checkAndAudit(ids, say) {
  PIPE.stop = false; PIPE.on = true;
  const st = { total: ids.length, checked: 0, site: 0, none: 0, social: 0, unsure: 0, audited: 0, poor: 0 };
  const line = (ph) => say(`${ph} · ${st.checked}/${st.total} checked · <b>${st.none}</b> no site · ${st.social} social only · ${st.site} have a site${st.audited ? ` (${st.poor} poor)` : ''} <button class="btn s" data-act="stopPipe">Stop</button>`);
  try {
    const todo = ids.filter((id) => { const l = S.leads.find((x) => x.id === id); return l && !l.website; });
    const chunks = []; for (let i = 0; i < todo.length; i += 2) chunks.push(todo.slice(i, i + 2));
    st.total = todo.length;
    await pool(chunks, 2, async (ch) => {
      try {
        const r = await api('verify', { method: 'POST', body: { ids: ch, city: store.get('city', '') } });
        r.leads.forEach((l) => { setLead(l); st.checked++; const s = l.web && l.web.status; if (s === 'site') st.site++; else if (s === 'none') st.none++; else if (s === 'social') st.social++; else st.unsure++; if ($('#tb')) patchRow(l); });
      } catch { st.checked += ch.length; st.unsure += ch.length; }
      line('Checking websites');
    });
    const need = ids.filter((id) => { const l = S.leads.find((x) => x.id === id); return l && l.website && !l.audit; });
    const ach = []; for (let i = 0; i < need.length; i += 3) ach.push(need.slice(i, i + 3));
    await pool(ach, 2, async (ch) => {
      try { const r = await api('audit', { method: 'POST', body: { ids: ch } }); r.leads.forEach((l) => { setLead(l); st.audited++; if (l.audit.score >= 40 && !l.audit.unverified) st.poor++; if ($('#tb')) patchRow(l); }); } catch {}
      line('Auditing sites');
    });
    if (CONTACTS.on) {
      const want = ids.filter((id) => { const l = S.leads.find((x) => x.id === id); return l && !l.contacts && !contacted(l); });
      st.contacts = 0; st.emails = 0; st.phones = 0;
      const ech = []; for (let i = 0; i < want.length; i += 2) ech.push(want.slice(i, i + 2));
      await pool(ech, 2, async (ch) => {
        try {
          const r = await api('enrich', { method: 'POST', body: { ids: ch, city: store.get('city', '') } });
          r.leads.forEach((l) => { setLead(l); st.contacts++; const g = (r.got || {})[l.id] || {}; if (g.email) st.emails++; if (g.phone) st.phones++; if ($('#tb')) patchRow(l); });
        } catch { st.contacts += ch.length; }
        say(`Finding contact info · ${st.contacts}/${want.length} · <b>${st.emails}</b> emails so far <button class="btn s" data-act="stopPipe">Stop</button>`);
      });
    }
  } finally { PIPE.on = false; }
  return st;
}
const pipeSay = (h) => { const e = $('#findprog'); if (e) e.innerHTML = h; };
A.bulkVerify = (btn) => bulk(btn, async () => {
  if (PIPE.on) return toast('A check is already running');
  const ids = S.leads.filter((l) => !l.website && (!l.web || l.web.status === 'unsure') && !contacted(l)).map((l) => l.id);
  if (!ids.length) return toast('Every lead without a website is already checked');
  const st = await checkAndAudit(ids, pipeSay);
  pipeSay(''); chrome(); renderLeadsTable();
  toast(`Checked ${st.checked}: ${st.none + st.social} have no real site, ${st.site} had one`, 6000);
});
