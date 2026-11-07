import { json, loadDB, saveDB, isEmail, today, unsubToken, DEFAULT_SETTINGS } from '../../lib/util.js';
import { findBusinesses } from '../../lib/osm.js';
import { auditSite } from '../../lib/audit.js';
import { draftEmail } from '../../lib/groq.js';
import { sendEmail, emailReady } from '../../lib/email.js';

const EDITABLE = ['name', 'email', 'website', 'phone', 'notes', 'status', 'category', 'address', 'draft'];
const STATUSES = ['new', 'drafted', 'sent', 'replied', 'unsub', 'skip'];

const newLead = (o) => ({
  id: o.id,
  name: String(o.name || '').trim(),
  category: o.category || '',
  address: o.address || '',
  phone: o.phone || '',
  email: String(o.email || '').trim().toLowerCase(),
  website: String(o.website || '').trim(),
  notes: o.notes || '',
  source: o.source || 'manual',
  status: 'new',
  audit: null,
  draft: null,
  createdAt: Date.now(),
});

export async function onRequest({ request, env, params }) {
  const route = [].concat(params.route || []);
  const [a, b] = route;
  const m = request.method;
  const body = ['POST', 'PUT', 'PATCH'].includes(m) ? await request.json().catch(() => ({})) : {};
  try {
    if (a === 'state' && m === 'GET') return await state(env);
    if (a === 'discover' && m === 'POST') return await discover(env, body);
    if (a === 'leads' && !b && m === 'POST') return await addLead(env, body);
    if (a === 'leads' && b && m === 'PATCH') return await patchLead(env, b, body);
    if (a === 'leads' && b && m === 'DELETE') return await deleteLead(env, b);
    if (a === 'audit' && m === 'POST') return await audit(env, body);
    if (a === 'draft' && m === 'POST') return await draft(env, body);
    if (a === 'send' && m === 'POST') return await send(env, request, body);
    if (a === 'settings' && m === 'PUT') return await saveSettings(env, body);
    if (a === 'logout') return json({ ok: true }, 200, { 'set-cookie': 'ls=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
  return json({ error: 'not found' }, 404);
}

async function state(env) {
  const db = await loadDB(env);
  const leads = Object.values(db.leads).sort((x, y) => y.createdAt - x.createdAt);
  return json({
    leads,
    settings: db.settings,
    sentToday: db.sent[today()] || 0,
    suppressed: db.suppress.length,
    configured: {
      groq: !!env.GROQ_API_KEY,
      email: emailReady(env),
    },
  });
}

async function discover(env, p) {
  if (!p.city) throw new Error('Enter a city.');
  const found = await findBusinesses({
    city: String(p.city),
    category: p.category || 'all',
    mode: p.mode === 'has_site' ? 'has_site' : 'none',
    radiusKm: Number(p.radius) || 15,
  });
  const db = await loadDB(env);
  let added = 0;
  for (const f of found) {
    if (db.leads[f.id]) continue;
    const lead = newLead(f);
    if (lead.email && db.suppress.includes(lead.email)) lead.status = 'unsub';
    db.leads[f.id] = lead;
    added++;
  }
  await saveDB(env, db);
  return json({ found: found.length, added });
}

async function addLead(env, p) {
  const name = String(p.name || '').trim();
  if (!name) throw new Error('Business name is required.');
  if (p.email && !isEmail(String(p.email).trim())) throw new Error('That email looks invalid.');
  const db = await loadDB(env);
  const id = 'm_' + crypto.randomUUID().slice(0, 8);
  const lead = newLead({ ...p, id, source: 'manual' });
  if (lead.email && db.suppress.includes(lead.email)) lead.status = 'unsub';
  db.leads[id] = lead;
  await saveDB(env, db);
  return json({ lead });
}

async function patchLead(env, id, p) {
  const db = await loadDB(env);
  const lead = db.leads[id];
  if (!lead) throw new Error('Lead not found.');
  for (const k of EDITABLE) {
    if (!(k in p)) continue;
    if (k === 'email') {
      const e = String(p.email || '').trim().toLowerCase();
      if (e && !isEmail(e)) throw new Error('That email looks invalid.');
      lead.email = e;
      if (e && db.suppress.includes(e)) lead.status = 'unsub';
    } else if (k === 'status') {
      if (!STATUSES.includes(p.status)) throw new Error('Bad status.');
      lead.status = p.status;
    } else if (k === 'draft') {
      lead.draft = p.draft ? { subject: String(p.draft.subject || ''), body: String(p.draft.body || '') } : null;
    } else {
      lead[k] = String(p[k] ?? '');
    }
  }
  await saveDB(env, db);
  return json({ lead });
}

async function deleteLead(env, id) {
  const db = await loadDB(env);
  delete db.leads[id];
  await saveDB(env, db);
  return json({ ok: true });
}

async function audit(env, p) {
  const ids = (p.ids || []).slice(0, 5);
  const db = await loadDB(env);
  const results = await Promise.all(
    ids.map(async (id) => {
      const lead = db.leads[id];
      if (!lead?.website) return null;
      const r = await auditSite(lead.website);
      lead.audit = { score: r.score, issues: r.issues, ms: r.ms, checkedAt: r.checkedAt };
      if (!lead.email && r.email && !db.suppress.includes(r.email)) lead.email = r.email;
      return lead;
    })
  );
  await saveDB(env, db);
  return json({ leads: results.filter(Boolean) });
}

async function draft(env, p) {
  if (!env.GROQ_API_KEY) throw new Error('GROQ_API_KEY secret is not set.');
  const db = await loadDB(env);
  const lead = db.leads[p.id];
  if (!lead) throw new Error('Lead not found.');
  lead.draft = await draftEmail(env, lead, db.settings);
  if (lead.status === 'new') lead.status = 'drafted';
  await saveDB(env, db);
  return json({ lead });
}

async function send(env, request, p) {
  const db = await loadDB(env);
  const lead = db.leads[p.id];
  if (!lead) throw new Error('Lead not found.');
  const s = db.settings;
  const test = !!p.test;

  if (!emailReady(env)) throw new Error('Email sending is not configured. Add the email secrets listed in the README.');
  if (!s.senderName || !s.address) throw new Error('Open Settings and add your name and mailing address first (required by CAN-SPAM).');

  const subject = String(p.subject ?? lead.draft?.subject ?? '').trim();
  const text = String(p.body ?? lead.draft?.body ?? '').trim();
  if (!subject || !text) throw new Error('Write a draft first.');
  lead.draft = { subject, body: text };

  let to;
  if (test) {
    to = s.replyTo;
    if (!isEmail(to)) throw new Error('Set a reply-to email in Settings to receive test sends.');
  } else {
    to = lead.email;
    if (!isEmail(to)) throw new Error('This lead has no valid email yet.');
    if (db.suppress.includes(to) || lead.status === 'unsub') throw new Error('This address has unsubscribed.');
    if (lead.status === 'sent' || lead.status === 'replied') throw new Error('Already contacted.');
    if ((db.sent[today()] || 0) >= Number(s.dailyLimit || DEFAULT_SETTINGS.dailyLimit)) {
      throw new Error(`Daily send limit reached (${s.dailyLimit}). Raise it in Settings or continue tomorrow.`);
    }
  }

  const origin = new URL(request.url).origin;
  const unsubUrl = `${origin}/unsubscribe?e=${encodeURIComponent(to)}&t=${await unsubToken(env, to)}`;
  const footer =
    `\n\n--\n${s.senderName}` +
    (s.businessName ? `\n${s.businessName}` : '') +
    `\n${s.address}\nNot interested? Opt out here: ${unsubUrl}`;

  await sendEmail(env, { to, subject: test ? '[TEST] ' + subject : subject, text: text + footer, replyTo: s.replyTo || undefined, unsubUrl });

  if (!test) {
    lead.status = 'sent';
    lead.sentAt = Date.now();
    db.sent[today()] = (db.sent[today()] || 0) + 1;
  }
  await saveDB(env, db);
  return json({ ok: true, lead });
}

async function saveSettings(env, p) {
  const db = await loadDB(env);
  const clean = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (k in p) clean[k] = k === 'dailyLimit' ? Math.min(Math.max(parseInt(p[k], 10) || 20, 1), 200) : String(p[k] ?? '').trim();
  }
  if (clean.replyTo && !isEmail(clean.replyTo)) throw new Error('Reply-to email looks invalid.');
  db.settings = { ...db.settings, ...clean };
  await saveDB(env, db);
  return json({ settings: db.settings });
}
