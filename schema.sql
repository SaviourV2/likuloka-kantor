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

-- Villa Manager (/villa, src/rental.js; staff page /tim, src/team.js): villas Kevin rents out himself, without
-- Bukit Vista. Separate from Kahuna above.
CREATE TABLE IF NOT EXISTS vr_villas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  note         TEXT,
  area         TEXT,                               -- e.g. "Canggu": links the villa to vr_market
  base_price   INTEGER,                            -- normal nightly price in rupiah (used when the area has no market figure)
  min_price    INTEGER,                            -- never suggest below this
  weekend_pct  INTEGER NOT NULL DEFAULT 0,         -- Friday and Saturday nights, percent on top
  position_pct INTEGER NOT NULL DEFAULT 0,         -- how far above (+) or below (-) the area average this villa sits
  active       INTEGER NOT NULL DEFAULT 1,         -- 0 = archived (its bookings and money entries stay)
  sort         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
-- Bookings entered in the app (direct guests, or a platform reservation completed with name and value).
CREATE TABLE IF NOT EXISTS vr_bookings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  villa_id     INTEGER NOT NULL,
  guest        TEXT NOT NULL,
  guests       INTEGER,
  contact      TEXT,
  check_in     TEXT NOT NULL,                      -- YYYY-MM-DD
  check_out    TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'langsung',   -- langsung | airbnb | booking | agoda | ...
  total        INTEGER,                            -- what Kevin receives for the stay, rupiah (revenue of the check-in month)
  status       TEXT NOT NULL DEFAULT 'confirmed',  -- confirmed | cancelled
  note         TEXT,
  platform_ref TEXT,                               -- the platform's reservation code
  chat_url     TEXT,                               -- link to the guest conversation on the platform
  payout_id    INTEGER,                            -- vr_payouts.id once the money arrived
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vr_bookings_in ON vr_bookings (villa_id, check_in);
-- Dates closed from the app (private use / private event, maintenance). end_date is exclusive, like a check-out.
CREATE TABLE IF NOT EXISTS vr_blocks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  villa_id   INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'pribadi',      -- pribadi | acara | maintenance | lainnya
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
  kind       TEXT NOT NULL DEFAULT 'reserved',     -- reserved | blocked
  url        TEXT,                                 -- the reservation page on the platform, when the calendar gives one
  PRIMARY KEY (feed_id, uid)
);
CREATE INDEX IF NOT EXISTS vr_ical_villa ON vr_ical_events (villa_id, start_date);
-- Income other than bookings, and expenses.
CREATE TABLE IF NOT EXISTS vr_ledger (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  type       TEXT NOT NULL,                        -- in | out
  category   TEXT NOT NULL,
  villa_id   INTEGER,                              -- NULL = all villas / general
  amount     INTEGER NOT NULL,                     -- rupiah
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vr_ledger_date ON vr_ledger (date);
-- Money that arrived from a platform (or a direct guest). Bookings point at it with payout_id.
CREATE TABLE IF NOT EXISTS vr_payouts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  platform   TEXT NOT NULL,
  date       TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  ref        TEXT,
  note       TEXT,
  created_at TEXT NOT NULL
);
-- Pricing: seasons (percent on top of the normal price) and the average nightly price of an area per calendar month.
CREATE TABLE IF NOT EXISTS vr_seasons (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  villa_id   INTEGER,                              -- NULL = every villa
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'high',         -- low | high | peak
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,                        -- inclusive
  pct        INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS vr_market (
  area       TEXT NOT NULL,
  month      INTEGER NOT NULL,                     -- 1..12
  avg_price  INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (area, month)
);
-- Guest reviews (typed in, or written by a routine that reads the platforms' emails).
CREATE TABLE IF NOT EXISTS vr_reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  villa_id    INTEGER NOT NULL,
  platform    TEXT NOT NULL,
  guest       TEXT,
  rating      REAL NOT NULL,                       -- on a 5 scale (Booking.com's 10 scale is halved)
  text        TEXT,
  review_date TEXT NOT NULL,
  reply       TEXT,
  replied     INTEGER NOT NULL DEFAULT 0,          -- 1 = the reply was posted on the platform
  created_at  TEXT NOT NULL
);
-- Staff who may open /tim (never the money pages). villas: JSON list of villa ids, or ["*"].
CREATE TABLE IF NOT EXISTS vr_staff (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'housekeeping', -- housekeeping | maintenance | manajer
  villas     TEXT NOT NULL DEFAULT '["*"]',
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
-- SOP inventory: what the checkout inspection goes through, and what a guest pays when an item is damaged or lost.
CREATE TABLE IF NOT EXISTS vr_items (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  villa_id INTEGER,                                -- NULL = every villa
  name     TEXT NOT NULL,
  charge   INTEGER NOT NULL DEFAULT 0,
  active   INTEGER NOT NULL DEFAULT 1
);
-- What staff did: 'ready' (villa prepared for a check-in), 'checkout' (inspection), 'maintenance' (block finished),
-- 'issue' (something reported; status open | done). ref: b:<booking id> | i:<feed id>:<uid> | m:<block id> | x:<uuid>.
CREATE TABLE IF NOT EXISTS vr_ops (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  type     TEXT NOT NULL,
  ref      TEXT NOT NULL,
  villa_id INTEGER NOT NULL,
  date     TEXT NOT NULL,
  status   TEXT NOT NULL DEFAULT 'done',
  text     TEXT,
  data     TEXT,                                   -- JSON: ticked steps, issues found
  by_email TEXT,
  by_name  TEXT,
  at       TEXT NOT NULL,
  UNIQUE (type, ref)
);
-- Damage / loss found at checkout, billed to the guest by the SOP price.
CREATE TABLE IF NOT EXISTS vr_charges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  villa_id   INTEGER NOT NULL,
  ref        TEXT NOT NULL,                        -- the stay (same form as vr_ops.ref)
  guest      TEXT,
  date       TEXT NOT NULL,                        -- checkout date
  item       TEXT NOT NULL,
  kind       TEXT NOT NULL,                        -- rusak | hilang
  qty        INTEGER NOT NULL DEFAULT 1,
  amount     INTEGER NOT NULL,
  note       TEXT,
  status     TEXT NOT NULL DEFAULT 'open',         -- open | billed | paid | waived
  by_name    TEXT,
  created_at TEXT NOT NULL
);
