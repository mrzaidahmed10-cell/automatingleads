// All Groq-powered features: cold-email drafting, reply helper, and the tool-using assistant.
const PREFERRED = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
let cachedModel = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';

async function pickModel(env) {
  if (cachedModel) return cachedModel;
  let available = [];
  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { authorization: `Bearer ${env.GROQ_API_KEY}` } });
    if (r.ok) available = ((await r.json()).data || []).map((m) => m.id);
  } catch {}
  const wanted = [env.GROQ_MODEL, ...PREFERRED].filter(Boolean);
  const hit = available.length ? wanted.find((m) => available.includes(m)) : wanted[0];
  if (!hit) throw new Error('None of the expected Groq models are available to your key. Set GROQ_MODEL to one from console.groq.com/docs/models.');
  return (cachedModel = hit);
}

async function callGroq(env, payload) {
  const model = await pickModel(env);
  const go = () =>
    fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.GROQ_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, ...payload }),
    });
  let r = await go();
  if (r.status === 429) {
    const wait = Math.min(parseFloat(r.headers.get('retry-after') || '3') || 3, 6);
    await sleep(wait * 1000);
    r = await go();
  }
  if (r.status === 404) cachedModel = null;
  return r;
}

async function groqError(r) {
  const t = (await r.text()).slice(0, 300);
  if (r.status === 429) return new Error('Groq rate limit reached. Wait a few seconds and try again.');
  if (r.status === 413) return new Error('That request was too large for your Groq plan limits. Try a shorter message.');
  if (r.status === 401) return new Error('Groq rejected the API key (GROQ_API_KEY).');
  return new Error(`Groq error ${r.status}: ${t}`);
}

function parseLoose(content) {
  try {
    return JSON.parse(content);
  } catch {}
  const m = String(content).match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {}
  }
  throw new Error('The AI returned an unreadable answer. Try again.');
}

async function groqJson(env, messages, temperature = 0.8) {
  let r = await callGroq(env, { messages, temperature, response_format: { type: 'json_object' } });
  if (r.status === 400) r = await callGroq(env, { messages, temperature });
  if (!r.ok) throw await groqError(r);
  return parseLoose((await r.json()).choices?.[0]?.message?.content || '');
}

/* ------------------------------------------------------------------ */
/* The playbook: what a good cold opener looks like.                   */
/* Distilled from published cold-email research: short and mobile-     */
/* readable, relevance beats decoration, one idea, one low-effort ask. */
/* ------------------------------------------------------------------ */
export const PLAYBOOK = `COLD EMAIL PLAYBOOK (you are writing for a freelance web developer emailing a local small business owner):

1. RELEVANCE, NOT DECORATION. The first line must answer "why am I getting this?" with one true, specific observation tied to something the owner cares about (customers finding them, calling them, booking). Test it: "I'm mentioning this because ___" must be a customer problem. Never open with flattery, "I hope you're well", "My name is", "I'm reaching out", or "I came across your business".
2. ONLY USE TRUE FACTS FROM THE DATA PROVIDED. Never invent anything: no made-up reviews, years in business, owner names, specialties, prices, stats, case studies, clients, or results. Never claim to have visited in person, to be a customer, or to know them. No fake urgency, scarcity, deadlines, "Re:" or "Fwd:" subjects, or hidden-sale tricks. If you only know there is no website listed, say you couldn't find one.
3. SHORT AND SKIMMABLE. 55-100 words, 3-5 short sentences, blank line between ideas, readable on a phone. No bullet lists, no bold, no emojis, no exclamation marks.
4. HUMAN AND APPROACHABLE. Sound like a friendly local person, not an agency. Contractions, plain words, zero jargon (no "responsive", "SEO", "conversion", "UX", "leverage", "solutions"). Describe problems in customer terms ("tiny text on a phone", "shows a 'Not secure' warning") not tech terms. Be kind about their current site; never insult it.
5. ONE IDEA, ONE ASK. Pick the single most customer-visible observation and lead with it. Mention the offer in one sentence. End with one tiny, low-effort question (e.g. "Want me to send over a couple of quick ideas?"). Not "schedule a 30-min call".
6. SUBJECT: 2-5 words, specific to them (use their business name or what you noticed), natural capitalisation, no clickbait, no all caps, no question-mark spam.
7. SIGN OFF with just the sender's first name. Do NOT add address, unsubscribe line or signature; those are added automatically. If a portfolio link is provided, include it once, naturally.
8. VARY your openings; never reuse the example wording.

TWO STYLE REFERENCES (do not copy their wording):
Example A (no website listed)
Subject: Joe's Barbershop online
Hi there,

I was looking for a website for Joe's Barbershop and couldn't find one. People checking you out on their phone before they stop in might give up and go somewhere that's easier to find.

I build simple, fast sites for local shops: hours, photos, a tap-to-call button. Usually live in about a week.

Would it help if I sent over a quick idea of what yours could look like?

Sam

Example B (site not set up for phones)
Subject: Hartwell Auto on phones
Hi there,

I had a look at the Hartwell Auto website and noticed it isn't set up for phones, so the text and buttons come out tiny on a small screen. A lot of people look a shop up on their phone right before they call.

I do refreshes for local businesses that make the site easy to read on any device and easy for you to update. Happy to point out the two or three changes that'd matter most.

Open to me sending those over?

Sam`;

