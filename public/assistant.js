'use strict';
/* ---------- assistant chat ---------- */
const TOOL_LABEL = { get_overview: 'Checked your pipeline', search_leads: 'Searched leads', get_lead: 'Opened a lead', find_leads: 'Searched the map', audit_leads: 'Audited sites', draft_email: 'Wrote a draft', update_lead: 'Updated a lead', add_lead: 'Added a lead', delete_lead: 'Deleted a lead', queue_send: 'Queued an email' };
const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^[-*] /gm, '• ');

function vAssistant() {
  $('#view').innerHTML = `<div class="card chatwrap">
    <div class="tools"><b>Assistant</b><span class="hint hm">Ask anything. It can find leads, audit sites, write drafts and queue emails for your approval.</span><span class="sp"></span><button class="btn s" data-act="chatClear">New chat</button></div>
    <div class="msgs" id="msgs"></div>
    <div class="compose"><textarea id="cIn" rows="1" placeholder="Message the assistant…"></textarea><button class="btn p" data-act="chatSend">${ico('send')}</button></div>
  </div>`;
  const ta = $('#cIn');
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatSend(); } });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; });
  renderMsgs();
}

function pendHtml(m, mi) {
  const ps = (m.pending || []);
  if (!ps.length) return '';
  const live = ps.filter((p) => p.state === 'new').length;
  return ps.map((p, pi) => `<div class="pend"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>${esc(p.name)}</b><span class="sub">${esc(p.to)}</span><span class="sp"></span>${
    p.state === 'sent' ? '<span class="pill ok">Sent</span>' : p.state === 'dismissed' ? '<span class="pill">Dismissed</span>' :
    `<button class="btn s p" data-act="pApprove" data-m="${mi}" data-p="${pi}">${ico('send')} Approve & send</button><button class="btn s" data-act="pDismiss" data-m="${mi}" data-p="${pi}">Dismiss</button>`}</div>
    <div class="sub" style="margin-top:6px"><b>${esc(p.subject)}</b></div><pre>${esc(p.body)}</pre></div>`).join('') +
    (live > 1 ? `<div style="margin-top:8px"><button class="btn s p" data-act="pApproveAll" data-m="${mi}">Approve all ${live}</button></div>` : '');
}

function renderMsgs() {
  const el = $('#msgs'); if (!el) return;
  if (!ui.chat.length) {
    const city = store.get('city', 'Iowa City, Iowa');
    const sugg = ['What should I do next to get more replies?', `Find salons and barbershops near ${city} with no website`, 'Write openers for every lead that has an email', 'Review my pipeline and tell me what looks weak'];
    el.innerHTML = `<div class="msg a">Hey${firstName(S.settings.senderName) ? ' ' + esc(firstName(S.settings.senderName)) : ''}! I can run your outreach with you: find leads, audit their sites, write personalized openers, and line up emails for you to approve. I can also just talk strategy or help with anything else. What do you want to do?</div>
      <div class="sugg">${sugg.map((s) => `<button data-act="chatSugg" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
    return;
  }
  el.innerHTML = ui.chat.map((m, i) => m.role === 'user' ? `<div class="msg u">${esc(m.content)}</div>` :
    `<div class="msg a" style="${m.error ? 'border-color:var(--bad)' : ''}">${md(m.content)}${m.actions?.length ? `<div class="acts2">${m.actions.map((a) => `<span class="pill ${a.ok ? '' : 'bad'}" title="${esc(a.note || '')}">${esc(TOOL_LABEL[a.tool] || a.tool)}${a.ok ? '' : ' (failed)'}</span>`).join('')}</div>` : ''}${pendHtml(m, i)}</div>`).join('') +
    (ui.chatBusy ? '<div class="msg a"><span class="dots"><i></i><i></i><i></i></span></div>' : '');
  el.scrollTop = el.scrollHeight;
}

async function chatSend(text) {
  const ta = $('#cIn');
  text = (text ?? ta?.value ?? '').trim();
  if (ui.chatBusy || !text) return;
  if (ta) { ta.value = ''; ta.style.height = 'auto'; }
  ui.chat.push({ role: 'user', content: text });
  ui.chatBusy = true; renderMsgs();
  try {
    const r = await api('chat', { method: 'POST', body: { messages: ui.chat.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })) } });
    ui.chat.push({ role: 'assistant', content: r.reply, actions: r.actions, pending: (r.pending || []).map((p) => ({ ...p, state: 'new' })) });
    if (r.mutated) { S = await api('state'); chrome(); }
  } catch (e) {
    ui.chat.push({ role: 'assistant', content: e.message, error: true });
  }
  ui.chatBusy = false; store.set('chat', ui.chat.slice(-40)); renderMsgs();
}
A.chatSend = () => chatSend();
A.chatSugg = (t) => chatSend(t.dataset.q);
A.chatClear = () => { ui.chat = []; store.set('chat', []); renderMsgs(); };

async function approve(mi, pi) {
  const p = ui.chat[mi].pending[pi];
  if (hasBlanks(p.body) && !confirm(`The email to ${p.name} still has [bracketed] blanks. Send anyway?`)) return false;
  const r = await api('send', { method: 'POST', body: { id: p.id, subject: p.subject, body: p.body } });
  setLead(r.lead); S.sentToday++; p.state = 'sent'; return true;
}
A.pApprove = (btn) => act(btn, async () => {
  if (await approve(+btn.dataset.m, +btn.dataset.p)) { store.set('chat', ui.chat.slice(-40)); chrome(); renderMsgs(); toast('Sent'); }
});
A.pDismiss = (btn) => { ui.chat[+btn.dataset.m].pending[+btn.dataset.p].state = 'dismissed'; store.set('chat', ui.chat.slice(-40)); renderMsgs(); };
A.pApproveAll = (btn) => act(btn, async () => {
  const mi = +btn.dataset.m; let n = 0;
  for (let pi = 0; pi < ui.chat[mi].pending.length; pi++) {
    if (ui.chat[mi].pending[pi].state !== 'new') continue;
    try { if (await approve(mi, pi)) n++; } catch (e) { toast(e.message, 5200); break; }
    await jitter(15, 40);
  }
  store.set('chat', ui.chat.slice(-40)); chrome(); renderMsgs(); if (n) toast(`Sent ${n}`);
});
