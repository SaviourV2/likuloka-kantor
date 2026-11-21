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
