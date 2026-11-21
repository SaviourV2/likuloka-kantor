# Liku Loka — Kantor (kantor.likuloka.com)

Kevin's office of Claude desks (mochi slimes) and the Villa & Kahuna desk. Its own Cloudflare Worker
`likuloka-kantor`, on the same D1 database `likuloka` as the main site (repo `SaviourV2/likuloka-web`).

## How it runs
- `src/worker.js`: Access check (only `KANTOR_EMAILS`), `GET /api/status` (desks, board, live cards, villa),
  `POST /api/card` (approve / review / reopen / add task / routines). `public/index.html` is the office page.
- Live cards read the main site's tables (field_reports, journal, projects, ops_settings `jurnal_sheet`, `worker_env`)
  read-only and link to https://likuloka.com/admin/… pages.
- This repo owns: ops_settings `kantor_status` (written by Claude's daily routine), `kantor_board` (Kevin's clicks),
  `villa_sync`, and the tables in `schema.sql` (`villa_bookings`, `villa_payouts`). Never change the main site's tables
  from here.
- Villa Manager (`/villa`, `public/villa.html` + `public/villa-app.js`, `src/rental.js`, `GET/POST /api/villa`): villas
  Kevin rents out himself, without Bukit Vista; separate from Kahuna. Side menu: home, calendar, bookings, prices
  (area average x season x weekend), reviews, team, money (progress, payouts, guest charges, ledger), villas & platforms.
  Tables `vr_*` in `schema.sql`; settings in ops_settings `villa_config` (targets, payout rules, SOP steps, staff AUD).
- Staff page (`/tim/`, `public/tim/index.html`, `src/team.js`, `/tim/api`): staff listed in `vr_staff` sign in with their
  own email through a separate Cloudflare Access application for the path `/tim` (its AUD tag is saved from the app).
  They mark a villa ready, do the checkout inspection (findings become `vr_charges` at the SOP price), finish
  maintenance, report problems. The staff API never returns booking values, payouts, contacts or the ledger.
- Platform sync is iCal both ways: the `*/30` cron reads each listing's calendar into `vr_ical_events`, and
  `/ical/<token>/<villa>/<platform>.ics` (no sign-in, dates only, token in ops_settings `villa_ical`) is what the
  platforms import. That feed is served on the worker's workers.dev hostname, because Access covers kantor.likuloka.com.
- Villa bookings / payouts come from Bukit Vista's emails, written by the routine "Liku Loka update harian" (step D).
- Every push to `main` deploys via `.github/workflows/deploy.yml` (secrets CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID).

## Rules (from Kevin, always apply)
- The repo stays private. Never commit secrets. Kevin types tokens and passwords himself.
- Only kevinpersonalemail30@gmail.com may open the Kantor; money (payouts, booking values) stays here. The one exception
  Kevin asked for: villa staff he lists in the app may open `/tim` only, which shows no money.
- Villa bookings never go into the website's agenda.
- Times are WITA (Asia/Makassar, UTC+8).
- Reply to Kevin in Indonesian; code comments and docs in English.
