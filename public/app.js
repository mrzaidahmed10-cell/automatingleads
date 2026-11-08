'use strict';
/* ---------- utils ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (a, b) => sleep((a + Math.random() * (b - a)) * 1000); // irregular gaps between sends look human
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e || '');
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const host = (u) => { try { return new URL(/^https?:/i.test(u) ? u : 'https://' + u).host.replace(/^www\./, ''); } catch { return u; } };
const href = (u) => (/^https?:/i.test(u) ? u : 'https://' + u);
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60); if (h < 24) return h + 'h ago';
  const d = Math.round(h / 24); return d + 'd ago';
};
const daysSince = (t) => (Date.now() - t) / 86400000;

const IC = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 010 6.8M18 14.8c2.1.6 3.4 2.3 3.8 5.2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 13A9 9 0 1111 3a7 7 0 0010 10z"/>',
  mapPin: '<path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  rows: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  out: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  reply: '<path d="M9 14L4 9l5-5"/><path d="M20 20v-7a4 4 0 00-4-4H4"/>',
};
const ico = (k) => `<svg class="i" viewBox="0 0 24 24">${IC[k] || ''}</svg>`;

/* ---------- state ---------- */
let S = { leads: [], settings: {}, templates: [], sentToday: 0, suppressed: 0, configured: {} };
const ui = { filter: 'all', query: '', cur: null, lastFind: null, finderOpen: null, replyFilter: 'replied', replyLead: null, chat: store.get('chat', []), pending: [], chatBusy: false };
const A = {}; // click actions
const C = {}; // change actions

