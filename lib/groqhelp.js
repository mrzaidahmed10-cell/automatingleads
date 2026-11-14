// Groq as a second opinion for hard leads. It only ever picks from real search results (never invents a URL),
// and its pick still has to load and mention the business before we believe it.
import { groqJson } from './ai.js';

export const aiOn = (env) => !!String(env.GROQ_API_KEY || '').trim() && String(env.AI_LEADS || '').toLowerCase() !== 'off';

// candidates: [{url, title, snippet}]. Returns the chosen candidate or null.
export async function pickOfficialSite(env, lead, city, candidates) {
  if (!aiOn(env) || !candidates.length) return null;
  const list = candidates.slice(0, 5).map((c, i) => `${i + 1}. ${c.url}\n   ${String(c.title).slice(0, 120)}\n   ${String(c.snippet).slice(0, 200)}`).join('\n');
  const out = await groqJson(env, [
    { role: 'system', content: 'You decide whether a web search result is the OFFICIAL website of a specific local business. Directories, review sites, social media, news and different businesses with similar names do NOT count. Reply with JSON only: {"index": <number or null>, "why": "<short reason>"}. Use null unless you are fairly sure.' },
    { role: 'user', content: `Business: ${lead.name}\nCity: ${city || lead.address || ''}\nPhone: ${lead.phone || 'unknown'}\n\nResults:\n${list}` },
  ], 0.1);
  const i = Number(out?.index);
  if (!Number.isInteger(i) || i < 1 || i > Math.min(5, candidates.length)) return null;
  return { ...candidates[i - 1], why: String(out.why || '').slice(0, 140) };
}
