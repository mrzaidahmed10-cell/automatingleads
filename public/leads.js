'use strict';
/* ---------- leads page ---------- */
const FILTERS = [['all', 'All'], ['email', 'Has email'], ['noemail', 'Needs email'], ['nosite', 'No website'], ['poor', 'Poor site'], ['drafted', 'Drafted'], ['sent', 'Sent'], ['replied', 'Replied']];
let busyBulk = false;

function leadMatches(l, f) {
  switch (f) {
    case 'email': return validEmail(l.email);
    case 'noemail': return !validEmail(l.email) && !['unsub', 'skip'].includes(l.status);
    case 'nosite': return !l.website;
    case 'poor': return !!(l.audit && l.audit.score >= 40);
    case 'drafted': return l.status === 'drafted';
    case 'sent': return l.status === 'sent';
    case 'replied': return l.status === 'replied';
    default: return true;
  }
}
const siteCell = (l) => {
  if (!l.website) return '<span class="pill bad">No website</span>';
  const a = `<a href="${esc(href(l.website))}" target="_blank" rel="noopener noreferrer">${esc(host(l.website))}</a>`;
  if (!l.audit) return a + '<br><span class="pill">Not audited</span>';
  if (l.audit.unverified) return a + '<br><span class="pill">Blocked · check by hand</span>';
  const sc = l.audit.score, c = sc >= 50 ? 'bad' : sc >= 25 ? 'warn' : 'ok';
  return a + `<br><span class="pill ${c}">${sc >= 50 ? 'Poor' : sc >= 25 ? 'Dated' : 'Decent'} · ${sc}</span>`;
};
const statusPill = (l) => {
  const m = { new: ['New', ''], drafted: ['Drafted', 'acc'], sent: ['Sent', 'ok'], replied: ['Replied', 'ok'], unsub: ['Do not contact', 'bad'], skip: ['Skipped', ''] }[l.status] || ['New', ''];
  return `<span class="pill ${m[1]}">${m[0]}</span>`;
};

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
          <div><label id="fModeL">Looking for</label><div id="fModeMount" class="seg"></div></div>
          <div style="max-width:120px;min-width:100px"><label>Radius</label><select id="fRad">${[5, 15, 30, 50].map((v) => opt(v, v + ' km', String(store.get('rad', 15)) === String(v))).join('')}</select></div>
          <div style="flex:0 0 auto;min-width:0"><button class="btn p" data-act="find">${ico('mapPin')} Find leads</button></div>
        </div>
      </div>
      <div id="findres"></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="tools"><div class="chips" id="chips"></div><div class="sp"></div><div id="qMount" class="qm"></div></div>
      <div class="tools">
        <button class="btn s" data-act="bulkAudit">Audit sites</button>
        <button class="btn s" data-act="bulkDraft">Draft for all with email</button>
        <button class="btn s p" data-act="bulkSend">${ico('send')} Send all drafted</button>
        <span class="hint" id="prog"></span>
      </div>
      <div class="tw"><table class="rt"><thead><tr><th>Business</th><th>Website</th><th>Email</th><th>Status</th></tr></thead><tbody id="tb"></tbody></table></div>
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
  const cur = store.get('mode', 'none') === 'has_site' ? 'has_site' : 'none';
  const set = (v) => { store.set('mode', v); mountMode(); };
  if (G()) return G().mount(m, 'Seg', { label: 'Looking for', value: cur, onValueChange: set, items: [{ value: 'none', label: 'No website' }, { value: 'has_site', label: 'Has a site' }] });
  m.innerHTML = `<select id="fModeSel" aria-labelledby="fModeL"><option value="none" ${cur === 'none' ? 'selected' : ''}>No website</option><option value="has_site" ${cur === 'has_site' ? 'selected' : ''}>Has a website (audit it)</option></select>`;
  $('#fModeSel').onchange = (e) => set(e.target.value);
}
function renderFindRes() {
  const el = $('#findres'); if (!el) return;
  const r = ui.lastFind;
  if (!r) { el.innerHTML = ''; return; }
  if (r.error) { el.innerHTML = `<div class="banner" style="margin:14px 0 0">${esc(r.error)}</div>`; return; }
  const d = r.debug || {};
  el.innerHTML = `<div class="hint" style="margin-top:14px">Searched <b>${esc(d.place || '')}</b> · ${d.raw ?? r.found} places on the map · <b style="color:var(--ok)">${r.added} new</b> · ${r.dupes} already in your list${d.chains ? ' · ' + d.chains + ' chains skipped' : ''}</div>` +
    (r.found === 0 ? `<div class="banner" style="margin:10px 0 0">Nothing matched. Try a bigger radius, the "Everything" category, or switch to "Has a website" to find outdated sites. Map coverage varies by town.</div>` : '');
}