/* ---------- api ---------- */
const HDR = { 'content-type': 'application/json', 'x-requested-by': 'flightline' };
function toast(m, ms = 3200) {
  const t = $('#toast');
  t.textContent = m; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), ms);
}
async function api(path, opt = {}) {
  let r;
  try {
    r = await fetch('/api/' + path, { method: opt.method || 'GET', headers: HDR, body: opt.body ? JSON.stringify(opt.body) : undefined, credentials: 'same-origin' });
  } catch { throw new Error('Network error. Check your connection.'); }
  if (r.status === 401) { showLogin(); throw new Error('Signed out'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || (r.status === 404 ? 'API not found: the Functions did not deploy.' : 'Server error ' + r.status));
  return j;
}
async function act(btn, fn) {
  const old = btn.innerHTML, w = btn.offsetWidth;
  btn.disabled = true; btn.style.minWidth = w + 'px'; btn.innerHTML = '<span class="spin"></span>';
  try { await fn(); } catch (e) { toast(e.message, 5200); } finally { btn.disabled = false; btn.innerHTML = old; btn.style.minWidth = ''; }
}
const setLead = (l) => { const i = S.leads.findIndex((x) => x.id === l.id); if (i >= 0) S.leads[i] = l; else S.leads.unshift(l); };
async function refresh() { S = await api('state'); refreshUI(); }

/* ---------- auth ---------- */
function showLogin() { $('#app').classList.add('hide'); $('#login').classList.remove('hide'); $('#ov').innerHTML = ''; S = { leads: [], settings: {}, templates: [], sentToday: 0, suppressed: 0, configured: {} }; setTimeout(() => $('#pw').focus(), 30); }
$('#lf').onsubmit = async (e) => {
  e.preventDefault(); $('#le').textContent = '';
  let r; try { r = await fetch('/api/login', { method: 'POST', headers: HDR, credentials: 'same-origin', body: JSON.stringify({ password: $('#pw').value }) }); } catch { $('#le').textContent = 'Network error.'; return; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { $('#le').textContent = j.error || 'Login failed'; return; }
  $('#pw').value = ''; boot();
};
$('#bOut').onclick = async () => { try { await fetch('/api/logout', { method: 'POST', headers: HDR, credentials: 'same-origin' }); } catch {} showLogin(); };

/* ---------- theme + density ---------- */
function themeIcon() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#bThemeM').innerHTML = dark ? ico('sun') : ico('moon');
  $('#bThemeM').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  const comfy = document.documentElement.dataset.density === 'comfy';
  $('#bDens').innerHTML = ico('rows') + '<span class="hm">' + (comfy ? 'Comfy' : 'Compact') + '</span>';
  $('#bDens').setAttribute('aria-label', comfy ? 'Density: comfy. Switch to compact' : 'Density: compact. Switch to comfy');
  $('#bPal').innerHTML = ico('search') + '<span class="hm">Jump <kbd>Ctrl K</kbd></span>';
  $('#bOut').querySelector('.bi').innerHTML = ico('out');
}
function toggleTheme() {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t; try { localStorage.setItem('theme', t); } catch {}
  themeIcon();
}
A.density = () => {
  const d = document.documentElement.dataset.density === 'comfy' ? 'compact' : 'comfy';
  document.documentElement.dataset.density = d; try { localStorage.setItem('density', d); } catch {}
  themeIcon();
};
$('#bThemeM').onclick = toggleTheme;

/* ---------- routing ---------- */
const ROUTES = {
  dashboard: ['Dashboard', () => vDash(), 'home'],
  leads: ['Leads', () => vLeads(), 'users'],
  replies: ['Quick replies', () => vReplies(), 'mail'],
  analytics: ['Analytics', () => vAnalytics(), 'chart'],
  assistant: ['Assistant', () => vAssistant(), 'spark'],
  settings: ['Settings', () => vSettings(), 'gear'],
};
const page = () => { const k = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0]; return ROUTES[k] ? k : 'dashboard'; };
function route() {
  const k = page();
  $('#title').textContent = ROUTES[k][0]; document.title = ROUTES[k][0] + ' · FlightLine';
  $('#view').innerHTML = '';
  ROUTES[k][1]();
  chrome(); window.scrollTo(0, 0);
  if (route.n++) $('#view').focus({ preventScroll: true });
}
route.n = 0;
window.addEventListener('hashchange', route);
function go(to, extra) { if (extra) Object.assign(ui, extra); if (location.hash === '#/' + to) route(); else location.hash = '#/' + to; }
function chrome() {
  const k = page(), L = S.leads;
  const badge = { replies: L.filter((l) => l.status === 'replied').length };
  const items = Object.entries(ROUTES).map(([key, [label, , ic]]) =>
    `<a href="#/${key}" class="${k === key ? 'on' : ''}" ${k === key ? 'aria-current="page"' : ''}>${ico(ic)}<span class="t">${label.replace('Quick replies', 'Replies')}</span>${badge[key] ? `<span class="badge">${badge[key]}</span>` : ''}</a>`).join('');
  $('#nav').innerHTML = items;
  $('#tabbar').innerHTML = Object.entries(ROUTES).map(([key, [label, , ic]]) => `<a href="#/${key}" class="${k === key ? 'on' : ''}" ${k === key ? 'aria-current="page"' : ''}>${ico(ic)}${label.replace('Quick replies', 'Replies')}${badge[key] ? `<span class="badge">${badge[key]}</span>` : ''}</a>`).join('');
  const lim = Number(S.settings.dailyLimit || 20);
  $('#qTxt').textContent = `${S.sentToday} / ${lim} sent today`;
  $('#qBar').style.width = Math.min(100, (S.sentToday / lim) * 100) + '%';
  $('#topHint').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  themeIcon();
}
function refreshUI() {
  chrome();
  const k = page();
  if (k === 'dashboard') vDash(); else if (k === 'analytics') vAnalytics();
  else if (k === 'leads') renderLeadsTable(); else if (k === 'replies') renderReplyList();
}
async function boot() {
  try { S = await api('state'); } catch (e) {
    if (e.message !== 'Signed out') { showLogin(); $('#le').textContent = e.message; }
    return;
  }
  $('#login').classList.add('hide'); $('#app').classList.remove('hide');
  route();
}
window.addEventListener('load', boot);

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (t && A[t.dataset.act]) A[t.dataset.act](t, e);
});
document.addEventListener('change', (e) => {
  const t = e.target.closest('[data-change]');
  if (t && C[t.dataset.change]) C[t.dataset.change](t, e);
});
A.go = (t) => go(t.dataset.to, t.dataset.filter ? { filter: t.dataset.filter } : t.dataset.rf ? { replyFilter: t.dataset.rf } : null);

