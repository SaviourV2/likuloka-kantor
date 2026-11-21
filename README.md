# Kantor — kantor.likuloka.com

Kevin's office of Claude desks, with the Villa & Kahuna desk (booking calendar per villa, check-in / check-out,
availability, Bukit Vista payouts). See CLAUDE.md for how it works.

## One-time setup
1. **Repo secrets** (Settings → Secrets and variables → Actions): `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`,
   the same values as in `likuloka-web`.
2. **Cloudflare Access**: Zero Trust → Access → Applications → the application that protects `likuloka.com/admin`
   → Edit → *Add public hostname* → subdomain `kantor`, domain `likuloka.com`, path empty → Save. Same policy
   (Kevin's email, one-time PIN). The AUD tag in `wrangler.jsonc` stays the same.
3. Actions → *Deploy kantor.likuloka.com* → Run workflow. The worker adds the custom domain `kantor.likuloka.com`.

## Data
- ops_settings `kantor_status`: desks and cards, written by the routine "Liku Loka update harian" (step C).
- ops_settings `kantor_board`: Kevin's approvals, his own tasks and routines (this page).
- `villa_bookings`, `villa_payouts`, ops_settings `villa_sync`: written by the same routine (step D) from Gmail.
- Live cards are computed on each request from the main site's tables (read-only).

## Villa Manager (`/villa`) and staff page (`/tim/`)
Self-managed villas: calendar, bookings, date blocks, suggested prices, reviews, team tasks, money and payouts.
- Platforms (Airbnb, Booking.com, Agoda, ...) connect by iCal: paste the listing's export address into the app, and the
  app's "Untuk <platform>" address into the platform's calendar import. Only dates travel this way; the platforms do
  not offer chat, reviews, prices or payouts to a connection like this, so those are entered in the app (the guest
  detail links to the reservation / inbox on the platform).
- The app's calendar addresses use the worker's workers.dev hostname. The deploy workflow pings it once so the worker
  knows it; if the addresses do not appear, check that workers.dev is enabled for the account's Workers.
- Staff sign-in: Zero Trust -> Access -> Applications -> Add -> Self-hosted, hostname `kantor.likuloka.com`, path `tim`,
  policy Allow for the staff emails (one-time PIN). Paste that application's AUD tag in the app under
  "Tim & operasional". Staff are added there too; the worker lets in only listed emails.
