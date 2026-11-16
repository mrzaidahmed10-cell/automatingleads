'use strict';
/* ---------- assistant chat ---------- */
const TOOL_LABEL = { get_overview: 'Checked your pipeline', search_leads: 'Searched leads', get_lead: 'Opened a lead', find_leads: 'Searched the map', audit_leads: 'Audited sites', find_contacts: 'Looked up contacts', verify_leads: 'Checked websites', log_call: 'Logged a call', call_prep: 'Prepared a call', update_lead: 'Updated a lead', add_lead: 'Added a lead', delete_lead: 'Deleted a lead' };
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

function renderMsgs() {
  const el = $('#msgs'); if (!el) return;
  if (!ui.chat.length) {
    const city = store.get('city', 'Iowa City, Iowa');
    const sugg = ['Who should I call first today?', `Find salons and barbershops near ${city} with no website`, 'Prep me for a call to my top starred lead', 'Review my pipeline and tell me what looks weak'];
    el.innerHTML = `<div class="msg a">Hey${firstName(S.settings.senderName) ? ' ' + esc(firstName(S.settings.senderName)) : ''}! I can help you work your call list: find leads, audit their sites, prep calls and log results.
      <div class="sugg">${sugg.map((s) => `<button data-act="chatSugg" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
    return;
  }
  el.innerHTML = ui.chat.map((m, i) => m.role === 'user' ? `<div class="msg u">${esc(m.content)}</div>` :
    `<div class="msg a" style="${m.error ? 'border-color:var(--bad)' : ''}">${md(m.content)}${m.actions?.length ? `<div class="acts2">${m.actions.map((a) => `<span class="pill ${a.ok ? '' : 'bad'}" title="${esc(a.note || '')}">${esc(TOOL_LABEL[a.tool] || a.tool)}${a.ok ? '' : ' (failed)'}</span>`).join('')}</div>` : ''}</div>`).join('') +
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
    ui.chat.push({ role: 'assistant', content: r.reply, actions: r.actions });
    if (r.mutated) { S = await api('state'); chrome(); }
  } catch (e) {
    ui.chat.push({ role: 'assistant', content: e.message, error: true });
  }
  ui.chatBusy = false; store.set('chat', ui.chat.slice(-40)); renderMsgs();
}
A.chatSend = () => chatSend();
A.chatSugg = (t) => chatSend(t.dataset.q);
A.chatClear = () => { ui.chat = []; store.set('chat', []); renderMsgs(); };
