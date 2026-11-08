import { json, loadDB, saveDB, isEmail, today, unsubToken, DEFAULT_SETTINGS } from '../../lib/util.js';
import { findBusinesses } from '../../lib/osm.js';
import { auditSite } from '../../lib/audit.js';
import { draftEmail, draftReply, runAgent, firstName } from '../../lib/ai.js';
import { sendEmail, emailReady, renderEmail } from '../../lib/email.js';

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
  followups: [],
  createdAt: Date.now(),
});

const host = (u) => {
  try {
    return new URL(/^https?:/i.test(u) ? u : 'https://' + u).host.replace(/^www\./, '');
  } catch {
    return u;
  }
};

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
    if (a === 'reply-draft' && m === 'POST') return await replyDraft(env, body);
    if (a === 'send' && m === 'POST') return await send(env, request, body);
    if (a === 'settings' && m === 'PUT') return await saveSettings(env, body);
    if (a === 'templates' && m === 'PUT') return await saveTemplates(env, body);
    if (a === 'chat' && m === 'POST') return await chat(env, body);
    if (a === 'logout') return json({ ok: true }, 200, { 'set-cookie': 'ls=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
  return json({ error: 'not found' }, 404);
}

/* ---------------- shared helpers ---------------- */
function mergeFound(db, items) {
  let added = 0,
    dupes = 0;
  for (const f of items) {
    if (db.leads[f.id]) {
      dupes++;
      continue;
    }
    const lead = newLead(f);
    if (lead.email && db.suppress.includes(lead.email)) lead.status = 'unsub';
    db.leads[f.id] = lead;
    added++;
  }
  return { added, dupes };
}

async function runAudit(db, id) {
  const lead = db.leads[id];
  if (!lead?.website) return null;
  const r = await auditSite(lead.website);
  lead.audit = { score: r.score, issues: r.issues, ms: r.ms, checkedAt: r.checkedAt };
  if (!lead.email && r.email && !db.suppress.includes(r.email)) lead.email = r.email;
  return lead;
}

// Throws a readable error if this lead can't be emailed right now
function assertSendable(db, lead, { followup = false, pending = 0 } = {}) {
  const to = lead.email;
  if (!isEmail(to)) throw new Error('This lead has no valid email yet.');
  if (db.suppress.includes(to) || lead.status === 'unsub') throw new Error('This address has unsubscribed.');
  if (!followup && (lead.status === 'sent' || lead.status === 'replied')) throw new Error('Already contacted. Use a quick reply or follow-up instead.');
  if (followup && !['sent', 'replied'].includes(lead.status)) throw new Error('Follow-ups are for leads you have already emailed.');
  const limit = Number(db.settings.dailyLimit || DEFAULT_SETTINGS.dailyLimit);
  if ((db.sent[today()] || 0) + pending >= limit) throw new Error(`Daily send limit reached (${limit}). Raise it in Settings or continue tomorrow.`);
  return to;
}

/* ---------------- state ---------------- */
async function state(env) {
  const db = await loadDB(env);
  const leads = Object.values(db.leads).sort((x, y) => y.createdAt - x.createdAt);
  return json({
    leads,
    settings: db.settings,
    templates: db.templates,
    sentToday: db.sent[today()] || 0,
    suppressed: db.suppress.length,
    configured: { groq: !!env.GROQ_API_KEY, email: emailReady(env) },
  });
}

/* ---------------- leads ---------------- */
async function discover(env, p) {
  if (!p.city) throw new Error('Enter a city.');
  const { items, debug } = await findBusinesses({
    city: String(p.city),
    category: p.category || 'all',
    mode: p.mode === 'has_site' ? 'has_site' : 'none',
    radiusKm: Number(p.radius) || 15,
  });
  const db = await loadDB(env);
  const { added, dupes } = mergeFound(db, items);
  await saveDB(env, db);
  return json({ found: items.length, added, dupes, debug });
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
  applyPatch(db, lead, p);
  await saveDB(env, db);
  return json({ lead });
}

function applyPatch(db, lead, p) {
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
      if (p.status === 'replied' && !lead.repliedAt) lead.repliedAt = Date.now();
      if (p.status === 'sent' && !lead.sentAt) lead.sentAt = Date.now();
    } else if (k === 'draft') {
      lead.draft = p.draft
        ? { ...(lead.draft || {}), subject: String(p.draft.subject || ''), body: String(p.draft.body || '') }
        : null;
    } else {
      lead[k] = String(p[k] ?? '');
    }
  }
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
  const results = await Promise.all(ids.map((id) => runAudit(db, id)));
  await saveDB(env, db);
  return json({ leads: results.filter(Boolean) });
}

