// All Groq-powered features: cold-email drafting, reply helper, and the tool-using assistant.
// Every call walks a chain of models, so one retired / rate-limited / misbehaving model never breaks the app.
const PREFERRED = [
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'openai/gpt-oss-20b',
  'llama-3.1-8b-instant',
];
const SKIP = /whisper|guard|tts|playai|orpheus|safeguard|compound|embed|moderation/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';

const mem = { models: null, at: 0, bad: new Map() };
const key = (env) => String(env.GROQ_API_KEY || '').trim();

async function listModels(env, force = false) {
  if (!force && mem.models && Date.now() - mem.at < 300000) return mem.models;
  const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { authorization: `Bearer ${key(env)}` } });
  if (r.status === 401) throw new Error('Groq rejected the API key. Check the GROQ_API_KEY secret.');
  if (!r.ok) throw new Error('Could not list Groq models (HTTP ' + r.status + ')');
  mem.models = ((await r.json()).data || []).map((m) => m.id);
  mem.at = Date.now();
  return mem.models;
}

async function candidates(env) {
  let avail = [];
  try {
    avail = await listModels(env);
  } catch (e) {
    if (/rejected the API key/.test(e.message)) throw e;
  }
  const wanted = [String(env.GROQ_MODEL || '').trim(), ...PREFERRED].filter(Boolean);
  let chain = avail.length ? [...wanted.filter((m) => avail.includes(m)), ...avail.filter((m) => !wanted.includes(m) && !SKIP.test(m))] : wanted;
  if (!chain.length) chain = wanted;
  const now = Date.now();
  const ok = chain.filter((m) => (mem.bad.get(m) || 0) < now);
  return (ok.length ? ok : chain).slice(0, 5);
}

const post = (env, body) =>
  fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key(env)}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

