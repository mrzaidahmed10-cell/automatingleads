'use strict';
/* ---------- assistant chat ---------- */
const TOOL_LABEL = { get_overview: 'Checked your pipeline', search_leads: 'Searched leads', get_lead: 'Opened a lead', find_leads: 'Searched the map', audit_leads: 'Audited sites', draft_email: 'Wrote a draft', update_lead: 'Updated a lead', add_lead: 'Added a lead', delete_lead: 'Deleted a lead', queue_send: 'Queued an email' };
const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^[-*] /gm, '• ');

/* The assistant lives in a slide-over panel, so it is one tap away from any page and never replaces what you are looking at. */
let asstBuilt = false;
function buildAssistant() {
  if (asstBuilt) return;
  asstBuilt = true;
  $('#asst').innerHTML = `
    <div class="ah"><b>${ico('spark')} Assistant</b><span class="sp"></span><button class="btn s g" data-act="chatClear">New chat</button><button class="btn s g" data-act="assistClose" aria-label="Close assistant">${ico('x') || '✕'}</button></div>
    <div class="msgs" id="msgs" aria-live="polite"></div>
    <div class="compose"><textarea id="cIn" aria-label="Message the assistant" rows="1" placeholder="Ask, or tell it what to do…"></textarea><button class="btn p" data-act="chatSend" aria-label="Send">${ico('send')}</button></div>`;
  const ta = $('#cIn');
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatSend(); } });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; });
  renderMsgs();
}
function openAssist(open) {
  const p = $('#asst'); if (!p) return;
  const on = open === undefined ? !p.classList.contains('on') : !!open;
  if (on) buildAssistant();
  p.classList.toggle('on', on);
  p.setAttribute('aria-hidden', String(!on));
  if (on) p.removeAttribute('inert'); else p.setAttribute('inert', '');
  const f = $('#bAsst'); if (f) { f.setAttribute('aria-expanded', String(on)); f.classList.toggle('p', on); }
  if (on) setTimeout(() => $('#cIn') && $('#cIn').focus({ preventScroll: true }), 60);
  else if (f && document.activeElement && p.contains(document.activeElement)) f.focus({ preventScroll: true });
}
A.assist = () => openAssist();
A.assistClose = () => openAssist(false);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#asst') && $('#asst').classList.contains('on') && !$('#ov').innerHTML.trim()) openAssist(false);
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j' && !$('#app').classList.contains('hide')) { e.preventDefault(); openAssist(); }
});
document.addEventListener('DOMContentLoaded', () => { const f = $('#bAsst'); if (f) f.innerHTML = ico('spark') + '<span class="hm">Assistant</span>'; });
if (document.readyState !== 'loading') { const f = $('#bAsst'); if (f) f.innerHTML = ico('spark') + '<span class="hm">Assistant</span>'; }

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