function renderLeadsTable() {
  const tb = $('#tb'); if (!tb) return;
  const q = ui.query.toLowerCase();
  const base = S.leads.filter((l) => !q || `${l.name} ${l.category} ${l.address} ${l.email} ${l.website}`.toLowerCase().includes(q));
  $('#chips').innerHTML = FILTERS.map(([k, t]) => `<button class="chip ${ui.filter === k ? 'on' : ''}" data-act="setFilter" data-f="${k}">${t}<small>${base.filter((l) => leadMatches(l, k)).length}</small></button>`).join('');
  const rows = base.filter((l) => leadMatches(l, ui.filter));
  const empty = $('#empty');
  if (!rows.length) {
    empty.classList.remove('hide');
    empty.innerHTML = S.leads.length ? '<b>No leads match</b>Try a different filter or search.' : '<b>No leads yet</b>Use the finder above to search a city, or add a lead by hand.';
  } else empty.classList.add('hide');
  tb.innerHTML = rows.map(rowHtml).join('');
}
const rowHtml = (l) => `<tr class="lead" tabindex="0" aria-label="Open ${esc(l.name)}" data-act="openLead" data-id="${esc(l.id)}">
    <td><div class="nm">${esc(l.name)}</div><div class="sub">${esc([l.category, l.address || l.phone].filter(Boolean).join(' · '))}</div></td>
    <td>${siteCell(l)}</td>
    <td><input class="em" type="email" inputmode="email" autocapitalize="off" spellcheck="false" data-change="rowEmail" aria-label="Email for ${esc(l.name)}" data-id="${esc(l.id)}" placeholder="add email" value="${esc(l.email)}"></td>
    <td>${statusPill(l)}</td></tr>`;
// Update one row in place so a save never wipes what you are typing in the next row
function patchRow(l) {
  const tr = $(`#tb tr[data-id="${CSS.escape(l.id)}"]`);
  if (!tr) return;
  const t = document.createElement('tbody'); t.innerHTML = rowHtml(l);
  const nt = t.firstElementChild, inp = tr.querySelector('input.em');
  if (inp && inp === document.activeElement) { [0, 1, 3].forEach((i) => (tr.children[i].innerHTML = nt.children[i].innerHTML)); }
  else tr.replaceWith(nt);
}
function chipsOnly() {
  const q = ui.query.toLowerCase(), c = $('#chips'); if (!c) return;
  const base = S.leads.filter((l) => !q || `${l.name} ${l.category} ${l.address} ${l.email} ${l.website}`.toLowerCase().includes(q));
  c.innerHTML = FILTERS.map(([k, t]) => `<button class="chip ${ui.filter === k ? 'on' : ''}" data-act="setFilter" data-f="${k}">${t}<small>${base.filter((l) => leadMatches(l, k)).length}</small></button>`).join('');
}
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
  const body = { city: $('#fCity').value, category: $('#fCat').value, mode: store.get('mode', 'none') === 'has_site' ? 'has_site' : 'none', radius: $('#fRad').value };
  store.set('city', body.city); store.set('cat', body.category); store.set('mode', body.mode); store.set('rad', body.radius);
  try { ui.lastFind = await api('discover', { method: 'POST', body }); }
  catch (e) {
    if (!(e.data && e.data.clientFallback)) { ui.lastFind = { error: e.message }; renderFindRes(); throw e; }
    // The server could not reach the map servers. Try straight from this browser instead.
    const el = $('#findres'); if (el) el.innerHTML = '<div class="hint" style="margin-top:14px">Server could not reach the map. Searching from your browser…</div>';
    try {
      const f = await FINDER.run(body);
      const r = await api('discover-import', { method: 'POST', body: { items: f.items, place: f.place } });
      ui.lastFind = { ...r, debug: { ...r.debug, place: f.place, raw: f.raw, chains: f.chains, server: 'your browser' } };
    } catch (e2) { ui.lastFind = { error: 'Search failed. Server: ' + e.message + '. Browser: ' + e2.message }; renderFindRes(); throw e2; }
  }
  S = await api('state'); chrome(); renderFindRes(); renderLeadsTable();
  toast(`${ui.lastFind.added} new leads added`);
});

/* ---------- bulk ---------- */
async function bulk(btn, fn) {
  if (busyBulk) return; busyBulk = true; btn.disabled = true;
  const p = (t) => { const e = $('#prog'); if (e) e.textContent = t; };
  try { await fn(p); } catch (e) { toast(e.message, 5200); }
  finally { busyBulk = false; btn.disabled = false; p(''); chrome(); renderLeadsTable(); }
}
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
A.openLead = (t, e) => { if (e.target.closest('input,a,select')) return; ui.cur = t.dataset.id; drawer(); };
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
        ${(() => { const alts = [...new Set([...(l.audit?.emails || []), ...(l.prevEmails || [])])].filter((e) => e && e !== l.email).slice(0, 5); return alts.length ? `<div class="alts" aria-label="Other emails found">${alts.map((e) => `<button class="chip" data-act="useEmail" data-v="${esc(e)}" title="Switch to this address">${esc(e)}</button>`).join('')}</div>` : ''; })()}</div>
      <div><label for="dSite">Website</label><input id="dSite" data-change="saveContact" value="${esc(l.website)}" placeholder="none"></div></div>
      <div class="grid g2"><div><label for="dPhone">Phone</label><input id="dPhone" type="tel" data-change="saveContact" value="${esc(l.phone)}"></div>
      <div><label for="dAddr">Address</label><input id="dAddr" data-change="saveContact" value="${esc(l.address)}"></div></div>
      <div><label for="dNotes">Notes</label><input id="dNotes" data-change="saveContact" value="${esc(l.notes)}" placeholder="Anything to remember"></div>
      <div class="acts"><button class="btn s" data-act="dSave">Save contact</button>${l.website ? '<button class="btn s" data-act="dAudit">Audit site</button>' : ''}${contacted(l) ? '<button class="btn s" data-act="dToReplies">Quick reply / follow-up</button>' : ''}</div>
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
