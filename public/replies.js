'use strict';
/* ---------- quick replies & follow-ups ---------- */
const INTENT = {
  interested: ['They sound interested', 'replied'], question: ['They asked a question', 'replied'], pricing: ['They asked about price', 'replied'], scheduling: ['They want to schedule', 'replied'],
  not_now: ['Not right now', 'skip'], no: ['They said no', 'skip'], unsubscribe: ['They want to stop hearing from you', 'unsub'],
};

function replyList() {
  const L = S.leads.filter(contacted);
  const f = ui.replyFilter;
  const rows = f === 'replied' ? L.filter((l) => l.status === 'replied').sort((a, b) => (b.repliedAt || 0) - (a.repliedAt || 0))
    : f === 'due' ? L.filter(dueFollowup).sort((a, b) => a.sentAt - b.sentAt)
    : L.sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0));
  return { L, rows };
}

function vReplies() {
  $('#view').innerHTML = `
    <div class="split">
      <div class="card"><div class="tools"><div class="chips" id="rchips"></div></div><div class="list" id="rlist"></div></div>
      <div id="rcomp"></div>
    </div>`;
  renderReplyList(); renderComposer();
}

function renderReplyList() {
  const el = $('#rlist'); if (!el) return;
  const { L, rows } = replyList();
  const counts = { replied: L.filter((l) => l.status === 'replied').length, due: L.filter(dueFollowup).length, all: L.length };
  $('#rchips').innerHTML = [['replied', 'Replied'], ['due', 'Follow-up due'], ['all', 'All emailed']].map(([k, t]) => `<button class="chip ${ui.replyFilter === k ? 'on' : ''}" data-act="rFilter" data-f="${k}">${t}<small>${counts[k]}</small></button>`).join('');
  if (!rows.some((l) => l.id === ui.replyLead)) ui.replyLead = ui.replyLead && L.some((l) => l.id === ui.replyLead) ? ui.replyLead : rows[0]?.id || null;
  el.innerHTML = rows.length ? rows.map((l) => `<div class="li ${l.id === ui.replyLead ? 'on' : ''}" data-act="rPick" data-id="${esc(l.id)}">
      <div style="display:flex;gap:8px;align-items:center"><span class="nm">${esc(l.name)}</span><span class="sp"></span>${statusPill(l)}</div>
      <div class="sub">${l.status === 'replied' ? 'Replied ' + ago(l.repliedAt || l.sentAt) : 'Emailed ' + ago(l.sentAt)}${(l.followups || []).length ? ` · ${l.followups.length} follow-up${l.followups.length > 1 ? 's' : ''}` : ''}</div></div>`).join('')
    : `<div class="empty"><b>${L.length ? 'Nobody here right now' : 'No emails sent yet'}</b>${L.length ? 'Switch the filter above.' : 'Once you send your first emails, replies and follow-ups show up here.'}</div>`;
}
A.rFilter = (t) => { syncR(); ui.replyFilter = t.dataset.f; renderReplyList(); renderComposer(); };
A.rPick = (t) => { syncR(); ui.replyLead = t.dataset.id; renderReplyList(); renderComposer(); if (innerWidth < 980) $('#rcomp').scrollIntoView({ behavior: 'smooth' }); };

/* composer state is kept per lead so switching around doesn't lose text */
ui.rd = ui.rd || {};
const rdFor = (id) => (ui.rd[id] ||= { their: '', subject: '', body: '', intent: '' });
function syncR() {
  if (!ui.replyLead || !$('#rBody')) return;
  const d = rdFor(ui.replyLead);
  d.their = $('#rThem').value; d.subject = $('#rSub').value; d.body = $('#rBody').value;
}
const fillTpl = (body, l) => body.replace(/\{\{business\}\}/g, l.name).replace(/\{\{contact\}\}/g, 'there').replace(/\{\{sender\}\}/g, firstName(S.settings.senderName) || '');

