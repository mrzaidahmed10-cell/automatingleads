'use strict';
/* ---------- calls: your call queue ---------- */
const CALL_TABS = [
  ['tocall', 'To call', (l) => !!l.phone && !isCalled(l) && isOpen(l)],
  ['callback', 'Call back', (l) => l.callStatus === 'callback'],
  ['again', 'No answer', (l) => ['noanswer', 'voicemail'].includes(l.callStatus)],
  ['interested', 'Interested', (l) => ['interested', 'won'].includes(l.callStatus)],
  ['all', 'All called', (l) => isCalled(l)],
];
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const callbackDue = (l) => l.callStatus === 'callback' && (!l.callbackAt || l.callbackAt <= todayStr());
const callsToday = () => { const d = new Date().toDateString(); return S.leads.reduce((n, l) => n + (l.callLog || []).filter((c) => new Date(c.t).toDateString() === d).length, 0); };

function callRows() {
  const f = CALL_TABS.find((t) => t[0] === ui.callFilter) || CALL_TABS[0];
  let rows = S.leads.filter(f[2]);
  if (f[0] === 'tocall') rows.sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || (isHot(b) ? 1 : 0) - (isHot(a) ? 1 : 0));
  else if (f[0] === 'callback') rows.sort((a, b) => (a.callbackAt || '') < (b.callbackAt || '') ? -1 : 1);
  else rows.sort((a, b) => ((b.callLog || [])[0]?.t || 0) - ((a.callLog || [])[0]?.t || 0));
  return rows;
}
function vCalls() {
  $('#view').innerHTML = `<div class="card"><div class="tools"><div class="chips" id="cchips"></div><div class="sp"></div><span class="hint" id="ctoday"></span></div><div class="list" id="clist"></div></div>`;
  renderCalls();
}
function renderCalls() {
  const el = $('#clist'); if (!el) return;
  if (!CALL_TABS.some((t) => t[0] === ui.callFilter)) ui.callFilter = 'tocall';
  $('#cchips').innerHTML = CALL_TABS.map(([k, t, fn]) => { const n = S.leads.filter(fn).length; const due = k === 'callback' ? S.leads.filter(callbackDue).length : 0; return `<button class="chip ${ui.callFilter === k ? 'on' : ''}" data-act="callTab" data-f="${k}">${t}<small>${n}</small>${due ? `<span class="dot-due" title="${due} due"></span>` : ''}</button>`; }).join('');
  $('#ctoday').textContent = `${callsToday()} call${callsToday() === 1 ? '' : 's'} today`;
  const rows = callRows();
  el.innerHTML = rows.length ? rows.map((l) => {
    const last = (l.callLog || [])[0];
    const sub = [l.category, l.web && l.web.status === 'none' ? 'no website' : l.website ? host(l.website) : '', last ? `${(OUT[last.outcome] || [last.outcome])[0]} ${ago(last.t)}${last.note ? ': ' + last.note : ''}` : '', l.callStatus === 'callback' && l.callbackAt ? 'back on ' + l.callbackAt : ''].filter(Boolean).join(' · ');
    return `<div class="li crow ${callbackDue(l) ? 'due' : ''}" data-act="openLead" data-id="${esc(l.id)}" tabindex="0" role="button" aria-label="Open ${esc(l.name)}">
      <button class="star ${l.starred ? 'on' : ''}" data-act="star" data-id="${esc(l.id)}" aria-pressed="${!!l.starred}" aria-label="${l.starred ? 'Unstar' : 'Star'} ${esc(l.name)}">${l.starred ? '★' : '☆'}</button>
      <div class="cmain"><div class="nm">${esc(l.name)}${isHot(l) ? ' <span class="pill acc">Hot</span>' : ''}</div><div class="sub">${esc(sub)}</div></div>
      <div class="cact">${l.phone ? `<a class="btn s p" href="${esc(telHref(l.phone))}">${ico('phone')} ${esc(l.phone)}</a>` : '<span class="hint">no phone</span>'}
        ${l.phone ? `<button class="btn s g" data-act="quickLog" data-id="${esc(l.id)}" data-o="noanswer" title="Log: no answer">No answer</button><button class="btn s g" data-act="quickLog" data-id="${esc(l.id)}" data-o="voicemail" title="Log: left a voicemail">VM</button>` : ''}</div></div>`;
  }).join('') : `<div class="empty"><b>${ui.callFilter === 'tocall' ? 'Nobody left to call' : 'Nothing here'}</b>${ui.callFilter === 'tocall' ? '<a href="#/find">Find more leads</a> or run Find contact info on leads without a number.' : 'Calls you log show up here.'}</div>`;
}
A.callTab = (t) => { ui.callFilter = t.dataset.f; renderCalls(); };
A.quickLog = async (t, e) => {
  e && e.stopPropagation();
  try { const r = await api('leads/' + t.dataset.id, { method: 'PATCH', body: { logCall: { outcome: t.dataset.o, note: '' } } }); setLead(r.lead); chrome(); renderCalls(); toast(`Logged: ${OUT[t.dataset.o][0]}`, 1800); }
  catch (er) { toast(er.message, 4000); }
};
