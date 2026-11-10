# FlightLine (automatingleads)

Personal lead-finder and outreach dashboard for Cloudflare Pages.

- **Dashboard:** next-best actions, KPIs, 14-day activity chart, pipeline funnel, recent activity.
- **Leads:** find businesses near a city (no website, or a website to audit), edit emails inline, bulk audit / draft / send.
- **Audit:** scores how weak a site is (HTTPS, mobile viewport, old copyright, speed, layout) and pulls a contact email from it when possible.
- **AI openers:** Groq writes short, specific, honest cold emails using a built-in playbook (one true observation, plain words, one tiny ask), with tone choice and alternate subject lines.
- **Quick replies:** reply and follow-up composer with editable templates and an AI that answers pasted replies and suggests next status.
- **Analytics:** sends per day, reply rate, lead quality mix, which lead types and categories reply.
- **Assistant:** a chat that can search leads, find new ones, audit sites, write drafts, edit leads, and queue emails. It never sends on its own; you approve each email with one click.
- **Plain-text emails:** sent exactly as you write them. No footer, no unsubscribe link or headers, no tracking, no HTML. Bulk sends go out 15-40 seconds apart. Leads marked "Do not contact" are never emailed.

## Look and feel
The controls (top bar tools, mobile tab bar, search, segmented switches) are real [Glisse](https://github.com/0kzh/glisse) components by Kelvin Zhang (MIT), bundled into `public/glass.js`. Cards, sidebar and dialogs use the same glass material. Chromium browsers get true refraction, others get frosted glass. If `glass.js` ever fails to load, the dashboard falls back to plain controls.
Rebuild only if you edit `glass-src/entry.jsx`: `cd glass-src && npm install && npm run build`. Cloudflare does not need to build anything.

## Lead finder
Searches OpenStreetMap (and Google Places if you add a key). The server asks every map mirror at once and takes the first answer, then falls back to a second source. If the server still cannot reach the map, your browser runs the search itself and the dashboard saves the results. There is no send cap by default. Daily cap and the gap between bulk sends are optional in Settings.

**Verification.** OpenStreetMap often has no website tag for businesses that do have one, so "no website" in the map data is only a hint. After a search, FlightLine checks each result: it tries likely domains from the business name, then does a web search, and only accepts a page that matches the business (name plus phone, street or city). Parked pages are ignored. Results:
- **No website ✓ verified**: nothing found. Marked **Hot**.
- **Social page only**: just Facebook/Instagram etc. Marked **Hot**.
- **Found online**: the site is saved to the lead and audited.
Use **Verify websites** on the Leads page to re-check any leads, and the **Unchecked** and **Hot** filters to sort them. Searches are checked in small batches because Cloudflare's free plan limits outbound requests per call.

Optional secrets that improve results: `GOOGLE_PLACES_KEY` (many more businesses, with ratings and review counts; Google may require billing) and `BRAVE_API_KEY` (more reliable web search than the default, which can get blocked on shared server IPs).

**Deleting leads.** Tick rows (shift-click selects a range, the header box selects all), or use **Select…** for presets such as "no website" or "poor sites". Press Delete or use the bar to remove them. The dialog has a "don't bring these back when I search again" option, and **Undo** restores them for about an hour. The trash icon on a row deletes just that one.

## Security
- Sign-in sets a signed, HttpOnly, SameSite=Strict `__Host-` cookie that expires in 7 days. "Sign out of all devices" (Settings) revokes every session.
- Wrong passwords lock the sign-in per IP (5 tries, then 15 min, doubling).
- Every write needs a same-origin request plus a custom header, which blocks cross-site attacks. Strict CSP, no inline scripts, HSTS, no framing.
- The site auditor refuses private, local and non-web addresses (SSRF guard). Inputs and list sizes are capped.
- Use a DASH_PASSWORD of 12+ characters. Optionally set a separate `SESSION_SECRET`. Keep keys only in Cloudflare secrets.
- The app is installable: use "Add to Home Screen" / "Install app".

## Deploy

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick this repo.
2. Build command: *(none)*. **Build output directory: `public`** (recommended). Leaving it blank also works: the root `index.html` redirects to `/public/`.
3. After the first deploy, go to **Settings → Bindings → Add → KV namespace**. Create a namespace and bind it with the variable name **`LEADS`**.
4. **Settings → Variables and Secrets** (add as *Secret*):

| Name | Value |
|---|---|
| `DASH_PASSWORD` | Password for the dashboard |
| `GROQ_API_KEY` | Your Groq key. The AI walks a chain of models, so a retired or rate-limited one is skipped automatically |
| `EMAIL_PROVIDER` | `resend` (default), `sendgrid`, or `gmail` |
| `EMAIL_API_KEY`, `EMAIL_FROM` | For Resend/SendGrid. `EMAIL_FROM` like `Zaid <zaid@yourdomain.com>` on a verified domain |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | For `EMAIL_PROVIDER=gmail` (Gmail always sends as your account) |
| `GROQ_MODEL` | optional, forces a specific Groq model |
| `GOOGLE_PLACES_KEY`, `BRAVE_API_KEY` | optional, see Lead finder |

5. Redeploy (bindings and secrets apply on the next deployment), open the site, sign in, and fill **Settings** (name, your email, your offer, and notes on pricing/process for the AI). Use **Settings → Test AI** to confirm Groq works and see which models your key can use.

## Notes

- Keys never touch the browser. All API calls happen in `functions/`, behind a signed HTTP-only login cookie.
- Send a **test to yourself** from a lead's panel first and check it lands in the inbox.
- Start with a low daily limit (10-20) and set up SPF/DKIM/DMARC if you use your own domain.
- Lead data comes from OpenStreetMap, so coverage varies by town. Geocoding tries Open-Meteo then Nominatim, and the map query tries three servers.
- Sending uses the `gmail.send` scope only, so the app cannot read your inbox. Paste replies into the Quick replies page to have the AI answer them.