// Some models emit tool calls in their own text format and Groq rejects them with "tool_use_failed".
// The attempted call is included in the error, so we can recover it.
function recoverCalls(text) {
  const m = String(text || '').match(/<function=([\w.\-]+)[^{]*(\{[\s\S]*\})/);
  if (!m) return null;
  try {
    const args = JSON.parse(m[2]);
    return [{ id: 'rec_' + Math.random().toString(36).slice(2, 8), type: 'function', function: { name: m[1].replace(/^functions?\./, ''), arguments: JSON.stringify(args) } }];
  } catch {
    return null;
  }
}

function groqError(l) {
  if (!l) return new Error('No Groq model is available to your key.');
  let msg = '';
  try {
    msg = JSON.parse(l.text).error?.message || '';
  } catch {}
  msg = (msg || l.text || '').slice(0, 220);
  if (l.status === 401) return new Error('Groq rejected the API key. Check the GROQ_API_KEY secret.');
  if (l.status === 429) return new Error('Groq rate limit reached on every available model. Wait a minute and try again. (' + msg + ')');
  return new Error(`Groq error ${l.status} (${l.model}): ${msg}`);
}

// Returns { data, model } from the first model that works.
async function chatOnce(env, payload) {
  const chain = await candidates(env);
  let last = null;
  for (const model of chain) {
    const body = { model, ...payload };
    if (/^openai\/gpt-oss/.test(model)) body.reasoning_effort = 'low';
    let r = await post(env, body);
    if (r.status === 429) {
      await sleep(Math.min(parseFloat(r.headers.get('retry-after') || '2') || 2, 4) * 1000);
      r = await post(env, body);
    }
    if (r.ok) return { data: await r.json(), model };
    let txt = await r.text();

    if (r.status === 400 && /tool_use_failed/.test(txt) && payload.tools) {
      let fg = '';
      try {
        fg = JSON.parse(txt).error?.failed_generation || '';
      } catch {}
      const calls = recoverCalls(fg);
      if (calls) return { data: { choices: [{ message: { content: '', tool_calls: calls } }] }, model };
    } else if (r.status === 400) {
      // Maybe this model dislikes an optional parameter. Retry with the bare minimum.
      const lean = { model, messages: payload.messages, temperature: payload.temperature };
      if (payload.tools) Object.assign(lean, { tools: payload.tools, tool_choice: payload.tool_choice });
      const r2 = await post(env, lean);
      if (r2.ok) return { data: await r2.json(), model };
      r = r2;
      txt = await r2.text();
    }

    last = { status: r.status, text: txt, model };
    if (r.status === 401) break;
    mem.bad.set(model, Date.now() + (r.status === 404 || /decommission|not.?found|access/i.test(txt) ? 3600e3 : 60e3));
  }
  throw groqError(last);
}

// Strip the typographic habits that make text look machine-written
export function humanize(s) {
  return String(s || '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*([.!?])/g, '$1')
    .trim();
}
const cleanSubject = (s) => humanize(s).replace(/^["']+|["']+$/g, '').replace(/[.!]+$/, '');

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
  let lastErr;
  for (let i = 0; i < 2; i++) {
    const { data } = await chatOnce(env, { messages, temperature: i ? 0.4 : temperature, response_format: { type: 'json_object' }, max_completion_tokens: 1500 });
    try {
      return parseLoose(data.choices?.[0]?.message?.content || '');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// Used by the Settings "Test AI" button
export async function testAI(env) {
  const out = { models: [], chain: [], ok: false, tools: null };
  try {
    out.models = await listModels(env, true);
  } catch (e) {
    out.modelsError = e.message;
    if (/rejected/.test(e.message)) {
      out.error = e.message;
      return out;
    }
  }
  try {
    out.chain = await candidates(env);
  } catch {}
  try {
    const { model } = await chatOnce(env, { messages: [{ role: 'user', content: 'Reply with JSON like {"ok": true}' }], response_format: { type: 'json_object' }, max_completion_tokens: 60, temperature: 0 });
    out.ok = true;
    out.model = model;
  } catch (e) {
    out.error = e.message;
    return out;
  }
  try {
    const { data } = await chatOnce(env, {
      messages: [{ role: 'user', content: 'Call the ping tool.' }],
      tools: [{ type: 'function', function: { name: 'ping', description: 'Returns pong', parameters: { type: 'object', properties: {} } } }],
      tool_choice: 'auto',
      max_completion_tokens: 80,
      temperature: 0,
    });
    out.tools = !!data.choices?.[0]?.message?.tool_calls?.length;
  } catch (e) {
    out.tools = false;
    out.toolsError = e.message;
  }
  return out;
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
7. SIGN OFF with just the sender's first name. Do NOT add a signature block, address or any footer; those are handled separately. Do NOT put any links or URLs in a first email (links hurt deliverability); if it helps, offer to send examples instead.
8. VARY your openings; never reuse the example wording.
9. WRITE LIKE A REAL PERSON TYPING, NOT LIKE AI. No em dashes or en dashes (use a comma or a new sentence). No "I hope this finds you well", "reach out", "touch base", "circle back", "game-changer", "elevate", "boost", "streamline", "stand out", "in today's digital world", "take your business to the next level", "I'd love to", "excited to". No lists of three. No colon-led setups. Don't start every sentence with "I". Slightly uneven rhythm is good: one short sentence is fine. Sign off with just the first name, or "Thanks," then the name. Never "Best regards", "Sincerely", "Kind regards".
10. NOTHING THAT LOOKS LIKE MASS MAIL OR SPAM. No "free", "guarantee", "act now", "limited time", "discount", "special offer", "100%", "click here", no exclamation marks, no ALL CAPS words, no numbers-as-hooks, no mention of unsubscribing or opting out. It must read as one person writing to one business.

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
    s.businessName && `Sender's agency name: ${s.businessName} (mention it at most once, only if it fits naturally, never as a slogan or sign-off)`,
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
    subject: cleanSubject(out.subject),
    body: humanize(out.body),
    alts: (Array.isArray(out.alt_subjects) ? out.alt_subjects : []).map(cleanSubject).filter(Boolean).slice(0, 3),
    angle,
  };
}

const REPLY_RULES = `REPLY & FOLLOW-UP RULES (freelance web developer writing to a local business owner):
- If they wrote back: answer exactly what they asked first, then offer one clear next step. 40-90 words. Warm, plain, human. No jargon.
- Never invent prices, timelines, policies or guarantees. Use ONLY the sender's knowledge notes below; if something isn't covered, say you'll confirm it or ask what they need.
- Scheduling: suggest they pick a time or offer to work around theirs; do not invent availability.
- If they said no / not interested: thank them in two short lines, no pushing, no "last chance". If they asked to stop: confirm briefly that they won't hear from you again.
- If there is no reply yet (follow-up): 30-60 words, add one new useful thing (a specific idea or fix), never guilt-trip, never "just bumping this".
- Same honesty rules as always: no fake urgency, no invented facts. Sign off with the sender's first name only.
- Sound like a real person typing: no em dashes or en dashes, no corporate phrases ("reach out", "touch base", "circle back", "excited to"), no exclamation-mark pile-ups, never mention unsubscribing.`;

export async function draftReply(env, lead, s, { theirReply = '', goal = '' } = {}) {
  const followUp = !theirReply.trim();
  const ctx = [
    `Business: ${lead.name}${lead.category ? ` (${lead.category})` : ''}`,
    lead.draft?.body && `Original email I sent them:\n${lead.draft.body.slice(0, 900)}`,
    followUp ? 'There is no reply yet. Write a follow-up.' : `Their reply:\n${theirReply.slice(0, 1500)}`,
    goal && `What the sender wants this email to do: ${goal}`,
    `Sender's offer: ${s.offer}`,
    s.portfolioUrl && `Portfolio link (may be included once if they ask for examples): ${s.portfolioUrl}`,
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
    subject: cleanSubject(out.subject || (lead.draft?.subject ? 'Re: ' + lead.draft.subject.replace(/^re:\s*/i, '') : '')),
    body: humanize(out.body),
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

  try {
    for (let step = 0; step < maxSteps; step++) {
      const { data } = await chatOnce(env, { messages: msgs, tools: specs, tool_choice: 'auto', temperature: 0.5, max_completion_tokens: 1500 });
      const m = data.choices?.[0]?.message || {};
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
          out = tools[name] ? await tools[name].run(args || {}) : { error: 'Unknown tool ' + name };
        } catch (e) {
          out = { error: e.message || String(e) };
        }
        actions.push({ tool: name, args, ok: !out.error, note: out.error || out.note || '' });
        msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out).slice(0, 5000) });
      }
    }
    return { reply: "I hit my step limit for one message. Ask me to continue and I'll pick up where I stopped.", actions };
  } catch (e) {
    if (actions.length) return { reply: `I ran into a problem partway through: ${e.message}`, actions };
    // Tools unavailable on every model: still answer, but say nothing was changed.
    const { data } = await chatOnce(env, { messages: msgs, temperature: 0.6, max_completion_tokens: 1200 });
    const text = (data.choices?.[0]?.message?.content || '').trim() || 'Sorry, I could not come up with an answer.';
    return { reply: text + '\n\n(Heads up: tools were unavailable for that message, so I did not change anything in your dashboard.)', actions };
  }
}
