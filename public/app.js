'use strict';
/* ---------- utils ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (a, b) => sleep((a + Math.random() * (b - a)) * 1000); // irregular gaps between sends look human
const cleanEmail = (s) => { s = String(s || '').trim(); const m = s.match(/<([^>]+)>/); if (m) s = m[1]; return s.replace(/^mailto:/i, '').replace(/\s+/g, '').replace(/[,;:.)\]]+$/, '').toLowerCase(); };
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
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  rows: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  out: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
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
function toastAct(m, label, fn, ms = 10000) {
  const t = $('#toast');
  t.textContent = '';
  const s = document.createElement('span'); s.textContent = m;
  const b = document.createElement('button'); b.className = 'tb'; b.textContent = label;
  b.onclick = async () => { t.classList.remove('on', 'act'); try { await fn(); } catch (e) { toast(e.message, 4500); } };
  t.append(s, b); t.classList.add('on', 'act');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on', 'act'), ms);
}
function toast(m, ms = 3200) {
  const t = $('#toast');
  t.classList.remove('act');
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
  if (!r.ok) { const er = new Error(j.error || (r.status === 404 ? 'API not found: the Functions did not deploy.' : 'Server error ' + r.status)); er.data = j; throw er; }
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
const G = () => window.FLGlass;
function themeIcon() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const comfy = document.documentElement.dataset.density === 'comfy';
  const g = G();
  $('#topFallback').classList.toggle('hide', !!g);
  if (g) {
    g.mount($('#topTools'), 'TopTools', {
      onJump: () => A.palette(), onTheme: toggleTheme, onDensity: (v) => { if (v !== (document.documentElement.dataset.density === 'comfy' ? 'comfy' : 'compact')) A.density(); },
      density: comfy ? 'comfy' : 'compact', dark, jumpIcon: ico('search'), themeIcon: ico(dark ? 'sun' : 'moon'),
    });
  } else {
    $('#bThemeM').innerHTML = dark ? ico('sun') : ico('moon');
    $('#bThemeM').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    $('#bDens').innerHTML = ico('rows') + '<span class="hm">' + (comfy ? 'Comfy' : 'Compact') + '</span>';
    $('#bDens').setAttribute('aria-label', comfy ? 'Density: comfy. Switch to compact' : 'Density: compact. Switch to comfy');
    $('#bPal').innerHTML = ico('search') + '<span class="hm">Jump <kbd>Ctrl K</kbd></span>';
  }
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
  dashboard: ['Overview', () => vDash(), 'home'],
  leads: ['Leads', () => vLeads(), 'users'],
  replies: ['Inbox', () => vReplies(), 'mail'],
  templates: ['Templates', () => vTemplates(), 'edit'],
  dnc: ['Do not contact', () => vDnc(), 'shield'],
  settings: ['Settings', () => vSettings(), 'gear'],
};
const ALIAS = { analytics: 'dashboard', assistant: 'dashboard' }; // old links still land somewhere sensible
// Desktop sidebar: grouped and complete. `m` marks the essentials that also show in the phone tab bar.
const NAV = [
  ['Overview', [['Overview', 'home', 'dashboard', '', 1]]],
  ['Outreach', [
    ['Find leads', 'search', 'leads', 'find=1'],
    ['All leads', 'users', 'leads', '', 1],
    ['Hot leads', 'spark', 'leads', 'f=hot'],
    ['Needs email', 'mail', 'leads', 'f=noemail'],
    ['Drafted', 'edit', 'leads', 'f=drafted'],
    ['Sent', 'send', 'leads', 'f=sent'],
  ]],
  ['Conversations', [
    ['Inbox', 'reply', 'replies', '', 1],
    ['Follow-ups due', 'mail', 'replies', 'f=due'],
  ]],
  ['Insights', [
    ['Analytics', 'chart', 'dashboard', 'ins=1'],
    ['Assistant', 'spark', 'assistant', ''],
  ]],
  ['Library', [
    ['Templates', 'edit', 'templates', ''],
    ['Do not contact', 'shield', 'dnc', ''],
  ]],
  ['Settings', [
    ['Profile & voice', 'gear', 'settings', 't=profile', 1],
    ['Data sources', 'rows', 'settings', 't=sources'],
    ['Account', 'users', 'settings', 't=account'],
  ]],
];
const hashParts = () => { const h = location.hash.replace(/^#\/?/, '') || 'dashboard'; const [k, q] = h.split('?'); return [k, new URLSearchParams(q || '')]; };
const rawKey = () => hashParts()[0];
const page = () => { const r = rawKey(), k = ALIAS[r] || r; return ROUTES[k] ? k : 'dashboard'; };
// Sidebar links can carry a preset (a filter, a settings tab). Apply it before the page draws.
function applyParams() {
  const [k, q] = hashParts();
  const f = q.get('f');
  if (k === 'leads') { if (f) { ui.filter = f; ui.query = ''; } if (q.get('find')) ui.finderOpen = true; else if (f) ui.finderOpen = false; }
  if (k === 'replies' && f) ui.replyFilter = f;
  if (k === 'settings' && q.get('t')) ui.setTab = q.get('t');
  if (k === 'analytics' || q.get('ins')) store.set('ins', '1');
}
function route() {
  if (rawKey() === 'assistant') { history.replaceState(null, '', '#/dashboard'); setTimeout(() => openAssist(true), 0); }
  if (window.FLGlass) window.FLGlass.unmountWithin($('#view'));
  applyParams();
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
const navHref = (pg, q) => '#/' + pg + (q ? '?' + q : '');
function chrome() {
  const k = page(), L = S.leads, [rk, rq] = hashParts();
  const cnt = { replied: L.filter((l) => l.status === 'replied').length, hot: 0, noemail: 0, drafted: 0, sent: 0, due: 0, dnc: S.suppressed || 0 };
  if (window.leadMatches) for (const f of ['hot', 'noemail', 'drafted', 'sent']) cnt[f] = L.filter((l) => leadMatches(l, f)).length;
  if (typeof dueFollowup === 'function') cnt.due = L.filter(dueFollowup).length;
  const badge = (pg, q) => (pg === 'replies' && !q ? cnt.replied : pg === 'replies' ? cnt.due : pg === 'dnc' ? cnt.dnc : pg === 'leads' && /^f=/.test(q) ? cnt[q.slice(2)] : pg === 'leads' && !q ? L.length : 0) || 0;
  const on = (pg, q) => { const same = (ALIAS[rk] || rk) === pg || rk === pg; if (!same) return false; const want = new URLSearchParams(q); const key = [...want.keys()][0]; return key ? rq.get(key) === want.get(key) : ![...rq.keys()].some((x) => ['f', 'find', 't', 'ins'].includes(x)); };
  $('#nav').innerHTML = NAV.map(([grp, items]) => `<div class="ng" role="group" aria-label="${grp}"><div class="nh">${grp}</div>${items.map(([label, ic, pg, q]) => { const b = badge(pg, q); const a = on(pg, q); return `<a href="${navHref(pg, q)}" class="${a ? 'on' : ''}" ${a ? 'aria-current="page"' : ''} title="${label}">${ico(ic)}<span class="t">${label}</span>${b ? `<span class="badge${pg === 'replies' && !q ? '' : ' soft'}">${b}</span>` : ''}</a>`; }).join('')}</div>`).join('');
  const tabs = [['Overview', 'home', 'dashboard', ''], ['Leads', 'users', 'leads', ''], ['Inbox', 'reply', 'replies', ''], ['Settings', 'gear', 'settings', '']];
  const tk = ALIAS[rk] || rk;
  const tabOn = (pg) => (pg === tk) || (pg === 'leads' && false);
  if (G()) G().mount($('#tabbar'), 'Tabs', { value: tabs.some((t) => tabOn(t[2])) ? tk : '', items: tabs.map(([label, ic, pg]) => ({ value: pg, href: '#/' + pg, label, icon: ico(ic), badge: pg === 'replies' ? cnt.replied : 0 })) });
  else $('#tabbar').innerHTML = tabs.map(([label, ic, pg]) => `<a href="#/${pg}" class="${tabOn(pg) ? 'on' : ''}" ${tabOn(pg) ? 'aria-current="page"' : ''}>${ico(ic)}${label}${pg === 'replies' && cnt.replied ? `<span class="badge">${cnt.replied}</span>` : ''}</a>`).join('');
  const lim = Number(S.settings.dailyLimit) || 0;
  $('#qTxt').textContent = lim ? `${S.sentToday} / ${lim} sent today` : `${S.sentToday} sent today`;
  $('#qBar').style.width = lim ? Math.min(100, (S.sentToday / lim) * 100) + '%' : '0%';
  $('#qCap').textContent = lim ? 'Daily send cap' : 'No daily cap';
  $('#topHint').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  themeIcon();
}
function refreshUI() {
  chrome();
  const k = page();
  if (k === 'dashboard') vDash();
  else if (k === 'leads') renderLeadsTable(); else if (k === 'replies') renderReplyList(); else if (k === 'dnc') vDnc();
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
document.addEventListener('toggle', (e) => { if (e.target.id === 'insights') store.set('ins', e.target.open ? '1' : '0'); }, true);
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
  const lim = Number(s.dailyLimit) || 0;
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

  const unset = setup.filter((x) => !x[1]);
  $('#view').innerHTML = `
    <div class="hrow"><h2 class="hello">${greet}${name ? ', ' + esc(name) : ''}</h2><span class="hint">${L.length ? 'Here is where your outreach stands.' : 'Let us get your first leads in.'}</span></div>
    ${S.security?.weakPassword ? `<div class="banner" role="alert"><b>Weak password.</b> Your dashboard password is under 12 characters. Set a longer one (DASH_PASSWORD in Cloudflare).</div>` : ''}
    ${unset.length ? `<div class="card pad setup"><b>Get set up</b>${unset.map(([t, , to]) => `<a class="chip" href="#/${to}">${esc(t)}</a>`).join('')}</div>` : ''}
    <div class="card kstrip">
      <div><b>${L.length}</b><span>Leads</span><small>${withEmail} with email</small></div>
      <div><b>${cont}</b><span>Emailed</span><small>${S.sentToday}${lim ? ' / ' + lim : ''} today</small></div>
      <div><b>${rep}</b><span>Replies</span><small>${cont ? Math.round((rep / cont) * 100) + '% rate' : 'none yet'}</small></div>
      <div><b>${n((l) => l.status === 'drafted')}</b><span>Drafts</span><small>${due} follow-ups due</small></div>
      <div><b>${S.suppressed}</b><span>Do not contact</span><small>never emailed</small></div>
    </div>
    ${todos.length ? `<div class="grid g2 tight">${todos.slice(0, 4).map((t) => `<button class="todo" data-act="go" data-to="${t.to}" ${t.filter ? `data-filter="${t.filter}"` : ''} ${t.rf ? `data-rf="${t.rf}"` : ''}><div class="n">${esc(t.n)}</div><div><b>${esc(t.t)}</b><span>${esc(t.d)}</span></div></button>`).join('')}</div>` : ''}
    <div class="grid g2 tight">
      <div class="card pad"><h3>Last 14 days</h3>${lineChart(act14.labels, [{ name: 'Leads found', color: 'var(--c1)', values: act14.found }, { name: 'Emails sent', color: 'var(--c2)', values: act14.sent }, { name: 'Replies', color: 'var(--c4)', values: act14.replied }], 170)}</div>
      <div class="card pad"><h3>Pipeline</h3>${hbars(funnel)}<div class="feed" style="margin-top:8px">${ev.slice(0, 3).map((e) => `<div><span class="dt">${ico(e.k === 'reply' ? 'reply' : 'send')}</span><span>${e.x}</span><time>${ago(e.t)}</time></div>`).join('') || '<div class="hint">Emails and replies will show up here.</div>'}</div></div>
    </div>
    <details class="card ins" id="insights" ${store.get('ins', '0') === '1' ? 'open' : ''}><summary><b>Insights</b><span class="hint">reply rates by lead type, daily sends, categories</span></summary><div class="insb">${analyticsHtml()}</div></details>`;
}

/* ---------- analytics ---------- */
function analyticsHtml() {
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

  return `
    <div class="grid g5 tight">
      <div class="card kpi"><b>${L.length}</b><span>Total leads</span></div>
      <div class="card kpi"><b>${cont.length}</b><span>Emailed</span></div>
      <div class="card kpi"><b>${rep.length}</b><span>Replies</span></div>
      <div class="card kpi"><b>${rate}%</b><span>Reply rate</span></div>
      <div class="card kpi"><b>${avgReply ?? '–'}</b><span>Avg days to reply</span></div>
    </div>
    ${best ? `<div class="banner" style="background:var(--acc2);color:var(--acc)"><b>Insight:</b> ${esc(best.g)} leads reply the most so far (${best.rate}% of ${best.c} emailed). Consider targeting more of them.</div>` : ''}
    <div class="grid g2 tight">
      <div class="card pad"><h3>Emails sent per day</h3><div class="hint">Last 30 days · ${sentTotal} total</div>${barChart(act.labels, act.sent)}</div>
      <div class="card pad"><h3>Leads found vs replies</h3>${lineChart(act.labels, [{ name: 'Leads found', color: 'var(--c1)', values: act.found }, { name: 'Replies', color: 'var(--c4)', values: act.replied }], 190)}</div>
    </div>
    <div class="grid g2 tight">
      <div class="card pad"><h3>Lead quality</h3><div class="hint">How weak each lead's web presence is</div>${donut(gData.map((x) => ({ label: x.g, value: x.n, color: colors[x.g] })))}</div>
      <div class="card"><div class="pad" style="padding-bottom:6px"><h3>Which leads reply?</h3><div class="hint">Needs a few sends per group to mean much</div></div><div class="tw"><table><thead><tr><th>Group</th><th>Leads</th><th>Emailed</th><th>Replied</th><th>Rate</th></tr></thead><tbody>${gData.map((x) => `<tr><td>${x.g}</td><td>${x.n}</td><td>${x.c}</td><td>${x.r}</td><td>${x.rate == null ? '–' : x.rate + '%'}</td></tr>`).join('')}</tbody></table></div></div>
    </div>
    <div class="card"><div class="pad" style="padding-bottom:6px"><h3>By category</h3></div><div class="tw"><table><thead><tr><th>Category</th><th>Leads</th><th>Emailed</th><th>Replied</th><th>Rate</th></tr></thead><tbody>${catRows.length ? catRows.map(([k, v]) => `<tr><td style="text-transform:capitalize">${esc(k)}</td><td>${v.n}</td><td>${v.c}</td><td>${v.r}</td><td>${v.c ? Math.round((v.r / v.c) * 100) + '%' : '–'}</td></tr>`).join('') : '<tr><td colspan="5" class="hint">No leads yet.</td></tr>'}</tbody></table></div></div>`;
}