const TONES = {
  friendly: 'Warm, relaxed and neighborly. Sounds like a helpful local person.',
  casual: 'Very casual and short, like a quick text from a friendly person. Lowercase subject is fine.',
  direct: 'Straightforward and confident, minimal small talk, still polite.',
  professional: 'Polished and courteous, still plain-spoken. No stiffness or corporate buzzwords.',
};

// Choose the single most customer-visible thing to lead with
export function pickAngle(lead) {
  if (!lead.website) return { angle: 'no website', obs: "I couldn't find a website listed for this business." };
  const issues = lead.audit?.issues || [];
  if (!lead.audit) return { angle: 'has site, unaudited', obs: `They have a website (${lead.website}). I have NOT checked it, so do not claim any specific problem; offer a fresh look instead.` };
  const order = [
    [/mobile-friendly/i, "their website isn't set up for phones (text and buttons come out tiny)"],
    [/did not load|error \(HTTP/i, "their website didn't load when I tried it"],
    [/HTTPS/i, 'their website shows a "Not secure" warning in browsers'],
    [/Slow/i, 'their website is slow to load'],
    [/copyright/i, 'the website footer still shows an old year, so it looks unmaintained'],
    [/click-to-call|contact form/i, 'there is no easy way to call or message from the site'],
  ];
  for (const [re, text] of order) {
    const hit = issues.find((i) => re.test(i));
    if (hit) return { angle: 'site issue', obs: `Lead with this true finding: ${text}. (Audit said: "${hit}")` };
  }
  return { angle: 'decent site', obs: `Their site (${lead.website}) looks fine technically. Do not invent problems. Keep it light: offer a small refresh or a booking/contact improvement.` };
}

export async function draftEmail(env, lead, s, opts = {}) {
  const tone = TONES[opts.tone] ? opts.tone : TONES[s.tone] ? s.tone : 'friendly';
  const { angle, obs } = pickAngle(lead);
  const facts = [
    `Business name: ${lead.name}`,
    lead.category && `Type of business: ${lead.category}`,
    lead.address && `Location: ${lead.address}`,
    `Observation: ${obs}`,
    lead.audit?.issues?.length > 1 && `Other findings (use at most one, only if natural): ${lead.audit.issues.slice(0, 4).join('; ')}`,
    `Sender's offer (do not promise anything beyond this): ${s.offer}`,
    s.about && `About the sender (optional, one short mention at most): ${s.about}`,
    s.portfolioUrl && `Portfolio link (include once): ${s.portfolioUrl}`,
    `Sender first name for the sign-off: ${firstName(s.senderName) || 'the sender'}`,
    `Tone: ${TONES[tone]}`,
    opts.instructions && `Extra instructions from the sender: ${opts.instructions}`,
  ].filter(Boolean);

  const system =
    PLAYBOOK +
    '\n\nRespond with JSON only: {"subject": string, "alt_subjects": [string, string], "body": string}. ' +
    'The body starts with a greeting ("Hi there," unless a person\'s name is given) and ends with the first-name sign-off.';
  const out = await groqJson(env, [{ role: 'system', content: system }, { role: 'user', content: facts.join('\n') }], 0.85);
  if (!out.subject || !out.body) throw new Error('The AI returned an incomplete draft. Try again.');
  return {
    subject: String(out.subject).trim(),
    body: String(out.body).trim(),
    alts: (Array.isArray(out.alt_subjects) ? out.alt_subjects : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 3),
    angle,
  };
}

const REPLY_RULES = `REPLY & FOLLOW-UP RULES (freelance web developer writing to a local business owner):
- If they wrote back: answer exactly what they asked first, then offer one clear next step. 40-90 words. Warm, plain, human. No jargon.
- Never invent prices, timelines, policies or guarantees. Use ONLY the sender's knowledge notes below; if something isn't covered, say you'll confirm it or ask what they need.
- Scheduling: suggest they pick a time or offer to work around theirs; do not invent availability.
- If they said no / not interested: thank them in two short lines, no pushing, no "last chance". If they asked to stop: confirm briefly that they won't hear from you again.
- If there is no reply yet (follow-up): 30-60 words, add one new useful thing (a specific idea or fix), never guilt-trip, never "just bumping this".
- Same honesty rules as always: no fake urgency, no invented facts. Sign off with the sender's first name only.`;

export async function draftReply(env, lead, s, { theirReply = '', goal = '' } = {}) {
  const followUp = !theirReply.trim();
  const ctx = [
    `Business: ${lead.name}${lead.category ? ` (${lead.category})` : ''}`,
    lead.draft?.body && `Original email I sent them:\n${lead.draft.body.slice(0, 900)}`,
    followUp ? 'There is no reply yet. Write a follow-up.' : `Their reply:\n${theirReply.slice(0, 1500)}`,
    goal && `What the sender wants this email to do: ${goal}`,
    `Sender's offer: ${s.offer}`,
    s.knowledge && `Sender's knowledge notes (pricing, process, turnaround):\n${s.knowledge}`,
    `Tone: ${TONES[s.tone] || TONES.friendly}`,
    `Sender first name: ${firstName(s.senderName) || 'the sender'}`,
  ].filter(Boolean);
  const system =
    REPLY_RULES +
    '\n\nRespond with JSON only: {"subject": string (use "Re: ..." only when replying to their message), "body": string, ' +
    '"intent": one of "interested","question","pricing","scheduling","not_now","no","unsubscribe","other"}.';
  const out = await groqJson(env, [{ role: 'system', content: system }, { role: 'user', content: ctx.join('\n\n') }], 0.7);
  if (!out.body) throw new Error('The AI returned an incomplete reply. Try again.');
  return {
    subject: String(out.subject || (lead.draft?.subject ? 'Re: ' + lead.draft.subject.replace(/^re:\s*/i, '') : '')).trim(),
    body: String(out.body).trim(),
    intent: String(out.intent || 'other'),
  };
}

/* ------------------------------------------------------------------ */
/* Assistant: generic tool-calling loop. Tools are supplied by caller. */
/* ------------------------------------------------------------------ */
export async function runAgent(env, { system, messages, tools, maxSteps = 6 }) {
  const specs = Object.values(tools).map((t) => ({ type: 'function', function: t.spec }));
  const msgs = [{ role: 'system', content: system }, ...messages];
  const actions = [];
  let retriedBad = false;

  for (let step = 0; step < maxSteps; step++) {
    const r = await callGroq(env, { messages: msgs, tools: specs, tool_choice: 'auto', temperature: 0.6 });
    if (r.status === 400 && !retriedBad) {
      // Some models occasionally emit a malformed tool call; one retry usually fixes it.
      retriedBad = true;
      continue;
    }
    if (!r.ok) throw await groqError(r);
    const m = (await r.json()).choices?.[0]?.message || {};
    if (!m.tool_calls?.length) return { reply: (m.content || '').trim() || 'Done.', actions };

    msgs.push({ role: 'assistant', content: m.content || '', tool_calls: m.tool_calls });
    for (const tc of m.tool_calls) {
      const name = tc.function?.name;
      let args = {};
      try {
        args = JSON.parse(tc.function?.arguments || '{}');
      } catch {}
      let out;
      try {
        out = tools[name] ? await tools[name].run(args) : { error: 'Unknown tool ' + name };
      } catch (e) {
        out = { error: e.message || String(e) };
      }
      actions.push({ tool: name, args, ok: !out.error, note: out.error || out.note || '' });
      msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out).slice(0, 5000) });
    }
  }
  return { reply: "I hit my step limit for one message. Ask me to continue and I'll pick up where I stopped.", actions };
}