/* ---------- charts (inline SVG, no libraries) ---------- */
function legendHtml(series) { return `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`; }
function lineChart(labels, series, h = 230) {
  const W = 680, pl = 34, pr = 10, pt = 12, pb = 26;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const m = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const x = (i) => pl + (labels.length < 2 ? 0 : (i * (W - pl - pr)) / (labels.length - 1));
  const y = (v) => pt + (h - pt - pb) * (1 - v / m);
  let g = '';
  for (let t = 0; t <= 4; t++) { const v = (m * t) / 4; g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line)"/><text x="${pl - 7}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`; }
  const step = Math.ceil(labels.length / 7);
  labels.forEach((l, i) => { if (i % step === 0 || i === labels.length - 1) g += `<text x="${x(i)}" y="${h - 6}" text-anchor="middle">${esc(l)}</text>`; });
  series.forEach((s) => {
    const pts = s.values.map((v, i) => `${x(i)},${y(v)}`);
    g += `<path d="M${x(0)},${y(0)} L${pts.join(' L')} L${x(s.values.length - 1)},${y(0)}Z" style="fill:${s.color};opacity:.08"/>`;
    g += `<polyline points="${pts.join(' ')}" style="fill:none;stroke:${s.color};stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round"/>`;
    s.values.forEach((v, i) => { if (v > 0) g += `<circle cx="${x(i)}" cy="${y(v)}" r="3.4" style="fill:${s.color}"><title>${esc(s.name)}: ${v} (${esc(labels[i])})</title></circle>`; });
  });
  const sum = series.map((x) => `${x.name} total ${x.values.reduce((a, b) => a + b, 0)}`).join(', ');
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="Line chart over ${labels.length} days. ${esc(sum)}">${g}</svg>` + legendHtml(series);
}
function barChart(labels, values, color = 'var(--c1)', h = 190) {
  const W = 680, pl = 30, pr = 6, pt = 10, pb = 24;
  const max = Math.max(1, ...values), m = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const bw = (W - pl - pr) / labels.length, y = (v) => pt + (h - pt - pb) * (1 - v / m);
  let g = '';
  for (let t = 0; t <= 4; t++) { const v = (m * t) / 4; g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line)"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`; }
  const step = Math.ceil(labels.length / 8);
  values.forEach((v, i) => {
    const x = pl + i * bw + bw * 0.18, w = bw * 0.64;
    g += `<rect x="${x}" y="${y(v)}" width="${w}" height="${Math.max(0, y(0) - y(v))}" rx="4" style="fill:${color}"><title>${v} on ${esc(labels[i])}</title></rect>`;
    if (i % step === 0) g += `<text x="${x + w / 2}" y="${h - 6}" text-anchor="middle">${esc(labels[i])}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="Bar chart, ${values.reduce((a, b) => a + b, 0)} total over ${labels.length} days">${g}</svg>`;
}
function donut(data) {
  const total = data.reduce((a, d) => a + d.value, 0);
  if (!total) return '<div class="hint" style="margin-top:10px">Nothing to show yet.</div>';
  const r = 54, C2 = 2 * Math.PI * r; let off = 0, arcs = '';
  data.filter((d) => d.value > 0).forEach((d) => {
    const len = (d.value / total) * C2;
    arcs += `<circle cx="70" cy="70" r="${r}" fill="none" stroke-width="22" style="stroke:${d.color}" stroke-dasharray="${len} ${C2 - len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"><title>${esc(d.label)}: ${d.value}</title></circle>`;
    off += len;
  });
  return `<div class="donutwrap"><svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Breakdown: ${esc(data.map((d) => d.label + ' ' + d.value).join(', '))}">${arcs}<text x="70" y="68" text-anchor="middle" style="fill:var(--ink);font-size:22px;font-weight:800">${total}</text><text x="70" y="86" text-anchor="middle" style="fill:var(--mut);font-size:11px">leads</text></svg>` +
    `<ul>${data.map((d) => `<li><i style="background:${d.color}"></i>${esc(d.label)} <b>${d.value}</b></li>`).join('')}</ul></div>`;
}
function hbars(data) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return `<div class="hb">${data.map((d) => `<div><span>${esc(d.label)}</span><div class="bar"><i style="width:${Math.max(2, (d.value / max) * 100)}%"></i></div><em>${d.value}</em></div>`).join('')}</div>`;
}

/* ---------- derived data ---------- */
const contacted = (l) => ['sent', 'replied'].includes(l.status);
function activity(n) {
  const days = []; const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) { const x = new Date(d0); x.setDate(d0.getDate() - i); days.push(+x); }
  const idx = new Map(days.map((d, i) => [d, i]));
  const mk = () => Array(n).fill(0);
  const found = mk(), sent = mk(), replied = mk();
  const bump = (arr, t) => { const x = new Date(t); x.setHours(0, 0, 0, 0); const i = idx.get(+x); if (i != null) arr[i]++; };
  for (const l of S.leads) {
    bump(found, l.createdAt);
    if (l.sentAt) bump(sent, l.sentAt);
    (l.followups || []).forEach((f) => bump(sent, f.t));
    if (l.repliedAt) bump(replied, l.repliedAt);
  }
  return { labels: days.map((d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })), found, sent, replied };
}
const dueFollowup = (l) => l.status === 'sent' && l.sentAt && daysSince(l.sentAt) >= 3 && !(l.followups || []).length;