/* ---------------- AI ---------------- */
async function draft(env, p) {
  if (!env.GROQ_API_KEY) throw new Error('GROQ_API_KEY secret is not set.');
  const db = await loadDB(env);
  const lead = db.leads[p.id];
  if (!lead) throw new Error('Lead not found.');
  lead.draft = await draftEmail(env, lead, db.settings, { tone: p.tone, instructions: p.instructions });
  if (lead.status === 'new') lead.status = 'drafted';
  await saveDB(env, db);
  return json({ lead });
}

async function replyDraft(env, p) {
  if (!env.GROQ_API_KEY) throw new Error('GROQ_API_KEY secret is not set.');
  const db = await loadDB(env);
  const lead = db.leads[p.id];
  if (!lead) throw new Error('Lead not found.');
  const out = await draftReply(env, lead, db.settings, { theirReply: String(p.theirReply || ''), goal: String(p.goal || '') });
  return json({ reply: out });
}

/* ---------------- send ---------------- */
async function send(env, request, p) {
  const db = await loadDB(env);
  const lead = db.leads[p.id];
  if (!lead) throw new Error('Lead not found.');
  const s = db.settings;
  const test = !!p.test;
  const followup = !!p.followup && !test;

  if (!emailReady(env)) throw new Error('Email sending is not configured. Add the email secrets listed in the README.');
  if (!s.senderName || !s.address) throw new Error('Open Settings and add your name and mailing address first (required by CAN-SPAM).');

  const subject = String(p.subject ?? lead.draft?.subject ?? '').trim();
  const text = String(p.body ?? lead.draft?.body ?? '').trim();
  if (!subject || !text) throw new Error('Write a draft first.');
  if (!followup) lead.draft = { ...(lead.draft || {}), subject, body: text };

  let to;
  if (test) {
    to = s.replyTo;
    if (!isEmail(to)) throw new Error('Set a reply-to email in Settings to receive test sends.');
  } else {
    to = assertSendable(db, lead, { followup });
  }

  const origin = new URL(request.url).origin;
  const unsubUrl = `${origin}/unsubscribe?e=${encodeURIComponent(to)}&t=${await unsubToken(env, to)}`;
  const { text: fullText, html } = renderEmail(s, text, unsubUrl);

  await sendEmail(env, {
    to,
    subject: test ? '[TEST] ' + subject : subject,
    text: fullText,
    html,
    replyTo: s.replyTo || undefined,
    unsubUrl,
    fromName: s.senderName,
  });

  if (followup) {
    (lead.followups ||= []).push({ t: Date.now(), subject });
    db.sent[today()] = (db.sent[today()] || 0) + 1;
  } else if (!test) {
    lead.status = 'sent';
    lead.sentAt = Date.now();
    db.sent[today()] = (db.sent[today()] || 0) + 1;
  }
  await saveDB(env, db);
  return json({ ok: true, lead });
}

/* ---------------- settings / templates ---------------- */
async function saveSettings(env, p) {
  const db = await loadDB(env);
  const clean = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (!(k in p)) continue;
    clean[k] = k === 'dailyLimit' ? Math.min(Math.max(parseInt(p[k], 10) || 20, 1), 200) : String(p[k] ?? '').trim();
  }
  if (clean.replyTo && !isEmail(clean.replyTo)) throw new Error('Reply-to email looks invalid.');
  if (clean.tone && !['friendly', 'casual', 'direct', 'professional'].includes(clean.tone)) clean.tone = 'friendly';
  db.settings = { ...db.settings, ...clean };
  await saveDB(env, db);
  return json({ settings: db.settings });
}

async function saveTemplates(env, p) {
  if (!Array.isArray(p.templates)) throw new Error('Bad templates.');
  const db = await loadDB(env);
  db.templates = p.templates.slice(0, 20).map((t, i) => ({
    id: String(t.id || 't' + Date.now() + i).slice(0, 20),
    name: String(t.name || 'Untitled').slice(0, 40),
    body: String(t.body || '').slice(0, 3000),
  }));
  await saveDB(env, db);
  return json({ templates: db.templates });
}

/* ---------------- assistant ---------------- */
const MUTATING = new Set(['find_leads', 'audit_leads', 'draft_email', 'update_lead', 'add_lead', 'delete_lead', 'queue_send']);

function compact(l) {
  return {
    id: l.id,
    name: l.name,
    category: l.category,
    email: l.email || '',
    site: l.website ? host(l.website) : '',
    score: l.audit?.score ?? null,
    status: l.status,
  };
}

