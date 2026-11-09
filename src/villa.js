// Villa rentals (Kahuna, managed by Bukit Vista): bookings and payouts, read from Bukit Vista's emails by Claude's
// scheduled run (Gmail connector) and written to D1 `villa_bookings` / `villa_payouts`. The worker turns them into
// the Villa & Kahuna desk of the Kantor (calendar, check-in / check-out, income). Bookings are never put into
// the website's agenda (Kevin's rule).
// Money here is Kevin's only: it is served only to KANTOR_EMAILS.
import { getSetting, witaDate } from './common.js';

export const VILLA_UNITS = ['Villa 1', 'Villa 2', 'Villa 3', 'Villa 4'];
const CHECK_IN_AT = '14:00', CHECK_OUT_AT = '11:00';
const DAY = 864e5;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const nights = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const monday = d => { const t = new Date(d + 'T00:00:00Z'); return addDays(d, -((t.getUTCDay() + 6) % 7)); };
const isLive = b => b.status !== 'cancelled';

/** Everything the Villa & Kahuna desk shows: calendar window, today / tomorrow moves, occupancy and income. */
export async function villaStatus(env, today = witaDate()) {
  const from = addDays(today, -7), to = addDays(today, 60);
  const [bk, pays, last, sync] = await Promise.all([
    env.DB.prepare(`SELECT booking_id, unit, guest, guests, check_in, check_out, status, total, source FROM villa_bookings
      WHERE check_out >= ? AND check_in <= ? ORDER BY check_in`).bind(addDays(today, -40), to).all().then(r => r.results),
    env.DB.prepare(`SELECT p.booking_id, p.guest, p.amount, p.expected_date, p.email_date, p.unit_code, b.unit FROM villa_payouts p
      LEFT JOIN villa_bookings b ON b.booking_id = p.booking_id WHERE COALESCE(p.expected_date, substr(p.email_date, 1, 10)) >= ? ORDER BY 4`)
      .bind(addDays(monday(today), -7 * 11)).all().then(r => r.results),
    env.DB.prepare(`SELECT MAX(updated_at) AS at FROM villa_bookings`).first(),
    getSetting(env, 'villa_sync', null),
  ]);
  const units = [...new Set([...VILLA_UNITS, ...bk.map(b => b.unit).filter(Boolean)])];
  const live = bk.filter(isLive);
  const pick = (k, d) => live.filter(b => b[k] === d).map(b => ({ unit: b.unit, guest: b.guest, guests: b.guests, booking_id: b.booking_id, check_in: b.check_in, check_out: b.check_out }));
  const moves = { today: { in: pick('check_in', today), out: pick('check_out', today) }, tomorrow: { in: pick('check_in', addDays(today, 1)), out: pick('check_out', addDays(today, 1)) } };

  // Occupancy: nights booked per unit in this calendar month and in the next 30 nights.
  const ym = today.slice(0, 7), mStart = ym + '-01', mEnd = addDays(addDays(mStart, 32).slice(0, 7) + '-01', 0);
  const overlap = (b, s, e) => Math.max(0, nights(b.check_in > s ? b.check_in : s, b.check_out < e ? b.check_out : e));
  const occ = units.map(u => {
    const mine = live.filter(b => b.unit === u);
    const cur = mine.find(b => b.check_in <= today && b.check_out > today);
    const next = mine.filter(b => b.check_in > today).sort((a, b) => a.check_in.localeCompare(b.check_in))[0];
    const freeFrom = cur ? cur.check_out : today;
    return { unit: u, now: cur ? { guest: cur.guest, until: cur.check_out } : null,
      next: next ? { guest: next.guest, check_in: next.check_in } : null,
      free_from: freeFrom, free_until: next && next.check_in > freeFrom ? next.check_in : (next ? null : 'open'),
      month: { booked: mine.reduce((s, b) => s + overlap(b, mStart, mEnd), 0), nights: nights(mStart, mEnd) },
      next30: { booked: mine.reduce((s, b) => s + overlap(b, today, addDays(today, 30)), 0), nights: 30 } };
  });

  // Income = Bukit Vista payouts (what lands in the bank), by expected date; booked value = sum of booking totals by check-in.
  const payDay = p => p.expected_date || p.email_date.slice(0, 10);
  const weeks = [];
  for (let i = 11; i >= 0; i--) { const s = addDays(monday(today), -7 * i); weeks.push({ week: s, amount: 0, count: 0 }); }
  const days = [];
  for (let i = 13; i >= -7; i--) days.push({ date: addDays(today, -i), amount: 0, count: 0 });
  for (const p of pays) {
    const d = payDay(p), w = weeks.find(x => d >= x.week && d < addDays(x.week, 7)), dd = days.find(x => x.date === d);
    if (w) { w.amount += p.amount; w.count++; }
    if (dd) { dd.amount += p.amount; dd.count++; }
  }
  const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) ? x.amount : 0), 0);
  const income = {
    this_week: sum(pays, p => payDay(p) >= monday(today) && payDay(p) < addDays(monday(today), 7)),
    this_month: sum(pays, p => payDay(p).startsWith(ym)),
    upcoming: pays.filter(p => payDay(p) > today).map(p => ({ guest: p.guest, unit: p.unit, amount: p.amount, date: payDay(p) })),
    weeks, days,
    booked_month: live.filter(b => b.check_in.startsWith(ym)).reduce((s, b) => s + (b.total || 0), 0),
  };
  const calendar = bk.filter(b => b.check_out >= from).map(b => ({ unit: b.unit, guest: b.guest, guests: b.guests, check_in: b.check_in, check_out: b.check_out, status: b.status, booking_id: b.booking_id }));
  return { today, from, to, units, calendar, moves, occupancy: occ, income, updated_at: [last?.at, sync?.at].filter(Boolean).sort().pop() || null };
}

/** Live cards for the villa desk: today's and tomorrow's check-ins / check-outs, empty villas soon, stale data. */
export function villaCards(v) {
  const out = [], card = (key, text, tone) => out.push({ id: 'live:villa-' + key, text, tone, live: true, link: '#villa-cal' });
  const who = x => `${x.unit} · ${x.guest}${x.guests ? ` (${x.guests} tamu)` : ''}`;
  for (const [when, label] of [['today', 'hari ini'], ['tomorrow', 'besok']]) {
    for (const x of v.moves[when].in) card(`in-${when}-${x.booking_id}`, `Check-in ${label} 14:00 WITA: ${who(x)}, sampai ${x.check_out}`, when === 'today' ? 'kevin' : 'todo');
    for (const x of v.moves[when].out) card(`out-${when}-${x.booking_id}`, `Check-out ${label} 11:00 WITA: ${who(x)}; siapkan housekeeping`, 'todo');
  }
  for (const o of v.occupancy) if (!o.now && o.free_until !== null && (o.free_until === 'open' || nights(v.today, o.free_until) >= 3))
    card(`free-${o.unit}`, `${o.unit} kosong ${o.free_until === 'open' ? 'tanpa booking ke depan' : 'sampai ' + o.free_until}`, 'todo');
  if (!v.updated_at || Date.now() - Date.parse(v.updated_at) > 2 * DAY) card('stale', 'Email Bukit Vista belum dibaca lebih dari 2 hari (rutinitas villa)', 'macet');
  return out;
}
