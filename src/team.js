// Staff page (/tim): each staff member signs in with their own email and sees only their work for the villas
// they are assigned to: prepare a villa before a check-in, inspect it at checkout (damage and losses are billed to
// the guest by the SOP price list), finish maintenance, report problems. No booking values, payouts or contacts.
import { cleanText, json, now, parseJson, witaDate } from './common.js';
import { BLOCK_KINDS, PLATFORMS, addDays, all, bad, isDate, villaConfig } from './rental.js';

export const staffByEmail = (env, email) => env.DB.prepare('SELECT id, email, name, role, villas FROM vr_staff WHERE email = ? AND active = 1').bind(email).first();
const CAN = { housekeeping: ['ready', 'checkout', 'issue'], maintenance: ['maintenance', 'issue', 'issue_done'], manajer: ['ready', 'checkout', 'maintenance', 'issue', 'issue_done'] };

/** The signed-in person as a team member. The owner counts as a manager of every villa. */
const member = who => who.role === 'owner' ? { name: 'Kevin', role: 'manajer', villas: ['*'], email: who.email } : { ...who.staff, villas: parseJson(who.staff.villas, ['*']) };

async function board(env, me) {
  const today = witaDate(), from = addDays(today, -2), to = addDays(today, 8);
  const [villasAll, bookings, icalRaw, blocks, items, ops, config] = await Promise.all([
    all(env, 'SELECT id, name FROM vr_villas WHERE active = 1 ORDER BY sort, id'),
    all(env, "SELECT id, villa_id, guest, guests, check_in, check_out, source FROM vr_bookings WHERE status != 'cancelled' AND check_out >= ? AND check_in <= ?", from, to),
    all(env, "SELECT feed_id, uid, villa_id, platform, start_date, end_date FROM vr_ical_events WHERE kind = 'reserved' AND end_date >= ? AND start_date <= ?", from, to),
    all(env, 'SELECT id, villa_id, start_date, end_date, kind, note FROM vr_blocks WHERE end_date > ? AND start_date <= ?', from, to),
    all(env, 'SELECT id, villa_id, name, charge FROM vr_items WHERE active = 1 ORDER BY name'),
    all(env, "SELECT id, type, ref, villa_id, date, status, text, data, by_name, at FROM vr_ops WHERE date >= ? OR (type = 'issue' AND status = 'open') ORDER BY at DESC", addDays(today, -14)),
    villaConfig(env),
  ]);
  const villas = villasAll.filter(v => me.villas.includes('*') || me.villas.includes(v.id)), ids = new Set(villas.map(v => v.id)), mine = x => ids.has(x.villa_id);
  // Stays: bookings, plus platform reservations nobody completed yet (those have no guest name).
  const stays = [...bookings.filter(mine).map(b => ({ ref: 'b:' + b.id, villa_id: b.villa_id, guest: b.guest, guests: b.guests, check_in: b.check_in, check_out: b.check_out })),
    ...icalRaw.filter(mine).filter(e => !bookings.some(b => b.villa_id === e.villa_id && b.check_in <= e.start_date && b.check_out >= e.end_date))
      .map(e => ({ ref: `i:${e.feed_id}:${e.uid}`, villa_id: e.villa_id, guest: 'Tamu ' + (PLATFORMS[e.platform] || e.platform), guests: null, check_in: e.start_date, check_out: e.end_date }))];
  return { today, me: { name: me.name, role: me.role }, can: CAN[me.role] || [], villas, stays,
    blocks: blocks.filter(mine).map(b => ({ ...b, ref: 'm:' + b.id, label: BLOCK_KINDS[b.kind] || b.kind })),
    items: items.filter(i => !i.villa_id || ids.has(i.villa_id)), sop: config.sop,
    ops: ops.filter(mine).map(o => ({ ...o, data: parseJson(o.data, null) })) };
}