function overview(db, env) {
  const L = Object.values(db.leads);
  const by = (s) => L.filter((l) => l.status === s).length;
  return {
    leads: L.length,
    with_email: L.filter((l) => isEmail(l.email)).length,
    no_website: L.filter((l) => !l.website).length,
    unaudited_sites: L.filter((l) => l.website && !l.audit).length,
    drafted: by('drafted'),
    sent: by('sent'),
    replied: by('replied'),
    unsubscribed: db.suppress.length,
    sent_today: db.sent[today()] || 0,
    daily_limit: db.settings.dailyLimit,
    email_ready: emailReady(env),
  };
}

function buildTools(env, db, pending) {
  const need = (id) => {
    const l = db.leads[id];
    if (!l) throw new Error('No lead with id ' + id);
    return l;
  };
  const str = (d) => ({ type: 'string', description: d });
  return {
    get_overview: {
      spec: { name: 'get_overview', description: 'Counts and status of the whole pipeline.', parameters: { type: 'object', properties: {} } },
      run: async () => overview(db, env),
    },
    search_leads: {
      spec: {
        name: 'search_leads',
        description: 'List leads, optionally filtered. Returns compact rows (id, name, category, email, site, score, status).',
        parameters: {
          type: 'object',
          properties: {
            query: str('text to match in name/category/address'),
            status: { type: 'string', enum: STATUSES },
            has_email: { type: 'boolean' },
            has_website: { type: 'boolean' },
            min_score: { type: 'number', description: 'minimum site weakness score 0-100 (higher = worse site)' },
            limit: { type: 'number' },
          },
        },
      },
      run: async (a) => {
        const q = String(a.query || '').toLowerCase();
        let L = Object.values(db.leads).filter((l) => {
          if (q && !`${l.name} ${l.category} ${l.address}`.toLowerCase().includes(q)) return false;
          if (a.status && l.status !== a.status) return false;
          if (a.has_email != null && isEmail(l.email) !== !!a.has_email) return false;
          if (a.has_website != null && !!l.website !== !!a.has_website) return false;
          if (a.min_score != null && (l.audit?.score ?? -1) < a.min_score) return false;
          return true;
        });
        const total = L.length;
        L = L.slice(0, Math.min(Number(a.limit) || 15, 30));
        return { total, shown: L.length, leads: L.map(compact) };
      },
    },
    get_lead: {
      spec: { name: 'get_lead', description: 'Full details of one lead including audit issues, draft and notes.', parameters: { type: 'object', properties: { id: str('lead id') }, required: ['id'] } },
      run: async (a) => {
        const l = need(a.id);
        return { ...compact(l), phone: l.phone, address: l.address, website: l.website, notes: l.notes, audit_issues: l.audit?.issues || [], draft: l.draft ? { subject: l.draft.subject, body: l.draft.body } : null, sent_at: l.sentAt || null, replied_at: l.repliedAt || null };
      },
    },
    find_leads: {
      spec: {
        name: 'find_leads',
        description: 'Search the map for local businesses and add new ones to the dashboard.',
        parameters: {
          type: 'object',
          properties: {
            city: str('e.g. "Cedar Rapids, Iowa"'),
            category: { type: 'string', enum: ['all', 'restaurants', 'beauty', 'auto', 'fitness', 'trades', 'health', 'retail', 'offices'] },
            mode: { type: 'string', enum: ['none', 'has_site'], description: 'none = businesses with no website; has_site = ones with a website to audit' },
            radius_km: { type: 'number' },
          },
          required: ['city'],
        },
      },
      run: async (a) => {
        const { items, debug } = await findBusinesses({ city: String(a.city), category: a.category || 'all', mode: a.mode === 'has_site' ? 'has_site' : 'none', radiusKm: Number(a.radius_km) || 15 });
        const { added, dupes } = mergeFound(db, items);
        return { found: items.length, added, already_had: dupes, place: debug.place, note: `Added ${added} new leads near ${debug.place}.` };
      },
    },
    audit_leads: {
      spec: { name: 'audit_leads', description: 'Audit up to 5 leads\' websites (also finds contact emails).', parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] } },
      run: async (a) => {
        const ls = await Promise.all((a.ids || []).slice(0, 5).map((id) => runAudit(db, id)));
        return { audited: ls.filter(Boolean).map((l) => ({ id: l.id, name: l.name, score: l.audit.score, issues: l.audit.issues, email: l.email })) };
      },
    },
    draft_email: {
      spec: {
        name: 'draft_email',
        description: 'Write (and save) a personalized cold email for a lead using the proven opener playbook.',
        parameters: { type: 'object', properties: { id: str('lead id'), tone: { type: 'string', enum: ['friendly', 'casual', 'direct', 'professional'] }, instructions: str('extra guidance') }, required: ['id'] },
      },
      run: async (a) => {
        const l = need(a.id);
        l.draft = await draftEmail(env, l, db.settings, { tone: a.tone, instructions: a.instructions });
        if (l.status === 'new') l.status = 'drafted';
        return { id: l.id, subject: l.draft.subject, body: l.draft.body, note: 'Draft saved on the lead.' };
      },
    },
    update_lead: {
      spec: {
        name: 'update_lead',
        description: 'Edit a lead\'s fields (email, website, phone, notes, name, category, status).',
        parameters: { type: 'object', properties: { id: str('lead id'), name: str(''), email: str(''), website: str(''), phone: str(''), notes: str(''), category: str(''), status: { type: 'string', enum: STATUSES } }, required: ['id'] },
      },
      run: async (a) => {
        const { id, ...rest } = a;
        applyPatch(db, need(id), rest);
        return { note: 'Updated.', lead: compact(db.leads[id]) };
      },
    },
    add_lead: {
      spec: { name: 'add_lead', description: 'Add one lead manually.', parameters: { type: 'object', properties: { name: str(''), email: str(''), website: str(''), phone: str(''), notes: str('') }, required: ['name'] } },
      run: async (a) => {
        if (a.email && !isEmail(a.email)) throw new Error('Invalid email.');
        const id = 'm_' + crypto.randomUUID().slice(0, 8);
        db.leads[id] = newLead({ ...a, id, source: 'manual' });
        return { note: 'Added.', lead: compact(db.leads[id]) };
      },
    },
    delete_lead: {
      spec: { name: 'delete_lead', description: 'Permanently delete a lead. Only when the user asks.', parameters: { type: 'object', properties: { id: str('lead id') }, required: ['id'] } },
      run: async (a) => {
        const l = need(a.id);
        delete db.leads[a.id];
        return { note: `Deleted ${l.name}.` };
      },
    },
    queue_send: {
      spec: {
        name: 'queue_send',
        description: 'Queue the lead\'s drafted email for the owner to approve with one click. This does NOT send it. Optionally set subject/body first.',
        parameters: { type: 'object', properties: { id: str('lead id'), subject: str(''), body: str('') }, required: ['id'] },
      },
      run: async (a) => {
        const l = need(a.id);
        if (a.subject || a.body) l.draft = { ...(l.draft || {}), subject: a.subject || l.draft?.subject || '', body: a.body || l.draft?.body || '' };
        if (!l.draft?.subject || !l.draft?.body) throw new Error('No draft yet. Use draft_email first.');
        assertSendable(db, l, { pending: pending.length });
        pending.push({ id: l.id, name: l.name, to: l.email, subject: l.draft.subject, body: l.draft.body });
        return { note: `Queued for the owner's approval (${pending.length} pending). It has not been sent.` };
      },
    },
  };
}

