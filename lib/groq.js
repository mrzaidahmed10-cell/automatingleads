export async function draftEmail(env, lead, s) {
  const facts = [`Business: ${lead.name}`];
  if (lead.category) facts.push(`Type: ${lead.category}`);
  if (lead.address) facts.push(`Location: ${lead.address}`);
  if (!lead.website) {
    facts.push('Observation: I could not find a website for this business in public listings.');
  } else if (lead.audit?.issues?.length) {
    facts.push('Website observations (only mention one or two, in plain language): ' + lead.audit.issues.slice(0, 3).join('; '));
  } else {
    facts.push(`They have a website (${lead.website}) that could use a refresh.`);
  }
  facts.push(`My offer: ${s.offer}`);
  if (s.portfolioUrl) facts.push(`My portfolio link (include it once): ${s.portfolioUrl}`);
  facts.push(`My name: ${s.senderName || 'the sender'}`);

  const system =
    'You write short cold emails from a freelance web developer to a local small business owner. ' +
    'Rules: plain text, 70-110 words, friendly and specific, no hype, no emojis, no invented facts, ' +
    'never claim to have visited in person or to be a customer. Mention one concrete observation from the facts. ' +
    'End with one low-pressure call to action (reply, or a quick call). Greet with "Hi there," . ' +
    'Do not add a signature block, unsubscribe line or address; sign off with just the first name. ' +
    'Respond with JSON only: {"subject": string (max 7 words, no clickbait, no all caps), "body": string}.';

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.GROQ_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: facts.join('\n') },
      ],
    }),
  });
  if (!r.ok) throw new Error('Groq error ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  let out;
  try {
    out = JSON.parse(j.choices[0].message.content);
  } catch {
    throw new Error('Groq returned an unreadable draft, try again.');
  }
  if (!out.subject || !out.body) throw new Error('Groq returned an incomplete draft, try again.');
  return { subject: String(out.subject).trim(), body: String(out.body).trim() };
}
