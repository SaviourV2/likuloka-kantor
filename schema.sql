-- Tables owned by the Kantor worker (same D1 database `likuloka` as likuloka.com; that repo owns every other table).
-- Villa rentals (Kahuna, managed by Bukit Vista), written by Claude's scheduled run from Bukit Vista's emails
-- (src/ops/villa.js). Amounts are Kevin's only (/admin/kantor). agenda_in / agenda_out are unused (bookings stay out of the agenda).
CREATE TABLE IF NOT EXISTS villa_bookings (
  booking_id TEXT PRIMARY KEY,                   -- Bukit Vista / OTA booking id
  property   TEXT NOT NULL DEFAULT 'kahuna',
  unit       TEXT NOT NULL,                      -- "Villa 1" .. "Villa 4"
  guest      TEXT NOT NULL,
  guests     INTEGER,
  check_in   TEXT NOT NULL,                      -- YYYY-MM-DD
  check_out  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'confirmed',  -- confirmed | cancelled | ...
  total      INTEGER,                            -- booking value in rupiah, from the email
  source     TEXT NOT NULL DEFAULT 'bukitvista',
  email_id   TEXT,
  email_date TEXT,                               -- the latest email wins
  updated_at TEXT NOT NULL,
  agenda_in  INTEGER,
  agenda_out INTEGER
);
CREATE INDEX IF NOT EXISTS villa_bookings_in ON villa_bookings (check_in);
-- Payouts Bukit Vista scheduled (no bank details are stored).
CREATE TABLE IF NOT EXISTS villa_payouts (
  email_id      TEXT PRIMARY KEY,
  booking_id    TEXT,
  unit_code     TEXT,                            -- Bukit Vista unit id, e.g. UN3348
  guest         TEXT,
  amount        INTEGER NOT NULL,
  expected_date TEXT,                            -- YYYY-MM-DD the money should land
  email_date    TEXT NOT NULL
);

-- Dompet: personal finance of Kevin and Mey (Telegram bot; the /dompet page is Kevin's only, KANTOR_EMAILS).
-- Amounts are whole rupiah. Dates are YYYY-MM-DD in WITA.
CREATE TABLE IF NOT EXISTS dompet_pos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,               -- "Makan", "Transport", "Sewa"
  emoji      TEXT,
  period     TEXT NOT NULL DEFAULT 'monthly',    -- daily | weekly | monthly: the rhythm of this spending and its budget
  budget     INTEGER,                            -- rupiah per period; NULL = no budget
  archived   INTEGER NOT NULL DEFAULT 0,
  owner      TEXT NOT NULL DEFAULT 'kevin',      -- bersama | kevin | mey (added later: src/dompet/db.js ensureSchema)
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dompet_tx (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL DEFAULT 'expense',   -- expense | income
  date        TEXT NOT NULL,
  amount      INTEGER NOT NULL,                  -- always positive
  pos_id      INTEGER,                           -- dompet_pos.id (expenses)
  merchant    TEXT,
  note        TEXT,
  account     TEXT,                              -- BCA, cash, GoPay ... as read from the screenshot or message
  source      TEXT NOT NULL DEFAULT 'web',       -- telegram_text | telegram_photo | telegram_file | web
  tg_file_id  TEXT,                              -- Telegram file of the screenshot (fetched again on demand; not stored here)
  tg_chat_msg INTEGER,
  fingerprint TEXT,                              -- date|amount|merchant, to flag likely duplicates
  member      TEXT,                              -- kevin | mey: who recorded it (added later, see ensureSchema)
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS dompet_tx_date ON dompet_tx (date);
CREATE INDEX IF NOT EXISTS dompet_tx_fp ON dompet_tx (fingerprint);
-- Bitcoin buys and sells. idr = rupiah paid (buy) or received (sell), fees included.
CREATE TABLE IF NOT EXISTS dompet_btc (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  side       TEXT NOT NULL,                      -- buy | sell
  btc        REAL NOT NULL,
  idr        INTEGER NOT NULL,
  exchange   TEXT,
  note       TEXT,
  source     TEXT NOT NULL DEFAULT 'web',
  created_at TEXT NOT NULL
);
-- Interest-bearing investments (deposito, reksa dana pasar uang, obligasi/SBN, P2P, tabungan).
-- Interest accrues per day from start_date; see src/dompet/invest.js.
CREATE TABLE IF NOT EXISTS dompet_invest (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'deposito',
  principal   INTEGER NOT NULL,
  rate_pa     REAL NOT NULL,                     -- % per year
  compounding TEXT NOT NULL DEFAULT 'simple',    -- simple | daily | monthly
  tax_pct     REAL NOT NULL DEFAULT 0,           -- tax on interest, e.g. 20 for deposito
  start_date  TEXT NOT NULL,
  end_date    TEXT,                              -- maturity; interest stops here
  closed_at   TEXT,                              -- withdrawn; interest stops here
  note        TEXT,
  source      TEXT NOT NULL DEFAULT 'web',
  created_at  TEXT NOT NULL
);
-- Daily closes kept by the evening run, for history when a price source is down. symbol: BTCIDR | BTCUSD | IHSG | PORTO
CREATE TABLE IF NOT EXISTS dompet_prices (
  date   TEXT NOT NULL,
  symbol TEXT NOT NULL,
  close  REAL NOT NULL,
  PRIMARY KEY (date, symbol)
);
