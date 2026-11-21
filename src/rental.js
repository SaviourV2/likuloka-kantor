// Villa Manager (/villa): self-managed villa rentals, separate from the Kahuna desk (which Bukit Vista runs).
// Kevin's own list of villas, their bookings, date blocks (private use, maintenance), income and expenses, and
// calendar sync with the booking platforms over iCal:
//   - import: each platform listing's iCal address is read every 30 minutes (cron) into vr_ical_events;
//   - export: /ical/<token>/<villa>/<platform>.ics lists every busy date of a villa, for the platforms to import,
//     so a booking on one platform (or a block made here) closes the dates on the others.
// The export has dates only: no guest names and no money. Everything else is served only to KANTOR_EMAILS.
import { cleanText, getSetting, json, now, setSetting, witaDate } from './common.js';

export const PLATFORMS = { airbnb: 'Airbnb', booking: 'Booking.com', agoda: 'Agoda', traveloka: 'Traveloka', tiket: 'tiket.com', vrbo: 'Vrbo', lainnya: 'Lainnya' };
const SOURCES = { langsung: 'Langsung', ...PLATFORMS };
const BLOCK_KINDS = { pribadi: 'Pemakaian pribadi', maintenance: 'Maintenance', lainnya: 'Lainnya' };
const ICAL_KEY = 'villa_ical';   // ops_settings: { token, host } (host = the worker's workers.dev hostname, see icalFeed)
const DAY = 864e5;
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(Date.parse(d + 'T00:00:00Z'));
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const nights = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };
const bad = (error, status = 400) => json({ error }, status);
const all = (env, sql, ...a) => env.DB.prepare(sql).bind(...a).all().then(r => r.results);

async function icalSettings(env) {
  let s = await getSetting(env, ICAL_KEY, null);
  if (!s?.token) { s = { ...(s || {}), token: crypto.randomUUID().replace(/-/g, '') }; await setSetting(env, ICAL_KEY, s); }
  return s;
}

/* ---------- iCal ---------- */
/** Parses an iCal text into [{ uid, summary, start, end }] with YYYY-MM-DD dates (end exclusive, like a check-out). */
export function parseIcal(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out = []; let ev = null;
  const day = v => { const m = /(\d{4})(\d{2})(\d{2})/.exec(v || ''); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = {}; continue; }
    if (line === 'END:VEVENT') {
      if (ev?.start && isDate(ev.start)) {
        if (!ev.end || !isDate(ev.end) || ev.end <= ev.start) ev.end = addDays(ev.start, 1);
        ev.summary = cleanText((ev.summary || '').replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, ' '), 120);
        ev.uid = cleanText(ev.uid, 200) || `${ev.start}_${ev.end}_${ev.summary}`;
        if ((ev.status || '').toUpperCase() !== 'CANCELLED') out.push({ uid: ev.uid, summary: ev.summary, start: ev.start, end: ev.end });
      }
      ev = null; continue;
    }
    if (!ev) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const name = line.slice(0, i).split(';')[0].toUpperCase(), value = line.slice(i + 1).trim();
    if (name === 'DTSTART') ev.start = day(value);
    else if (name === 'DTEND') ev.end = day(value);
    else if (name === 'SUMMARY') ev.summary = value;
    else if (name === 'UID') ev.uid = value;
    else if (name === 'STATUS') ev.status = value;
  }
  return out;
}
// Platforms mark dates the host closed (or that came from another calendar) differently from a guest's reservation.
const icalKind = summary => /not available|unavailable|blocked|closed|tidak tersedia|ditutup/i.test(summary) ? 'blocked' : 'reserved';