async function chat(env, p) {
  if (!env.GROQ_API_KEY) throw new Error('GROQ_API_KEY secret is not set.');
  const db = await loadDB(env);
  const history = (Array.isArray(p.messages) ? p.messages : [])
    .filter((m) => ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 3000) }));
  if (!history.length || history[history.length - 1].role !== 'user') throw new Error('Say something first.');

  const s = db.settings;
  const o = overview(db, env);
  const system = [
    `You are Outreach Assistant, the built-in AI co-pilot in ${s.senderName ? s.senderName + "'s" : "the owner's"} lead-gen dashboard (a freelance web developer pitching local businesses). Today is ${new Date().toDateString()}.`,
    'Be concise, direct and honest. Push back politely when an idea would likely hurt results or deliverability. Help with anything asked (strategy, writing, pricing, general questions), not only this app.',
    'You can act on the dashboard with tools: search/get leads, find new leads, audit sites, write drafts, edit/add/delete leads, and queue emails. Never claim an action happened unless a tool result confirms it. You cannot send email yourself: queue_send puts it in front of the owner to approve. Delete only when asked. Prefer tools over guessing, and do bulk work in sensible batches.',
    'For lead-specific emails always use draft_email (it follows the proven playbook). For other outreach copy: 55-100 words, one true specific observation first, plain friendly words, one tiny ask, never invent facts about a business.',
    `Pipeline now: ${o.leads} leads, ${o.with_email} with email, ${o.drafted} drafted, ${o.sent} sent, ${o.replied} replied, sent today ${o.sent_today}/${o.daily_limit}.`,
    s.offer && `Owner's offer: ${s.offer}`,
    s.about && `About the owner: ${s.about}`,
    s.knowledge && `Owner's notes (pricing/process): ${s.knowledge.slice(0, 800)}`,
  ]
    .filter(Boolean)
    .join('\n');

  const pending = [];
  const out = await runAgent(env, { system, messages: history, tools: buildTools(env, db, pending) });
  await saveDB(env, db);
  return json({ reply: out.reply, actions: out.actions, pending, mutated: out.actions.some((a) => MUTATING.has(a.tool)) });
}