/* ---------- settings ---------- */
function vSettings() {
  const tab = ui.setTab || 'profile';
  $('#view').innerHTML = `
    <div class="chips tabs" role="tablist" aria-label="Settings sections">${[['profile', 'Profile & voice'], ['sources', 'Data sources'], ['account', 'Account']].map(([k, t]) => `<button class="chip ${tab === k ? 'on' : ''}" role="tab" aria-selected="${tab === k}" data-act="setTab" data-t="${k}">${t}</button>`).join('')}</div>
    <div id="setBody"></div>`;
  if (tab === 'profile') setProfile(); else if (tab === 'sources') setSources(); else setAccount();
}
A.setTab = (t) => { ui.setTab = t.dataset.t; vSettings(); };

function setProfile() {
  const s = S.settings;
  const field = (id, label, val, ph = '', type = 'text') => `<div><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(val)}" placeholder="${esc(ph)}"></div>`;
  $('#setBody').innerHTML = `
    <div class="grid g2" style="align-items:start">
      <div class="card pad stack"><h3>You</h3><div class="hint">Emails go out as plain text, exactly as you write them, with nothing added.</div>
        <div class="grid g2">${field('sName', 'Your name', s.senderName, 'Zaid Ahmed')}${field('sAgency', 'Agency name', s.businessName, 'FlightLine')}</div>
        ${field('sReply', 'Your email (reply-to and test sends)', s.replyTo, 'your Gmail address', 'email')}
        <div class="grid g2">${field('sLim', 'Daily send cap (0 = none)', s.dailyLimit, '0', 'number')}${field('sGap', 'Seconds between bulk sends (0 = none)', s.sendGap, '0', 'number')}</div>
        ${field('sPort', 'Portfolio link (optional)', s.portfolioUrl)}
      </div>
      <div class="card pad stack"><h3>AI voice</h3><div class="hint">The writer uses these to sound like you and stay accurate.</div>
        <div><label for="sTone">Tone</label><select id="sTone">${[['friendly', 'Friendly (default)'], ['casual', 'Casual and short'], ['direct', 'Direct'], ['professional', 'Professional']].map(([v, t]) => `<option value="${v}" ${s.tone === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div><label for="sOffer">Your offer (one or two sentences)</label><textarea id="sOffer" style="min-height:64px">${esc(s.offer)}</textarea></div>
        <div><label for="sAbout">About you (optional)</label><input id="sAbout" value="${esc(s.about)}"></div>
        <div><label for="sKnow">Notes for replies and chat (pricing, process, turnaround)</label><textarea id="sKnow" style="min-height:72px" placeholder="e.g. Sites start at $X, live in about a week, hosting $Y/mo">${esc(s.knowledge)}</textarea></div>
      </div>
    </div>
    <div class="acts" style="margin-top:12px"><button class="btn p" data-act="saveSettings">Save settings</button><button class="btn s" data-act="testAI">${ico('spark')} Test AI</button><span id="aiTest" class="hint"></span></div>`;
}

function setAccount() {
  const fx = (() => { try { return localStorage.getItem('fx') === 'calm' ? 'calm' : 'full'; } catch { return 'full'; } })();
  $('#setBody').innerHTML = `
    <div class="grid g2" style="align-items:start">
      <div class="card pad"><h3>${ico('shield')} Security</h3>
        <div class="check ${S.security?.weakPassword ? '' : 'done'}"><span class="dot">${S.security?.weakPassword ? '' : ico('check')}</span><span>${S.security?.weakPassword ? 'Password is short. Use 12+ characters.' : 'Strong password'}</span></div>
        <div class="check done"><span class="dot">${ico('check')}</span><span>Sign-in locks after repeated wrong passwords</span></div>
        <div class="check done"><span class="dot">${ico('check')}</span><span>Sessions expire after 7 days</span></div>
        <div class="acts" style="margin-top:10px"><button class="btn s" data-act="signOut">Sign out</button><button class="btn s d" data-act="logoutAll">Sign out of all devices</button></div>
      </div>
      <div class="card pad stack"><h3>Look and feel</h3>
        <div><label for="fxSel">Glass effects</label><select id="fxSel" data-change="fxSet"><option value="full" ${fx === 'full' ? 'selected' : ''}>Full (drifting orbs, pointer light, springy buttons)</option><option value="calm" ${fx === 'calm' ? 'selected' : ''}>Calm (static glass only)</option></select></div>
        <div class="hint">Effects never block clicks or typing. Switch to Calm if you want it fully still. Devices set to reduce motion are always calm.</div>
        <h3 style="margin-top:6px">Tips for better replies</h3>
        <ul class="hint" style="margin:0;padding-left:18px;line-height:1.7"><li>Send a test to yourself first and check spam.</li><li>Fill in your notes so reply drafts quote real prices.</li><li>Follow up once after 3-4 days; two emails is plenty.</li></ul>
      </div>
    </div>`;
}
C.fxSet = (i) => { try { localStorage.setItem('fx', i.value); } catch {} document.documentElement.dataset.fx = i.value; toast(i.value === 'calm' ? 'Glass effects calmed' : 'Glass effects on', 1800); };

const SRC_STATE = {};
async function setSources() {
  $('#setBody').innerHTML = '<div class="card pad hint">Loading…</div>';
  let list;
  try { list = (await api('sources')).sources; } catch (e) { $('#setBody').innerHTML = `<div class="card pad hint">${esc(e.message)}</div>`; return; }
  ui.sources = list;
  const row = (c) => {
    const st = SRC_STATE[c.id];
    const needsKey = c.key && !c.configured;
    return `<div class="src" data-id="${c.id}">
      <span class="sd ${needsKey ? 'off' : st ? (st.ok ? 'ok' : 'bad') : 'idle'}" aria-hidden="true"></span>
      <div class="si"><b>${esc(c.name)}</b>${c.recommended && needsKey ? ' <span class="pill acc">Recommended</span>' : ''}<span class="sub">${esc(c.role)}</span><span class="sub">${esc(c.free || '')}</span></div>
      <div class="sr2">${needsKey
        ? `<code>${esc(c.key)}</code>${c.signup ? `<a class="btn s" href="${esc(c.signup)}" target="_blank" rel="noopener noreferrer">Get key</a>` : ''}`
        : `<button class="btn s" data-act="srcTest" data-id="${c.id}">Test</button>`}</div>
      <div class="sres" id="sr-${c.id}">${st ? `<span style="color:var(--${st.ok ? 'ok' : 'bad'})">${st.ok ? '✓' : '✗'}</span> ${esc(st.detail)} <small>${st.ms} ms</small>` : ''}</div>
    </div>`;
  };
  $('#setBody').innerHTML = `<div class="card pad">
    <div class="srchd"><div><h3>Data sources</h3><div class="hint">Where leads and contact details come from. If one is blocked, the next takes over. Test shows what actually works from your Cloudflare site.</div></div><button class="btn s p" data-act="srcTestAll">Test all</button></div>
    <div class="srclist">${list.map(row).join('')}</div>
    <details class="how"><summary>How to add a key</summary><ol class="hint"><li>Open the source's sign-up link above and copy the key (the recommended ones need no card).</li><li>In Cloudflare open <b>Workers & Pages</b>, your project, <b>Settings</b>, <b>Variables and Secrets</b>, and add it with the exact name shown, as a secret.</li><li>Redeploy, come back here and press <b>Test</b>. Keys never reach this page.</li></ol></details>
  </div>`;
}
async function runSrc(id) {
  const el = $('#sr-' + id); if (el) el.innerHTML = '<span class="hint">Testing…</span>';
  let r; try { r = await api('sources-test', { method: 'POST', body: { id } }); } catch (e) { r = { ok: false, ms: 0, detail: e.message }; }
  SRC_STATE[id] = r;
  const row = document.querySelector(`.src[data-id="${id}"]`);
  if (row) { row.querySelector('.sd').className = 'sd ' + (r.ok ? 'ok' : 'bad'); }
  if (el) el.innerHTML = `<span style="color:var(--${r.ok ? 'ok' : 'bad'})">${r.ok ? '✓' : '✗'}</span> ${esc(r.detail)} <small>${r.ms} ms</small>`;
}
A.srcTest = (b) => act(b, () => runSrc(b.dataset.id));
A.srcTestAll = (b) => act(b, async () => {
  const ids = (ui.sources || []).filter((c) => !c.key || c.configured).map((c) => c.id);
  await pool(ids, 3, runSrc);
  const bad = ids.filter((i) => SRC_STATE[i] && !SRC_STATE[i].ok).length;
  toast(bad ? `${ids.length - bad} working, ${bad} not` : 'Everything checked out', 3500);
});
A.testAI = (btn) => act(btn, async () => {
  const el = $('#aiTest'); el.textContent = 'Testing…';
  const r = await api('ai-test');
  const models = (r.models || []).filter((m) => !/whisper|guard|tts|playai|orpheus|safeguard|compound/i.test(m));
  el.innerHTML = r.ok
    ? `<span style="color:var(--ok)"><b>AI works.</b></span> Using <b>${esc(r.model)}</b>. Tool use (assistant actions): ${r.tools ? '<b style="color:var(--ok)">works</b>' : '<b style="color:var(--bad)">not working</b>' + (r.toolsError ? ' (' + esc(r.toolsError) + ')' : '')}.<br>Models your key can use: ${esc(models.join(', ') || 'unknown')}`
    : `<span style="color:var(--bad)"><b>AI failed:</b> ${esc(r.error || 'unknown error')}</span>${models.length ? '<br>Models your key can use: ' + esc(models.join(', ')) : ''}`;
});
A.saveSettings = (btn) => act(btn, async () => {
  const r = await api('settings', { method: 'PUT', body: { senderName: $('#sName').value, replyTo: $('#sReply').value, dailyLimit: $('#sLim').value, sendGap: $('#sGap').value, tone: $('#sTone').value, offer: $('#sOffer').value, about: $('#sAbout').value, knowledge: $('#sKnow').value, portfolioUrl: $('#sPort').value, businessName: $('#sAgency').value } });
  S.settings = r.settings; chrome(); toast('Settings saved');
});

A.logoutAll = (btn) => act(btn, async () => { await api('logout-all', { method: 'POST', body: {} }); showLogin(); });
A.signOut = () => $('#bOut').click();


/* ---------- library pages ---------- */
function vTemplates() {
  const n = (S.templates || []).length;
  $('#view').innerHTML = `<div class="card pad"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><div><h3>Quick-reply templates</h3><div class="hint">Short answers you reuse in the Inbox. ${n} saved.</div></div><div class="sp"></div><button class="btn p" data-act="tplEdit">Edit templates</button></div>
    <div class="list" style="margin-top:12px">${(S.templates || []).map((t) => `<div class="li"><div class="nm">${esc(t.name || 'Template')}</div><div class="sub" style="white-space:pre-wrap">${esc(String(t.body || '').slice(0, 280))}</div></div>`).join('') || '<div class="empty">No templates yet.</div>'}</div></div>`;
}
let DNC = null;
async function vDnc() {
  $('#view').innerHTML = `<div class="card pad"><h3>Do not contact</h3><div class="hint">FlightLine will never email these addresses. Replying "unsubscribe" adds one automatically.</div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><input class="in" id="dncIn" type="email" placeholder="name@business.com" style="flex:1;min-width:200px" aria-label="Email to block"><button class="btn p" data-act="dncAdd">Add</button></div>
    <div class="list" id="dncList" style="margin-top:12px"><div class="empty">Loading…</div></div></div>`;
  try { DNC = (await api('suppress')).list; } catch (e) { toast(e.message, 4000); DNC = DNC || []; }
  dncDraw();
}
function dncDraw() {
  const el = $('#dncList'); if (!el) return;
  el.innerHTML = DNC.length ? DNC.map((e) => `<div class="li" style="display:flex;align-items:center;gap:8px"><span class="nm">${esc(e)}</span><span class="sp"></span><button class="btn s" data-act="dncDel" data-e="${esc(e)}">Remove</button></div>`).join('') : '<div class="empty">Nobody is blocked.</div>';
}
A.dncAdd = async () => { const v = $('#dncIn').value; try { DNC = (await api('suppress', { method: 'POST', body: { email: v } })).list; S.suppressed = DNC.length; $('#dncIn').value = ''; dncDraw(); chrome(); } catch (e) { toast(e.message, 4000); } };
A.dncDel = async (t) => { try { DNC = (await api('suppress', { method: 'POST', body: { email: t.dataset.e, remove: true } })).list; S.suppressed = DNC.length; dncDraw(); chrome(); } catch (e) { toast(e.message, 4000); } };
