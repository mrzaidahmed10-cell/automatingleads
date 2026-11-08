# Outreach (automatingleads)

Personal lead-finder and outreach dashboard for Cloudflare Pages.

- **Dashboard:** next-best actions, KPIs, 14-day activity chart, pipeline funnel, recent activity.
- **Leads:** find businesses near a city (no website, or a website to audit), edit emails inline, bulk audit / draft / send.
- **Audit:** scores how weak a site is (HTTPS, mobile viewport, old copyright, speed, layout) and pulls a contact email from it when possible.
- **AI openers:** Groq writes short, specific, honest cold emails using a built-in playbook (one true observation, plain words, one tiny ask), with tone choice and alternate subject lines.
- **Quick replies:** reply and follow-up composer with editable templates and an AI that answers pasted replies and suggests next status.
- **Analytics:** sends per day, reply rate, lead quality mix, which lead types and categories reply.
- **Assistant:** a chat that can search leads, find new ones, audit sites, write drafts, edit leads, and queue emails. It never sends on its own; you approve each email with one click.
- **Compliance built in:** every email gets your mailing address and a clickable Unsubscribe link (plus `List-Unsubscribe` headers). Unsubscribed addresses are blocked for good.

## Deploy

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick this repo.
2. Build command: *(none)*. **Build output directory: `public`** (recommended). Leaving it blank also works: the root `index.html` redirects to `/public/`.
3. After the first deploy, go to **Settings → Bindings → Add → KV namespace**. Create a namespace and bind it with the variable name **`LEADS`**.
4. **Settings → Variables and Secrets** (add as *Secret*):

| Name | Value |
|---|---|
| `DASH_PASSWORD` | Password for the dashboard |
| `GROQ_API_KEY` | Your Groq key (the app picks the best model your key can use) |
| `EMAIL_PROVIDER` | `resend` (default), `sendgrid`, or `gmail` |
| `EMAIL_API_KEY`, `EMAIL_FROM` | For Resend/SendGrid. `EMAIL_FROM` like `Zaid <zaid@yourdomain.com>` on a verified domain |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | For `EMAIL_PROVIDER=gmail` (Gmail always sends as your account) |
| `GROQ_MODEL` | optional, forces a specific Groq model |
| `UNSUB_SECRET` | optional, random string for unsubscribe links (defaults to the dashboard password) |

5. Redeploy (bindings and secrets apply on the next deployment), open the site, sign in, and fill **Settings** (name, mailing address, reply-to, your offer, and notes on pricing/process for the AI).

## Notes

- Keys never touch the browser. All API calls happen in `functions/`, behind a signed HTTP-only login cookie.
- Send a **test to yourself** from a lead's panel first and check it lands in the inbox.
- Start with a low daily limit (10-20) and set up SPF/DKIM/DMARC if you use your own domain.
- Lead data comes from OpenStreetMap, so coverage varies by town. Geocoding tries Open-Meteo then Nominatim, and the map query tries three servers.
- Sending uses the `gmail.send` scope only, so the app cannot read your inbox. Paste replies into the Quick replies page to have the AI answer them.
