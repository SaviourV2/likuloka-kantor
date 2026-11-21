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

-- Villa Manager (/villa, src/rental.js): villas Kevin rents out himself, without Bukit Vista. Separate from Kahuna above.
CREATE TABLE IF NOT EXISTS vr_villas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  note       TEXT,
  active     INTEGER NOT NULL DEFAULT 1,         -- 0 = archived (its bookings and money entries stay)
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
-- Bookings entered in the app (direct guests, or a platform reservation completed with name and value).
CREATE TABLE IF NOT EXISTS vr_bookings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  villa_id   INTEGER NOT NULL,
  guest      TEXT NOT NULL,
  guests     INTEGER,
  contact    TEXT,
  check_in   TEXT NOT NULL,                      -- YYYY-MM-DD
  check_out  TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'langsung',   -- langsung | airbnb | booking | agoda | ...
  total      INTEGER,                            -- booking value in rupiah (income, counted in the check-in month)
  status     TEXT NOT NULL DEFAULT 'confirmed',  -- confirmed | cancelled
  note       TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vr_bookings_in ON vr_bookings (villa_id, check_in);
-- Dates closed from the app (private use, maintenance). end_date is exclusive, like a check-out.
CREATE TABLE IF NOT EXISTS vr_blocks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  villa_id   INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'pribadi',    -- pribadi | maintenance | lainnya
  note       TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
-- A platform listing's iCal export address, read by the cron. The address is private (it shows the calendar).
CREATE TABLE IF NOT EXISTS vr_feeds (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  villa_id   INTEGER NOT NULL,
  platform   TEXT NOT NULL,
  url        TEXT NOT NULL,
  last_sync  TEXT,
  last_try   TEXT,
  last_error TEXT,
  last_count INTEGER,
  created_at TEXT NOT NULL
);
-- Events read from those calendars: reservations and dates the platform shows as closed.
CREATE TABLE IF NOT EXISTS vr_ical_events (
  feed_id    INTEGER NOT NULL,
  uid        TEXT NOT NULL,
  villa_id   INTEGER NOT NULL,
  platform   TEXT NOT NULL,
  summary    TEXT,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'reserved',   -- reserved | blocked
  PRIMARY KEY (feed_id, uid)
);
CREATE INDEX IF NOT EXISTS vr_ical_villa ON vr_ical_events (villa_id, start_date);
-- Income other than bookings, and expenses.
CREATE TABLE IF NOT EXISTS vr_ledger (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  type       TEXT NOT NULL,                      -- in | out
  category   TEXT NOT NULL,
  villa_id   INTEGER,                            -- NULL = all villas / general
  amount     INTEGER NOT NULL,                   -- rupiah
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vr_ledger_date ON vr_ledger (date);
