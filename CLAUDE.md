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
- Villa bookings / payouts come from Bukit Vista's emails, written by the routine "Liku Loka update harian" (step D).
- Every push to `main` deploys via `.github/workflows/deploy.yml` (secrets CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID).

## Rules (from Kevin, always apply)
- The repo stays private. Never commit secrets. Kevin types tokens and passwords himself.
- Only kevinpersonalemail30@gmail.com may open the Kantor; money (payouts, booking values) stays here.
- Villa bookings never go into the website's agenda.
- Times are WITA (Asia/Makassar, UTC+8).
- Reply to Kevin in Indonesian; code comments and docs in English.
