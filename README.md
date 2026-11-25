# Kantor — kantor.likuloka.com

Kevin's office of Claude desks, with the Villa & Kahuna desk (booking calendar per villa, check-in / check-out,
availability, Bukit Vista payouts) and the **Dompet** (`/dompet`, Kevin's personal finance with a Telegram bot).
See CLAUDE.md for how it works.

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

## Dompet (kantor.likuloka.com/dompet)
Personal finance for Kevin and Mey: spending sorted into *pos* (categories with a daily / weekly / monthly rhythm and
budget, each owned by 👥 Bersama, Kevin or Mey), income, Kevin's Bitcoin portfolio, BTC and IHSG prices, and daily
interest on Kevin's investments. Filled mostly from Telegram; the page is Kevin's only.

**Kevin & Mey**: one bot, three paired chats (Kevin's private chat, Mey's private chat, their group with the bot).
In the group, spending goes to Bersama pos unless clearly personal; in a private chat to the sender's own pos unless
it says bersama / berdua. Shared spending recorded in a private chat is announced in the group (or to the partner).
Both see everything; Bitcoin / investments / portfolio are Kevin's only. A pos of the other person is never used:
Mey's coffee goes to "Kopi & jajan Mey" if "Kopi & jajan" is Kevin's. Evening recaps go to each private chat.

**Telegram bot, one-time setup** (Kevin types the secrets himself):
1. Telegram → @BotFather → `/newbot`. A new bot, not the website's briefing bot (a webhook bot cannot also be polled).
2. Cloudflare → Workers & Pages → `likuloka-kantor` → Settings → Variables and Secrets → add secrets
   `DOMPET_BOT_TOKEN` (the bot token) and `ANTHROPIC_API_KEY` (same key as likuloka.com; reads screenshots).
   Optional, for the BTC price: `COINGECKO_API_KEY` (free Demo key from coingecko.com/en/api, recommended: the
   keyless API is often rate-limited on Cloudflare's shared IPs) and/or `CMC_API_KEY` (free Basic key from
   coinmarketcap.com/api). Order: CoinGecko → CoinMarketCap (if a key is set) → Indodax.
3. Zero Trust → Access → Applications → Add an application → Self-hosted → domain `kantor.likuloka.com`, path
   `tele/dompet` → policy action **Bypass**, include Everyone. Telegram cannot sign in; the worker checks the secret
   header Telegram sends (derived from the bot token) and answers only the paired chat.
4. kantor.likuloka.com/dompet → tab *Bot Telegram* → *Sambungkan* for Kevin, then Mey (send her the link), then
   the group (pair both private chats first). Send the shown `/start 123456`. The tab shows Telegram's last webhook
   error if step 3 is missing.
5. For the group: @BotFather → `/setprivacy` → the bot → **Disable** (else the bot only sees commands in groups);
   remove and re-add the bot to the group afterwards. In the group only messages that look like money (a number, a
   photo, a question word or @bot) go to Claude; ordinary chat is ignored.

**How it works**
- `src/dompet/telegram.js`: webhook `/tele/dompet`, pairing, commands (`/hari /minggu /bulan /pos /btc /ihsg /bunga
  /porto /batal /rekap /bantuan`), 🗑 / 🏷 buttons under every record, evening recap.
- `src/dompet/parse.js`: Claude reads text, photos, image files and PDF statements into expenses / income / BTC trades
  / investments / pos changes (structured output). The low-cost model reads first (more effort for images and PDFs);
  a decline, cut-off or unreadable answer is retried once on the stronger backup model (constants at the top). Screenshots are not stored; the Telegram file id is, and
  `/api/dompet/receipt/<id>` fetches it again from Telegram.
- `src/dompet/db.js`: tables `dompet_pos` (+ `owner`), `dompet_tx` (+ `member`), `dompet_btc`, `dompet_invest`,
  `dompet_prices` (schema.sql). Columns added after the first release are added at runtime by `ensureSchema`
  (D1 has no ADD COLUMN IF NOT EXISTS). Old pos belong to Kevin until changed on the page.
  Weeks start Monday, dates are WITA. BTC profit uses average cost.
- `src/dompet/invest.js`: interest per day = rate ÷ 365 on the principal (simple), or compounded daily / monthly,
  minus tax on interest; stops at maturity or when marked withdrawn (*cairkan*).
- `src/dompet/market.js`: BTC from CoinGecko (then CoinMarketCap with `CMC_API_KEY`, then Indodax), IHSG (^JKSE) from Yahoo Finance; cached 10 minutes
  in ops_settings `dompet_market`. Daily closes go to `dompet_prices` at 21:00 WITA.
- Cron `0 13 * * *` (21:00 WITA): recap to Telegram (switch off on the page) + price snapshot.

**Local test**: `.dev.vars` with `DEV_BYPASS_AUTH=1`; `TELEGRAM_API` and `ANTHROPIC_BASE_URL` can point at a mock server.
Run `npx wrangler dev --local-upstream localhost:8787` so the sign-in bypass sees `localhost`.