/** Reads the platform calendars (all, or one feed) into vr_ical_events. Past events are kept as history. */
export async function syncFeeds(env, feedId = null) {
  const feeds = await all(env, `SELECT f.* FROM vr_feeds f JOIN vr_villas v ON v.id = f.villa_id AND v.active = 1 ${feedId ? 'WHERE f.id = ?' : ''}`, ...(feedId ? [feedId] : []));
  const today = witaDate(), report = [];
  await Promise.all(feeds.map(async f => {
    try {
      const r = await fetch(f.url, { headers: { 'user-agent': 'likuloka-kantor-ical/1', accept: 'text/calendar, text/plain, */*' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const text = await r.text();
      if (!text.includes('BEGIN:VCALENDAR')) throw new Error('bukan file kalender (iCal)');
      const events = parseIcal(text).slice(0, 1000);
      const stmts = [env.DB.prepare('DELETE FROM vr_ical_events WHERE feed_id = ? AND end_date >= ?').bind(f.id, today)];
      for (const e of events) stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO vr_ical_events (feed_id, uid, villa_id, platform, summary, start_date, end_date, kind)
        VALUES (?,?,?,?,?,?,?,?)`).bind(f.id, e.uid, f.villa_id, f.platform, e.summary, e.start, e.end, icalKind(e.summary)));
      stmts.push(env.DB.prepare('UPDATE vr_feeds SET last_sync = ?, last_error = NULL, last_count = ? WHERE id = ?').bind(now(), events.filter(e => e.end >= today).length, f.id));
      await env.DB.batch(stmts);
      report.push({ id: f.id, ok: true, count: events.length });
    } catch (e) {
      const msg = cleanText(e?.name === 'TimeoutError' ? 'tidak menjawab (timeout)' : e?.message || String(e), 200);
      await env.DB.prepare('UPDATE vr_feeds SET last_error = ?, last_try = ? WHERE id = ?').bind(msg, now(), f.id).run();
      report.push({ id: f.id, ok: false, error: msg });
    }
  }));
  return report;
}

/** Public calendar of one villa's busy dates, for a booking platform to import. No sign-in: the token in the path is
 *  the key. `for` names the platform that reads it, so that platform's own events are not sent back to it. */
export async function icalFeed(req, env, url) {
  const deny = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  const m = /^\/ical\/([a-f0-9]{32})\/(\d+)\/([a-z]+)\.ics$/.exec(url.pathname);
  // Cloudflare Access covers kantor.likuloka.com, so the platforms read the feed on the worker's workers.dev
  // hostname. The worker learns that hostname from the first request that arrives there (the deploy pings it).
  const onDev = url.hostname.endsWith('.workers.dev');
  const s = onDev ? await icalSettings(env) : await getSetting(env, ICAL_KEY, null);
  if (onDev && s.host !== url.hostname) await setSetting(env, ICAL_KEY, { ...s, host: url.hostname });
  if (!m || !s?.token || m[1] !== s.token) return deny();
  const villaId = Number(m[2]), skip = m[3], from = addDays(witaDate(), -1);
  const villa = await env.DB.prepare('SELECT id, name FROM vr_villas WHERE id = ? AND active = 1').bind(villaId).first();
  if (!villa) return deny();
  const [bk, bl, ic] = await Promise.all([
    all(env, "SELECT id, check_in AS s, check_out AS e FROM vr_bookings WHERE villa_id = ? AND status != 'cancelled' AND check_out >= ?", villaId, from),
    all(env, 'SELECT id, start_date AS s, end_date AS e FROM vr_blocks WHERE villa_id = ? AND end_date >= ?', villaId, from),
    all(env, 'SELECT feed_id, uid, start_date AS s, end_date AS e FROM vr_ical_events WHERE villa_id = ? AND end_date >= ? AND platform != ?', villaId, from, skip),
  ]);
  const stamp = now().replace(/[-:]|\.\d+/g, ''), d = x => x.replace(/-/g, '');
  const ev = (uid, x) => ['BEGIN:VEVENT', `UID:${uid}@kantor.likuloka.com`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d(x.s)}`, `DTEND;VALUE=DATE:${d(x.e)}`, 'SUMMARY:Tidak tersedia', 'END:VEVENT'];
  const safe = u => String(u).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 60);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Liku Loka//Villa Manager//ID', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    ...bk.flatMap(x => ev('booking-' + x.id, x)), ...bl.flatMap(x => ev('blokir-' + x.id, x)), ...ic.flatMap(x => ev(`ical-${x.feed_id}-${safe(x.uid)}`, x)), 'END:VCALENDAR'];
  return new Response(lines.join('\r\n') + '\r\n', { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}

/* ---------- page data ---------- */
export async function rentalStatus(env, url) {
  const today = witaDate();
  const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : today.slice(0, 7);
  const mStart = month + '-01', mEnd = addMonths(month, 1) + '-01', first = addMonths(month, -11);
  const [villas, bookings, blocks, icalRaw, feeds, ledger, sumB, sumL, s] = await Promise.all([
    all(env, 'SELECT id, name, note FROM vr_villas WHERE active = 1 ORDER BY sort, id'),
    all(env, 'SELECT * FROM vr_bookings WHERE check_out >= ? AND check_in < ? ORDER BY check_in', mStart, mEnd),
    all(env, 'SELECT * FROM vr_blocks WHERE end_date > ? AND start_date < ? ORDER BY start_date', mStart, mEnd),
    all(env, 'SELECT * FROM vr_ical_events WHERE end_date >= ? AND start_date < ? ORDER BY start_date', mStart, mEnd),
    all(env, 'SELECT id, villa_id, platform, url, last_sync, last_try, last_error, last_count FROM vr_feeds ORDER BY villa_id, id'),
    all(env, 'SELECT * FROM vr_ledger WHERE date >= ? AND date < ? ORDER BY date DESC, id DESC', mStart, mEnd),
    all(env, "SELECT substr(check_in, 1, 7) AS ym, SUM(COALESCE(total, 0)) AS n FROM vr_bookings WHERE status != 'cancelled' AND check_in >= ? AND check_in < ? GROUP BY 1", first + '-01', mEnd),
    all(env, 'SELECT substr(date, 1, 7) AS ym, type, SUM(amount) AS n FROM vr_ledger WHERE date >= ? AND date < ? GROUP BY 1, 2', first + '-01', mEnd),
    icalSettings(env),
  ]);
  const ids = new Set(villas.map(v => v.id)), mine = x => ids.has(x.villa_id);
  const live = bookings.filter(b => b.status !== 'cancelled' && mine(b));
  // A platform's event that a booking entered here fully covers is that same stay: show the booking only.
  const ical = icalRaw.filter(mine).map(e => ({ ...e, covered: live.some(b => b.villa_id === e.villa_id && b.check_in <= e.start_date && b.check_out >= e.end_date) }));
  // Clashes: two different stays (or a stay and a block) on the same villa on the same night.
  const items = [...live.map(b => ({ v: b.villa_id, s: b.check_in, e: b.check_out, label: `Booking ${b.guest} (${SOURCES[b.source] || b.source})` })),
    ...ical.filter(e => !e.covered && e.kind === 'reserved').map(e => ({ v: e.villa_id, s: e.start_date, e: e.end_date, label: `Reservasi ${PLATFORMS[e.platform] || e.platform}` })),
    ...blocks.filter(mine).map(b => ({ v: b.villa_id, s: b.start_date, e: b.end_date, label: `Blokir ${BLOCK_KINDS[b.kind] || b.kind}` }))];
  const conflicts = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.v === b.v && a.s < b.e && b.s < a.e) conflicts.push({ villa_id: a.v, a: a.label, b: b.label, from: a.s > b.s ? a.s : b.s, to: a.e < b.e ? a.e : b.e });
  }
  // Money: income = booking values (by check-in month) + other income entries; expenses = expense entries.
  const months = Array.from({ length: 12 }, (_, i) => ({ ym: addMonths(first, i), bookings: 0, other: 0, out: 0 }));
  for (const r of sumB) { const m = months.find(x => x.ym === r.ym); if (m) m.bookings = r.n || 0; }
  for (const r of sumL) { const m = months.find(x => x.ym === r.ym); if (m) m[r.type === 'in' ? 'other' : 'out'] = r.n || 0; }
  const days = nights(mStart, mEnd), clip = (a, b) => Math.max(0, nights(a > mStart ? a : mStart, b < mEnd ? b : mEnd));
  const occupancy = villas.map(v => ({ villa_id: v.id, nights: days,
    booked: live.filter(b => b.villa_id === v.id).reduce((n, b) => n + clip(b.check_in, b.check_out), 0)
      + ical.filter(e => e.villa_id === v.id && !e.covered && e.kind === 'reserved').reduce((n, e) => n + clip(e.start_date, e.end_date), 0),
    blocked: blocks.filter(b => b.villa_id === v.id).reduce((n, b) => n + clip(b.start_date, b.end_date), 0) }));
  return json({ today, month, villas, bookings: bookings.filter(mine), blocks: blocks.filter(mine), ical, feeds: feeds.filter(mine), conflicts,
    ledger, months, occupancy, platforms: PLATFORMS, sources: SOURCES, block_kinds: BLOCK_KINDS,
    ical_export: { token: s.token, host: s.host || null } });
}

/* ---------- changes ---------- */
const overlaps = (env, table, a, b, villaId, s, e, extra = '', ...args) =>
  env.DB.prepare(`SELECT * FROM ${table} WHERE villa_id = ? AND ${a} < ? AND ${b} > ? ${extra} LIMIT 1`).bind(villaId, e, s, ...args).first();

export async function rentalAction(env, d, who) {
  const id = Number(d.id) || null, villaId = Number(d.villa_id) || null, at = now();
  const villa = villaId ? await env.DB.prepare('SELECT id, name FROM vr_villas WHERE id = ? AND active = 1').bind(villaId).first() : null;
  const amount = v => { const n = Math.round(Number(String(v ?? '').replace(/[^\d]/g, ''))); return Number.isFinite(n) && n > 0 ? n : null; };
  switch (d.action) {
    case 'villa_save': {
      const name = cleanText(d.name, 60), note = cleanText(d.note, 200);
      if (name.length < 2) return bad('Tulis nama villa');
      if (id) await env.DB.prepare('UPDATE vr_villas SET name = ?, note = ? WHERE id = ?').bind(name, note, id).run();
      else await env.DB.prepare('INSERT INTO vr_villas (name, note, active, sort, created_at) VALUES (?,?,1,(SELECT COALESCE(MAX(sort), 0) + 1 FROM vr_villas),?)').bind(name, note, at).run();
      return json({ ok: true });
    }
    case 'villa_delete':   // archived, not erased: its bookings and money entries stay in the books
      if (!id) return bad('Villa tidak dikenal');
      await env.DB.prepare('UPDATE vr_villas SET active = 0 WHERE id = ?').bind(id).run();
      return json({ ok: true });
    case 'booking_save': {
      const guest = cleanText(d.guest, 80), source = SOURCES[d.source] ? d.source : 'langsung', status = d.status === 'cancelled' ? 'cancelled' : 'confirmed';
      if (!villa) return bad('Pilih villa');
      if (guest.length < 2) return bad('Tulis nama tamu');
      if (!isDate(d.check_in) || !isDate(d.check_out) || d.check_out <= d.check_in) return bad('Tanggal check-out harus setelah check-in');
      if (status === 'confirmed') {
        const other = await overlaps(env, 'vr_bookings', 'check_in', 'check_out', villaId, d.check_in, d.check_out, "AND status != 'cancelled' AND id != ?", id || 0);
        if (other) return bad(`Bentrok dengan booking ${other.guest} (${other.check_in} sampai ${other.check_out})`, 409);
        const block = await overlaps(env, 'vr_blocks', 'start_date', 'end_date', villaId, d.check_in, d.check_out);
        if (block) return bad(`Tanggal itu diblokir (${BLOCK_KINDS[block.kind] || block.kind}, ${block.start_date} sampai ${addDays(block.end_date, -1)}). Hapus blokirnya dulu.`, 409);
      }
      const v = [villaId, guest, Math.min(99, Math.max(0, Number(d.guests) || 0)) || null, cleanText(d.contact, 80), d.check_in, d.check_out, source, amount(d.total), status, cleanText(d.note, 300)];
      if (id) await env.DB.prepare('UPDATE vr_bookings SET villa_id=?, guest=?, guests=?, contact=?, check_in=?, check_out=?, source=?, total=?, status=?, note=?, updated_at=? WHERE id=?').bind(...v, at, id).run();
      else await env.DB.prepare('INSERT INTO vr_bookings (villa_id, guest, guests, contact, check_in, check_out, source, total, status, note, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(...v, at, at).run();
      return json({ ok: true });
    }
    case 'booking_delete':
      if (!id) return bad('Booking tidak dikenal');
      await env.DB.prepare('DELETE FROM vr_bookings WHERE id = ?').bind(id).run();
      return json({ ok: true });
    case 'block_add': {
      // d.end is the last blocked night's date (inclusive in the form); stored exclusive like a check-out.
      const kind = BLOCK_KINDS[d.kind] ? d.kind : 'lainnya', targets = (Array.isArray(d.villa_ids) ? d.villa_ids : [villaId]).map(Number).filter(Boolean);
      if (!targets.length) return bad('Pilih villa');
      if (!isDate(d.start) || !isDate(d.end) || d.end < d.start) return bad('Tanggal selesai tidak boleh sebelum tanggal mulai');
      if (nights(d.start, d.end) > 731) return bad('Paling lama 2 tahun per blokir');
      const end = addDays(d.end, 1), stmts = [];
      for (const vid of targets) {
        const v = await env.DB.prepare('SELECT id, name FROM vr_villas WHERE id = ? AND active = 1').bind(vid).first();
        if (!v) return bad('Villa tidak dikenal');
        const bk = await overlaps(env, 'vr_bookings', 'check_in', 'check_out', vid, d.start, end, "AND status != 'cancelled'");
        if (bk) return bad(`${v.name}: sudah ada booking ${bk.guest} (${bk.check_in} sampai ${bk.check_out})`, 409);
        const ic = await overlaps(env, 'vr_ical_events', 'start_date', 'end_date', vid, d.start, end, "AND kind = 'reserved'");
        if (ic) return bad(`${v.name}: sudah ada reservasi dari ${PLATFORMS[ic.platform] || ic.platform} (${ic.start_date} sampai ${ic.end_date})`, 409);
        stmts.push(env.DB.prepare('INSERT INTO vr_blocks (villa_id, start_date, end_date, kind, note, created_by, created_at) VALUES (?,?,?,?,?,?,?)').bind(vid, d.start, end, kind, cleanText(d.note, 200), who.email, at));
      }
      await env.DB.batch(stmts);
      return json({ ok: true });
    }
    case 'block_delete':
      if (!id) return bad('Blokir tidak dikenal');
      await env.DB.prepare('DELETE FROM vr_blocks WHERE id = ?').bind(id).run();
      return json({ ok: true });
    case 'feed_add': {
      const platform = PLATFORMS[d.platform] ? d.platform : 'lainnya';
      let u; try { u = new URL(String(d.url || '').trim().replace(/^webcal:/i, 'https:')); } catch { return bad('Alamat kalender tidak valid'); }
      if (!villa) return bad('Pilih villa');
      if (u.protocol !== 'https:') return bad('Alamat kalender harus diawali https://');
      if (u.hostname.endsWith('likuloka.com') || u.hostname.endsWith('.workers.dev')) return bad('Itu alamat kalender dari aplikasi ini sendiri. Tempel alamat ekspor dari platformnya.');
      const r = await env.DB.prepare('INSERT INTO vr_feeds (villa_id, platform, url, created_at) VALUES (?,?,?,?)').bind(villaId, platform, u.href.slice(0, 1000), at).run();
      return json({ ok: true, sync: await syncFeeds(env, r.meta.last_row_id) });
    }
    case 'feed_delete':
      if (!id) return bad('Sambungan tidak dikenal');
      await env.DB.batch([env.DB.prepare('DELETE FROM vr_ical_events WHERE feed_id = ?').bind(id), env.DB.prepare('DELETE FROM vr_feeds WHERE id = ?').bind(id)]);
      return json({ ok: true });
    case 'feed_sync':
      return json({ ok: true, sync: await syncFeeds(env, id) });
    case 'ledger_add': {
      const type = d.type === 'in' ? 'in' : 'out', n = amount(d.amount), category = cleanText(d.category, 40) || 'Lainnya';
      if (!isDate(d.date)) return bad('Isi tanggalnya');
      if (!n) return bad('Isi jumlahnya (rupiah)');
      await env.DB.prepare('INSERT INTO vr_ledger (date, type, category, villa_id, amount, note, created_at) VALUES (?,?,?,?,?,?,?)').bind(d.date, type, category, villa ? villaId : null, n, cleanText(d.note, 200), at).run();
      return json({ ok: true });
    }
    case 'ledger_delete':
      if (!id) return bad('Catatan tidak dikenal');
      await env.DB.prepare('DELETE FROM vr_ledger WHERE id = ?').bind(id).run();
      return json({ ok: true });
  }
  return bad('Aksi tidak dikenal');
}