/* ---------- dashboard ---------- */
function vDash() {
  const L = S.leads, s = S.settings, name = firstName(s.senderName);
  const n = (f) => L.filter(f).length;
  const withEmail = n((l) => validEmail(l.email)), cont = n(contacted), rep = n((l) => l.status === 'replied');
  const hr = new Date().getHours(), greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const lim = Number(s.settings?.dailyLimit || s.dailyLimit || 20);
  const setup = [
    ['Add your name', !!s.senderName, 'settings'],
    ['Connect email sending', !!S.configured.email, 'settings'],
    ['Connect the AI writer (Groq)', !!S.configured.groq, 'settings'],
    ['Find your first leads', L.length > 0, 'leads'],
  ];
  const todos = [];
  if (!L.length) todos.push({ n: '+', t: 'Find your first leads', d: 'Search a city for businesses with no website', to: 'leads' });
  const needEmail = L.filter((l) => !validEmail(l.email) && !['unsub', 'skip'].includes(l.status));
  const unaud = needEmail.filter((l) => l.website && !l.audit).length;
  if (rep) todos.push({ n: rep, t: `${rep} ${rep === 1 ? 'reply' : 'replies'} waiting`, d: 'Respond while they are warm', to: 'replies', rf: 'replied' });
  const ready = n((l) => l.status === 'drafted' && validEmail(l.email));
  if (ready) todos.push({ n: ready, t: 'Drafts ready to send', d: 'Review and send', to: 'leads', filter: 'drafted' });
  const toDraft = n((l) => l.status === 'new' && validEmail(l.email));
  if (toDraft) todos.push({ n: toDraft, t: 'Leads ready for a draft', d: 'Have AI write the openers', to: 'leads', filter: 'email' });
  const due = n(dueFollowup);
  if (due) todos.push({ n: due, t: 'Follow-ups due', d: 'Sent 3+ days ago, no reply', to: 'replies', rf: 'due' });
  if (unaud) todos.push({ n: unaud, t: 'Sites to audit', d: 'Auditing also finds contact emails', to: 'leads', filter: 'noemail' });
  const noEm = needEmail.length - unaud;
  if (noEm > 0 && L.length) todos.push({ n: noEm, t: 'Leads need an email', d: 'Add one by hand or skip them', to: 'leads', filter: 'noemail' });

  const act14 = activity(14);
  const funnel = [
    { label: 'Leads found', value: L.length },
    { label: 'Have an email', value: withEmail },
    { label: 'Written to', value: n((l) => l.draft || contacted(l)) },
    { label: 'Emailed', value: cont },
    { label: 'Replied', value: rep },
  ];
  const ev = [];
  L.forEach((l) => {
    if (l.sentAt) ev.push({ t: l.sentAt, k: 'send', x: `Emailed <b>${esc(l.name)}</b>` });
    (l.followups || []).forEach((f) => ev.push({ t: f.t, k: 'send', x: `Followed up with <b>${esc(l.name)}</b>` }));
    if (l.repliedAt) ev.push({ t: l.repliedAt, k: 'reply', x: `<b>${esc(l.name)}</b> replied` });
  });
  ev.sort((a, b) => b.t - a.t);

  $('#view').innerHTML = `
    <h2 class="hello">${greet}${name ? ', ' + esc(name) : ''}</h2>
    ${S.security?.weakPassword ? `<div class="banner" role="alert"><b>Weak password.</b> Your dashboard password is under 12 characters. Set a longer one (DASH_PASSWORD in Cloudflare) so nobody can guess it.</div>` : ''}
    <p class="hint" style="margin:0 0 14px">${L.length ? 'Here is where your outreach stands.' : 'Let us get your first leads in.'}</p>
    ${setup.some((x) => !x[1]) ? `<div class="card pad" style="margin-bottom:16px"><h3>Get set up</h3><div class="hint" style="margin-bottom:6px">A few quick steps before your first send.</div>${setup.map(([t, d, to]) => `<div class="check ${d ? 'done' : ''}"><span class="dot">${d ? ico('check') : ''}</span><span>${t}</span>${d ? '' : `<a class="btn s" style="margin-left:auto" href="#/${to}">Open</a>`}</div>`).join('')}</div>` : ''}
    <div class="grid g5" style="margin-bottom:16px">
      <div class="card kpi"><div class="ic">${ico('users')}</div><b>${L.length}</b><span>Leads</span><small>${withEmail} with email</small></div>
      <div class="card kpi"><div class="ic">${ico('send')}</div><b>${cont}</b><span>Emailed</span><small>${S.sentToday} / ${lim} today</small></div>
      <div class="card kpi"><div class="ic">${ico('reply')}</div><b>${rep}</b><span>Replies</span><small>${cont ? Math.round((rep / cont) * 100) + '% reply rate' : 'no sends yet'}</small></div>
      <div class="card kpi"><div class="ic">${ico('edit')}</div><b>${n((l) => l.status === 'drafted')}</b><span>Drafts waiting</span><small>${due} follow-ups due</small></div>
      <div class="card kpi"><div class="ic">${ico('mail')}</div><b>${S.suppressed}</b><span>Do not contact</span><small>never emailed again</small></div>
    </div>
    ${todos.length ? `<div class="grid g2" style="margin-bottom:16px">${todos.slice(0, 4).map((t) => `<button class="todo" data-act="go" data-to="${t.to}" ${t.filter ? `data-filter="${t.filter}"` : ''} ${t.rf ? `data-rf="${t.rf}"` : ''}><div class="n">${esc(t.n)}</div><div><b>${esc(t.t)}</b><span>${esc(t.d)}</span></div></button>`).join('')}</div>` : ''}
    <div class="grid g2" style="margin-bottom:16px">
      <div class="card pad"><h3>Last 14 days</h3>${lineChart(act14.labels, [{ name: 'Leads found', color: 'var(--c1)', values: act14.found }, { name: 'Emails sent', color: 'var(--c2)', values: act14.sent }, { name: 'Replies', color: 'var(--c4)', values: act14.replied }], 220)}</div>
      <div class="card pad"><h3>Pipeline</h3><div class="hint">How leads move toward a reply</div>${hbars(funnel)}</div>
    </div>
    <div class="card pad"><h3>Recent activity</h3>${ev.length ? `<div class="feed">${ev.slice(0, 7).map((e) => `<div><span class="dt">${ico(e.k === 'reply' ? 'reply' : 'send')}</span><span>${e.x}</span><time>${ago(e.t)}</time></div>`).join('')}</div>` : '<div class="hint" style="padding:10px 0">Nothing sent yet. Your emails and replies will show up here.</div>'}</div>`;
}

