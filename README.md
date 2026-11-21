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

## Villa Manager (`/villa`)
Self-managed villas: bookings, a month calendar per villa, date blocks (private use, maintenance), income and expenses.
- Add a villa, then per platform (Airbnb, Booking.com, Agoda, ...): paste the listing's iCal export address into the
  app, and paste the app's "Untuk <platform>" address into the platform's calendar import.
- The app's addresses use the worker's workers.dev hostname. The deploy workflow pings it once so the worker knows it;
  if the addresses do not appear, check that workers.dev is enabled for the account's Workers.
- Platforms re-read imported calendars on their own schedule (hours, not seconds).