export async function teamApi(req, env, who) {
  const me = member(who);
  if (req.method === 'GET') return json(await board(env, me));
  const d = await req.json().catch(() => ({})), b = await board(env, me), at = now();
  if (!b.can.includes(d.action)) return bad('Tugas ini bukan untuk peran Anda', 403);
  const save = (type, ref, villaId, date, text, data, status = 'done') => env.DB.prepare(`INSERT INTO vr_ops (type, ref, villa_id, date, status, text, data, by_email, by_name, at) VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(type, ref) DO UPDATE SET status = excluded.status, text = excluded.text, data = excluded.data, by_email = excluded.by_email, by_name = excluded.by_name, at = excluded.at`)
    .bind(type, ref, villaId, date, status, text, data ? JSON.stringify(data) : null, me.email, me.name, at);
  const stay = b.stays.find(s => s.ref === d.ref), note = cleanText(d.note, 300);
  switch (d.action) {
    case 'ready': {
      if (!stay) return bad('Tamu tidak ditemukan');
      const steps = (Array.isArray(d.steps) ? d.steps : []).map(x => cleanText(x, 160)).filter(Boolean);
      const missing = b.sop.ready.filter(x => !steps.includes(x));
      if (missing.length) return bad(`Belum dicentang: ${missing[0]}${missing.length > 1 ? ` (+${missing.length - 1} lagi)` : ''}`);
      await save('ready', stay.ref, stay.villa_id, stay.check_in, note, { steps }).run();
      return json({ ok: true });
    }
    case 'checkout': {
      if (!stay) return bad('Tamu tidak ditemukan');
      if (stay.check_out > addDays(b.today, 1)) return bad('Pemeriksaan checkout baru bisa diisi di hari checkout');
      const steps = (Array.isArray(d.steps) ? d.steps : []).map(x => cleanText(x, 160)).filter(Boolean);
      const missing = b.sop.checkout.filter(x => !steps.includes(x));
      if (missing.length) return bad(`Belum dicentang: ${missing[0]}${missing.length > 1 ? ` (+${missing.length - 1} lagi)` : ''}`);
      const found = [];
      for (const x of (Array.isArray(d.issues) ? d.issues : []).slice(0, 60)) {
        const item = b.items.find(i => i.id === Number(x.item_id)), qty = Math.min(99, Math.max(1, Math.round(Number(x.qty) || 1)));
        if (!item) return bad('Barang tidak ada di daftar SOP');
        found.push({ item: item.name, kind: x.kind === 'hilang' ? 'hilang' : 'rusak', qty, amount: item.charge * qty, note: cleanText(x.note, 200) });
      }
      // A second submission replaces the first one's findings, as long as Kevin has not acted on them yet.
      const stmts = [env.DB.prepare("DELETE FROM vr_charges WHERE ref = ? AND status = 'open'").bind(stay.ref), save('checkout', stay.ref, stay.villa_id, stay.check_out, note, { steps, found })];
      for (const f of found) stmts.push(env.DB.prepare('INSERT INTO vr_charges (villa_id, ref, guest, date, item, kind, qty, amount, note, by_name, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .bind(stay.villa_id, stay.ref, stay.guest, stay.check_out, f.item, f.kind, f.qty, f.amount, f.note, me.name, at));
      await env.DB.batch(stmts);
      return json({ ok: true, total: found.reduce((n, f) => n + f.amount, 0) });
    }
    case 'maintenance': {
      const block = b.blocks.find(x => x.ref === d.ref && x.kind === 'maintenance');
      if (!block) return bad('Jadwal maintenance tidak ditemukan');
      await save('maintenance', block.ref, block.villa_id, block.start_date, note).run();
      return json({ ok: true });
    }
    case 'issue': {
      const villa = b.villas.find(v => v.id === Number(d.villa_id)), text = cleanText(d.text, 300);
      if (!villa) return bad('Pilih villa');
      if (text.length < 4) return bad('Tulis apa masalahnya');
      await save('issue', 'x:' + crypto.randomUUID().slice(0, 12), villa.id, isDate(d.date) ? d.date : b.today, text, null, 'open').run();
      return json({ ok: true });
    }
    case 'issue_done': {
      const op = b.ops.find(o => o.id === Number(d.id) && o.type === 'issue');
      if (!op) return bad('Laporan tidak ditemukan');
      await env.DB.prepare("UPDATE vr_ops SET status = 'done', data = ? WHERE id = ?").bind(JSON.stringify({ done_by: me.name, done_at: at, note }), op.id).run();
      return json({ ok: true });
    }
  }
  return bad('Aksi tidak dikenal');
}