/* ---------- analytics ---------- */
function vAnalytics() {
  const L = S.leads, act = activity(30);
  const cont = L.filter(contacted), rep = L.filter((l) => l.status === 'replied');
  const rate = cont.length ? Math.round((rep.length / cont.length) * 100) : 0;
  const withReplyTimes = L.filter((l) => l.sentAt && l.repliedAt);
  const avgReply = withReplyTimes.length ? (withReplyTimes.reduce((a, l) => a + (l.repliedAt - l.sentAt), 0) / withReplyTimes.length / 86400000).toFixed(1) : null;
  const group = (l) => (!l.website ? 'No website' : !l.audit ? 'Not audited' : l.audit.score >= 50 ? 'Poor site' : l.audit.score >= 25 ? 'Dated site' : 'Decent site');
  const groups = ['No website', 'Poor site', 'Dated site', 'Decent site', 'Not audited'];
  const gData = groups.map((g) => { const ls = L.filter((l) => group(l) === g), c = ls.filter(contacted), r = ls.filter((l) => l.status === 'replied'); return { g, n: ls.length, c: c.length, r: r.length, rate: c.length ? Math.round((r.length / c.length) * 100) : null }; });
  const best = gData.filter((x) => x.c >= 3 && x.rate != null).sort((a, b) => b.rate - a.rate)[0];
  const cats = {};
  L.forEach((l) => { const k = l.category || 'other'; (cats[k] ||= { n: 0, c: 0, r: 0 }).n++; if (contacted(l)) cats[k].c++; if (l.status === 'replied') cats[k].r++; });
  const catRows = Object.entries(cats).sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  const colors = { 'No website': 'var(--c4)', 'Poor site': 'var(--c3)', 'Dated site': 'var(--c1)', 'Decent site': 'var(--c2)', 'Not audited': 'var(--line)' };
  const sentTotal = act.sent.reduce((a, b) => a + b, 0);

  $('#view').innerHTML = `
    <div class="grid g5" style="margin-bottom:16px">
      <div class="card kpi"><b>${L.length}</b><span>Total leads</span></div>
      <div class="card kpi"><b>${cont.length}</b><span>Emailed</span></div>
      <div class="card kpi"><b>${rep.length}</b><span>Replies</span></div>
      <div class="card kpi"><b>${rate}%</b><span>Reply rate</span></div>
      <div class="card kpi"><b>${avgReply ?? '–'}</b><span>Avg days to reply</span></div>
    </div>
    ${best ? `<div class="banner" style="background:var(--acc2);color:var(--acc)"><b>Insight:</b> ${esc(best.g)} leads reply the most so far (${best.rate}% of ${best.c} emailed). Consider targeting more of them.</div>` : ''}
    <div class="grid g2" style="margin-bottom:16px">
      <div class="card pad"><h3>Emails sent per day</h3><div class="hint">Last 30 days · ${sentTotal} total</div>${barChart(act.labels, act.sent)}</div>
      <div class="card pad"><h3>Leads found vs replies</h3>${lineChart(act.labels, [{ name: 'Leads found', color: 'var(--c1)', values: act.found }, { name: 'Replies', color: 'var(--c4)', values: act.replied }], 190)}</div>
    </div>
    <div class="grid g2" style="margin-bottom:16px">
      <div class="card pad"><h3>Lead quality</h3><div class="hint">How weak each lead's web presence is</div>${donut(gData.map((x) => ({ label: x.g, value: x.n, color: colors[x.g] })))}</div>
      <div class="card"><div class="pad" style="padding-bottom:6px"><h3>Which leads reply?</h3><div class="hint">Needs a few sends per group to mean much</div></div><div class="tw"><table><thead><tr><th>Group</th><th>Leads</th><th>Emailed</th><th>Replied</th><th>Rate</th></tr></thead><tbody>${gData.map((x) => `<tr><td>${x.g}</td><td>${x.n}</td><td>${x.c}</td><td>${x.r}</td><td>${x.rate == null ? '–' : x.rate + '%'}</td></tr>`).join('')}</tbody></table></div></div>
    </div>
    <div class="card"><div class="pad" style="padding-bottom:6px"><h3>By category</h3></div><div class="tw"><table><thead><tr><th>Category</th><th>Leads</th><th>Emailed</th><th>Replied</th><th>Rate</th></tr></thead><tbody>${catRows.length ? catRows.map(([k, v]) => `<tr><td style="text-transform:capitalize">${esc(k)}</td><td>${v.n}</td><td>${v.c}</td><td>${v.r}</td><td>${v.c ? Math.round((v.r / v.c) * 100) + '%' : '–'}</td></tr>`).join('') : '<tr><td colspan="5" class="hint">No leads yet.</td></tr>'}</tbody></table></div></div>`;
}

