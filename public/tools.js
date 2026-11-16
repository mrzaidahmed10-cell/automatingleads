'use strict';
/* ---------- tools: jobs that run across all your leads ---------- */
const toolCounts = () => {
  const L = S.leads;
  const dupes = dupGroups();
  return {
    verify: L.filter((l) => !l.website && (!l.web || l.web.status === 'unsure') && !contacted(l)).length,
    contacts: L.filter((l) => !contacted(l) && !l.phone && isOpen(l)).length,
    audit: L.filter((l) => l.website && !l.audit).length,
    dupes: dupes.reduce((a, g) => a + g.length - 1, 0),
    decent: L.filter((l) => l.audit && !l.audit.unverified && l.audit.score < 25 && !contacted(l) && !l.starred).length,
  };
};
// Same business name (ignoring case and punctuation) appearing more than once
const nameKey = (n) => String(n || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
function dupGroups() {
  const m = new Map();
  S.leads.forEach((l) => { const k = nameKey(l.name); if (k) (m.get(k) || m.set(k, []).get(k)).push(l); });
  return [...m.values()].filter((g) => g.length > 1);
}
const rank = (l) => (l.status === 'replied' ? 4 : l.status === 'sent' ? 3 : 0) + (l.starred ? 2 : 0) + (validEmail(l.email) ? 1 : 0);

function vTools() {
  const c = toolCounts();
  const job = (act, title, desc, n, icon) => `<div class="tool"><div><b>${title}</b><div class="hint">${desc}</div></div><button class="btn s ${n ? '' : 'g'}" data-act="${act}" ${n ? '' : 'disabled'}>${icon ? ico(icon) + ' ' : ''}${n ? 'Run on ' + n : 'Nothing to do'}</button></div>`;
  $('#view').innerHTML = `
    <div class="card pad"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><h3>Run on all leads</h3><span class="sp"></span><span class="hint" id="prog"></span></div>
      <div class="hint">Each job only touches leads that still need it. Select leads on the Leads page to run phone lookup on just those.</div>
      <div class="tools-list">
        ${job('toolVerify', 'Verify websites', 'Check that leads with no listed website really have none.', c.verify, 'shield')}
        ${job('toolContacts', 'Find phone numbers', 'Look up phone and social pages for leads without a number.', c.contacts, 'phone')}
        ${job('toolAudit', 'Audit websites', 'Score existing sites; audits also turn up contact emails.', c.audit)}
      </div></div>
    <div class="grid g2 tight">
      <div class="card pad"><h3>Import &amp; export</h3>
        <div class="hint">Paste one lead per line: <code>Business name, phone, website, email</code> (only the name is required).</div>
        <textarea id="impTxt" rows="5" placeholder="Joe's Barber Shop, 319-555-0101, , joe@example.com" aria-label="Leads to import" style="margin-top:8px"></textarea>
        <div class="acts" style="margin-top:8px"><button class="btn s p" data-act="toolImport">Import</button><span class="sp"></span>
          <button class="btn s g" data-act="toolExport" data-w="all">Export all</button><button class="btn s g" data-act="toolExport" data-w="starred">Export starred</button><button class="btn s g" data-act="toolExport" data-w="tocall">Export to call</button></div></div>
      <div class="card pad"><h3>Clean up</h3><div class="hint">Starred and already-emailed leads are never removed by these.</div>
        <div class="tools-list">
          ${`<div class="tool"><div><b>Merge duplicates</b><div class="hint">Same business name twice. Keeps the most advanced copy.</div></div><button class="btn s ${c.dupes ? '' : 'g'}" data-act="toolDupes" ${c.dupes ? '' : 'disabled'}>${c.dupes ? 'Remove ' + c.dupes : 'None found'}</button></div>`}
          ${`<div class="tool"><div><b>Drop leads with decent sites</b><div class="hint">Audit score under 25: they probably do not need you.</div></div><button class="btn s ${c.decent ? '' : 'g'}" data-act="toolDecent" ${c.decent ? '' : 'disabled'}>${c.decent ? 'Remove ' + c.decent : 'None found'}</button></div>`}
          <div class="tool"><div><b>Undo last delete or block</b><div class="hint">Works for an hour after.</div></div><button class="btn s" data-act="toolUndo">Undo</button></div>
        </div></div>
    </div>`;
}
// Tools always run on everything that needs it, not on whatever is ticked in the Leads table
const allLeads = (fn) => (btn, e) => { ui.sel = new Set(); const r = fn(btn, e); Promise.resolve(r).then(() => setTimeout(() => page() === 'tools' && vTools(), 60)); return r; };
A.toolVerify = allLeads((b) => A.bulkVerify(b));
A.toolContacts = allLeads((b) => A.bulkContacts(b));
A.toolAudit = allLeads((b) => A.bulkAudit(b));
A.toolExport = (t) => {
  const w = t.dataset.w, prev = ui.sel; ui.sel = new Set();
  const keep = ui.filter; ui.filter = w;
  try { A.exportCsv(); } finally { ui.filter = keep; ui.sel = prev; }
};
A.toolImport = (btn) => act(btn, async () => {
  const lines = $('#impTxt').value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 100);
  if (!lines.length) return toast('Paste some leads first');
  let ok = 0, bad = 0;
  for (const ln of lines) {
    const [name, phone, website, email] = ln.split(/\s*[,\t]\s*/);
    try { const r = await api('leads', { method: 'POST', body: { name, email: email || '', website: website || '', phone: phone || '' } }); setLead(r.lead); ok++; } catch { bad++; }
  }
  $('#impTxt').value = ''; chrome(); vTools();
  toast(`Imported ${ok}${bad ? ` · ${bad} skipped (bad name or email)` : ''}`, 4500);
});
A.toolDupes = async () => {
  const drop = [];
  dupGroups().forEach((g) => { const s = [...g].sort((a, b) => rank(b) - rank(a)); s.slice(1).filter((l) => !contacted(l) && !l.starred).forEach((l) => drop.push(l.id)); });
  if (!drop.length) return toast('Duplicates were already emailed or starred, so nothing was removed');
  if (!confirm(`Remove ${drop.length} duplicate lead${drop.length === 1 ? '' : 's'}?`)) return;
  await deleteLeads(drop, false).catch((e) => toast(e.message, 4500)); vTools();
};
A.toolDecent = async () => {
  const ids = S.leads.filter((l) => l.audit && !l.audit.unverified && l.audit.score < 25 && !contacted(l) && !l.starred).map((l) => l.id);
  if (!ids.length || !confirm(`Remove ${ids.length} lead${ids.length === 1 ? '' : 's'} that already have a decent website?`)) return;
  await deleteLeads(ids, true).catch((e) => toast(e.message, 4500)); vTools();
};
A.toolUndo = async () => { try { const r = await api('leads-undo', { method: 'POST', body: {} }); S = await api('state'); chrome(); vTools(); toast(`Restored ${r.restored}`); } catch (e) { toast(e.message, 4500); } };
