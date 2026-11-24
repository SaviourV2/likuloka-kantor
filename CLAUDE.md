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
- Dompet (`/dompet`, `src/dompet/`): Kevin's personal finance. Telegram bot (secret `DOMPET_BOT_TOKEN`, webhook
  `/tele/dompet` outside Access, secret header + paired chat), Claude reads screenshots (`ANTHROPIC_API_KEY`),
  tables `dompet_*`, ops_settings `dompet_telegram` / `dompet_market`, cron 21:00 WITA recap. Details in README.
- Every push to `main` deploys via `.github/workflows/deploy.yml` (secrets CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID).

## Rules (from Kevin, always apply)
- The repo stays private. Never commit secrets. Kevin types tokens and passwords himself.
- Only kevinpersonalemail30@gmail.com may open the Kantor; money (payouts, booking values) stays here.
- Villa bookings never go into the website's agenda.
- Dompet data (Kevin's own money) stays in this repo's worker and Kevin's own Telegram chat; never on likuloka.com.
- Times are WITA (Asia/Makassar, UTC+8).
- Reply to Kevin in Indonesian; code comments and docs in English.