function renderComposer() {
  const el = $('#rcomp'); if (!el) return;
  const l = S.leads.find((x) => x.id === ui.replyLead);
  if (!l) { el.innerHTML = '<div class="card empty"><b>Pick someone on the left</b>Paste their reply, or write a follow-up, and send it from here.</div>'; return; }
  const d = rdFor(l.id);
  if (!d.subject) d.subject = 'Re: ' + String(l.draft?.subject || 'following up').replace(/^re:\s*/i, '');
  const it = INTENT[d.intent];
  el.innerHTML = `<div class="card pad stack">
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><div><h3 style="margin:0">${esc(l.name)}</h3><div class="sub">${esc(l.email || 'no email')} · ${l.status === 'replied' ? 'replied' : 'emailed ' + ago(l.sentAt)}</div></div><span class="sp"></span>${statusPill(l)}<button class="btn s" data-act="rOpen">Open lead</button></div>
    <div><label>Their reply (paste it so the AI can answer it, or leave blank for a follow-up)</label><textarea id="rThem" style="min-height:90px" placeholder="Paste what they wrote…">${esc(d.their)}</textarea></div>
    <div class="acts"><button class="btn s p" data-act="rAI">${ico('spark')} Write with AI</button><span class="hint">${d.their.trim() ? 'Will answer their message' : 'Will write a follow-up'}</span></div>
    ${it ? `<div class="banner" style="background:var(--acc2);color:var(--acc);margin:0;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span><b>${it[0]}.</b> ${it[1] === 'replied' ? 'Mark as replied?' : it[1] === 'skip' ? 'Mark as skipped?' : 'Mark as unsubscribed so you never email them again?'}</span><button class="btn s" data-act="rMark" data-s="${it[1]}">Yes, mark it</button></div>` : ''}
    <div><label>Quick replies</label><div class="tpl">${S.templates.map((t) => `<button class="chip" data-act="rTpl" data-id="${esc(t.id)}">${esc(t.name)}</button>`).join('')}<button class="chip" data-act="tplEdit">${ico('edit')} Edit</button></div></div>
    <div><label>Subject</label><input id="rSub" value="${esc(d.subject)}"></div>
    <div><label>Message (plain text, sent exactly as written)</label><textarea id="rBody" style="min-height:190px">${esc(d.body)}</textarea></div>
    <div class="acts"><button class="btn s" data-act="rMark" data-s="replied">Mark replied</button><button class="btn s" data-act="rMark" data-s="skip">Not interested</button><span class="sp"></span><button class="btn p" data-act="rSend">${ico('send')} Send</button></div>
  </div>`;
  $('#rThem').oninput = () => { rdFor(l.id).their = $('#rThem').value; };
}

A.rOpen = () => { ui.cur = ui.replyLead; drawer(); };
A.rTpl = (t) => {
  syncR();
  const l = S.leads.find((x) => x.id === ui.replyLead), tpl = S.templates.find((x) => x.id === t.dataset.id);
  if (!l || !tpl) return;
  const d = rdFor(l.id);
  d.body = fillTpl(tpl.body, l); d.intent = '';
  renderComposer(); $('#rBody').focus();
};
A.rAI = (btn) => act(btn, async () => {
  syncR();
  const l = S.leads.find((x) => x.id === ui.replyLead), d = rdFor(l.id);
  const r = await api('reply-draft', { method: 'POST', body: { id: l.id, theirReply: d.their } });
  d.subject = r.reply.subject || d.subject; d.body = r.reply.body; d.intent = d.their.trim() ? r.reply.intent : '';
  renderComposer();
});
A.rMark = (btn) => act(btn, async () => {
  syncR();
  const l = S.leads.find((x) => x.id === ui.replyLead);
  const r = await api('leads/' + l.id, { method: 'PATCH', body: { status: btn.dataset.s } });
  setLead(r.lead); rdFor(l.id).intent = ''; chrome(); renderReplyList(); renderComposer(); toast('Marked ' + btn.dataset.s);
});
A.rSend = (btn) => act(btn, async () => {
  syncR();
  const l = S.leads.find((x) => x.id === ui.replyLead), d = rdFor(l.id);
  if (!d.subject.trim() || !d.body.trim()) throw new Error('Write a message first.');
  if (hasBlanks(d.body) && !confirm('Your message still has [bracketed] blanks to fill in. Send anyway?')) return;
  if (!confirm(`Send this to ${l.email}?`)) return;
  if (d.their.trim() && l.status === 'sent') { const p = await api('leads/' + l.id, { method: 'PATCH', body: { status: 'replied' } }); setLead(p.lead); }
  const r = await api('send', { method: 'POST', body: { id: l.id, followup: true, subject: d.subject, body: d.body } });
  S.sentToday++; setLead(r.lead);
  d.body = ''; d.their = ''; d.intent = '';
  chrome(); renderReplyList(); renderComposer(); toast('Sent');
});

/* ---------- template editor ---------- */
A.tplEdit = () => { syncR(); ui.tpl = S.templates.map((t) => ({ ...t })); tplModal(); };
function tplSync() { (ui.tpl || []).forEach((t, i) => { const n = $('#tn' + i), b = $('#tb' + i); if (n) t.name = n.value; if (b) t.body = b.value; }); }
function tplModal() {
  $('#ov').innerHTML = `<div class="scrim c" data-act="closeBg"><div class="card modal stack" style="width:min(640px,calc(100% - 24px))">
    <div class="dh"><div style="flex:1"><h2>Quick reply templates</h2><div class="hint">Use {{business}}, {{contact}} and {{sender}}. Anything in [brackets] is a blank you fill in before sending.</div></div><button class="x" data-act="closeOv">×</button></div>
    ${ui.tpl.map((t, i) => `<div class="card sec stack" style="margin:0"><div style="display:flex;gap:8px"><input id="tn${i}" value="${esc(t.name)}" placeholder="Template name"><button class="btn s d" data-act="tplDel" data-i="${i}">Delete</button></div><textarea id="tb${i}" style="min-height:120px">${esc(t.body)}</textarea></div>`).join('')}
    <div class="acts"><button class="btn s" data-act="tplAdd">+ New template</button><span class="sp"></span><button class="btn p" data-act="tplSave">Save templates</button></div></div></div>`;
}
A.tplAdd = () => { tplSync(); ui.tpl.push({ id: 't' + Date.now(), name: 'New template', body: 'Hi {{contact}},\n\n\n\n{{sender}}' }); tplModal(); };
A.tplDel = (t) => { tplSync(); ui.tpl.splice(+t.dataset.i, 1); tplModal(); };
A.tplSave = (btn) => act(btn, async () => {
  tplSync();
  const r = await api('templates', { method: 'PUT', body: { templates: ui.tpl } });
  S.templates = r.templates; closeOv(); renderComposer(); toast('Templates saved');
});