/* ---------- settings ---------- */
function vSettings() {
  const s = S.settings, cf = S.configured;
  const field = (id, label, val, ph = '', type = 'text') => `<div><label>${label}</label><input id="${id}" type="${type}" value="${esc(val)}" placeholder="${esc(ph)}"></div>`;
  $('#view').innerHTML = `
    <div class="grid g2" style="align-items:start">
      <div class="stack">
        <div class="card pad stack"><h3>You</h3><div class="hint">Your name is the sender name. Emails go out as plain text, exactly as you write them, with nothing added.</div>
          ${field('sName', 'Your name', s.senderName, 'Zaid Ahmed')}
          ${field('sAgency', 'Agency name', s.businessName, 'FlightLine')}
          <div class="grid g2">${field('sReply', 'Your email (reply-to and test sends)', s.replyTo, 'your Gmail address', 'email')}${field('sLim', 'Max sends per day', s.dailyLimit, '', 'number')}</div>
        </div>
        <div class="card pad stack"><h3>AI voice</h3><div class="hint">The writer uses these to sound like you and stay accurate.</div>
          <div><label>Tone</label><select id="sTone">${[['friendly', 'Friendly (default)'], ['casual', 'Casual and short'], ['direct', 'Direct'], ['professional', 'Professional']].map(([v, t]) => `<option value="${v}" ${s.tone === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div><label>Your offer (one or two sentences)</label><textarea id="sOffer" style="min-height:80px">${esc(s.offer)}</textarea></div>
          <div><label>About you (optional, e.g. "local developer based in Iowa City")</label><input id="sAbout" value="${esc(s.about)}"></div>
          <div><label>Notes for replies and chat (pricing, process, turnaround)</label><textarea id="sKnow" style="min-height:90px" placeholder="e.g. Sites start at $X, usually live in 1 week, I do hosting for $Y/mo">${esc(s.knowledge)}</textarea></div>
          ${field('sPort', 'Portfolio link (optional)', s.portfolioUrl)}
        </div>
        <button class="btn p" data-act="saveSettings" style="justify-content:center">Save settings</button>
      </div>
      <div class="stack">
        <div class="card pad"><h3>Connections</h3>
          <div class="check ${cf.email ? 'done' : ''}"><span class="dot">${cf.email ? ico('check') : ''}</span><span>Email sending ${cf.email ? '' : '(missing secrets, see README)'}</span></div>
          <div class="check ${cf.groq ? 'done' : ''}"><span class="dot">${cf.groq ? ico('check') : ''}</span><span>AI writer ${cf.groq ? '' : '(add GROQ_API_KEY)'}</span></div>
          <div class="check done"><span class="dot">${ico('check')}</span><span>Lead finder (OpenStreetMap, no key needed)</span></div>
          <div class="acts" style="margin-top:10px"><button class="btn s" data-act="testAI">${ico('spark')} Test AI</button></div>
          <div id="aiTest" class="hint" style="margin-top:8px"></div>
          <div class="hint" style="margin-top:10px">API keys live in Cloudflare secrets and never reach this page.</div>
        </div>
        <div class="card pad"><h3>${ico('shield')} Security</h3>
          <div class="check ${S.security?.weakPassword ? '' : 'done'}"><span class="dot">${S.security?.weakPassword ? '' : ico('check')}</span><span>${S.security?.weakPassword ? 'Password is short. Use 12+ characters.' : 'Strong password'}</span></div>
          <div class="check done"><span class="dot">${ico('check')}</span><span>Sign-in locks after repeated wrong passwords</span></div>
          <div class="check done"><span class="dot">${ico('check')}</span><span>Sessions expire after 7 days</span></div>
          <div class="acts" style="margin-top:10px"><button class="btn s" data-act="signOut">Sign out</button><button class="btn s d" data-act="logoutAll">Sign out of all devices</button></div>
        </div>
        <div class="card pad"><h3>Tips for better replies</h3>
          <ul class="hint" style="margin:8px 0 0;padding-left:18px;line-height:1.7"><li>Send a test to yourself first and check spam.</li><li>Keep the daily limit at 10-20 while your sending address is new.</li><li>Fill in your notes above so reply drafts quote real prices and timelines.</li><li>Follow up once after 3-4 days; two emails is plenty.</li></ul>
        </div>
      </div>
    </div>`;
}
A.testAI = (btn) => act(btn, async () => {
  const el = $('#aiTest'); el.textContent = 'Testing…';
  const r = await api('ai-test');
  const models = (r.models || []).filter((m) => !/whisper|guard|tts|playai|orpheus|safeguard|compound/i.test(m));
  el.innerHTML = r.ok
    ? `<span style="color:var(--ok)"><b>AI works.</b></span> Using <b>${esc(r.model)}</b>. Tool use (assistant actions): ${r.tools ? '<b style="color:var(--ok)">works</b>' : '<b style="color:var(--bad)">not working</b>' + (r.toolsError ? ' (' + esc(r.toolsError) + ')' : '')}.<br>Models your key can use: ${esc(models.join(', ') || 'unknown')}`
    : `<span style="color:var(--bad)"><b>AI failed:</b> ${esc(r.error || 'unknown error')}</span>${models.length ? '<br>Models your key can use: ' + esc(models.join(', ')) : ''}`;
});
A.saveSettings = (btn) => act(btn, async () => {
  const r = await api('settings', { method: 'PUT', body: { senderName: $('#sName').value, replyTo: $('#sReply').value, dailyLimit: $('#sLim').value, tone: $('#sTone').value, offer: $('#sOffer').value, about: $('#sAbout').value, knowledge: $('#sKnow').value, portfolioUrl: $('#sPort').value, businessName: $('#sAgency').value } });
  S.settings = r.settings; chrome(); toast('Settings saved');
});

A.logoutAll = (btn) => act(btn, async () => { await api('logout-all', { method: 'POST', body: {} }); showLogin(); });
A.signOut = () => $('#bOut').click();
