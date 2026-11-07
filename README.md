# Outreach (automatingleads)

Personal lead-finder and outreach dashboard for Cloudflare Pages.

- **Find leads**: businesses near a city with no website (or a website to audit), from OpenStreetMap. No API key needed.
- **Audit**: scores how weak a site is (HTTPS, mobile viewport, old copyright, speed, layout) and pulls a contact email from the site when it can.
- **Draft**: Groq writes a short, specific email per lead. You can edit before sending.
- **Send**: through your email API, one lead at a time or in bulk, with a daily cap.
- **Compliance built in**: every email gets your mailing address and a one-click unsubscribe link (also sent as `List-Unsubscribe` headers). Unsubscribed addresses are blocked forever.

Replies go to your reply-to address; you handle the sequence from there. Mark leads Replied / Skipped in the dashboard.

## Deploy

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick this repo.
2. Build command: *(none)*. **Build output directory: `public`**.
3. After the first deploy, go to **Settings → Bindings → Add → KV namespace**. Create a namespace and bind it with the variable name **`LEADS`**.
4. **Settings → Variables and Secrets** (add as *Secret*):

| Name | Value |
|---|---|
| `DASH_PASSWORD` | Password for the dashboard |
| `GROQ_API_KEY` | Your Groq key |
| `EMAIL_API_KEY` | Your email provider's API key |
| `EMAIL_FROM` | e.g. `Zaid <zaid@yourdomain.com>` (must be a verified sending domain) |
| `EMAIL_PROVIDER` | optional: `resend` (default) or `sendgrid` |
| `GROQ_MODEL` | optional, default `llama-3.3-70b-versatile` |
| `UNSUB_SECRET` | optional, random string for unsubscribe links (defaults to the dashboard password) |

5. Redeploy (bindings and secrets apply on the next deployment), open the site, sign in, and fill **Settings** (name, mailing address, reply-to).

## Notes

- Keys never touch the browser. All API calls happen in `functions/`, behind a signed HTTP-only login cookie.
- Send a **test to yourself** from a lead's panel first and check it lands in the inbox.
- Start with a low daily limit (10-20) on a new sending domain, and set up SPF/DKIM/DMARC with your email provider.
- Lead data comes from OpenStreetMap, so coverage varies. Many no-website businesses have no email listed; add one manually or use the phone number.
