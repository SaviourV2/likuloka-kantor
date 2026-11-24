// Dompet data: pos (spending categories with a daily / weekly / monthly rhythm and budget), transactions,
// Bitcoin trades and investments, all in D1 (tables in schema.sql). Weeks start on Monday; dates are WITA.
import { cleanText, now, witaDate } from '../common.js';
import { addDays, investSummary } from './invest.js';

export const PERIODS = ['daily', 'weekly', 'monthly'];
export const PERIOD_ID = { daily: 'harian', weekly: 'mingguan', monthly: 'bulanan' };
export const monday = d => addDays(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7));
export const monthStart = d => d.slice(0, 7) + '-01';
/** First day of the period that contains `d`. */
export const periodStart = (period, d) => (period === 'daily' ? d : period === 'weekly' ? monday(d) : monthStart(d));
const prevMonthStart = d => { const [y, m] = d.split('-').map(Number); return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`; };

export const rupiah = n => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
/** Short form for chat lines: Rp 45rb, Rp 1,2jt. */
export const rp = n => {
  const v = Math.round(Number(n) || 0), a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1e9) return `${s}Rp ${(a / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })}M`;
  if (a >= 1e6) return `${s}Rp ${(a / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })}jt`;
  if (a >= 1e4) return `${s}Rp ${Math.round(a / 1e3).toLocaleString('id-ID')}rb`;
  return `${s}Rp ${a.toLocaleString('id-ID')}`;
};
export const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s));
const int = v => Math.round(Number(String(v ?? '').toString().replace(/[^\d.-]/g, '')) || 0);

// Starter pos for an empty Dompet; Kevin can rename, re-budget or archive them on /dompet.
const STARTER_POS = [
  ['Makan & minum', '🍜', 'daily'], ['Kopi & jajan', '☕', 'daily'], ['Transport', '🛵', 'daily'],
  ['Belanja dapur', '🛒', 'weekly'], ['Hiburan', '🎬', 'weekly'], ['Kesehatan', '💊', 'monthly'],
  ['Tagihan & listrik', '💡', 'monthly'], ['Pulsa & internet', '📶', 'monthly'], ['Langganan', '🔁', 'monthly'],
  ['Sewa / cicilan', '🏠', 'monthly'], ['Belanja pribadi', '🛍️', 'monthly'], ['Lain-lain', '📦', 'monthly'],
];
export async function ensurePos(env) {
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM dompet_pos').first();
  if (n.n) return;
  await env.DB.batch(STARTER_POS.map(([name, emoji, period]) => env.DB.prepare('INSERT OR IGNORE INTO dompet_pos (name, emoji, period, created_at) VALUES (?,?,?,?)').bind(name, emoji, period, now())));
}

/** Pos with what was spent in their own period (today / this week / this month) and the budget left. */
export async function posWithSpend(env, today = witaDate(), { all = false } = {}) {
  await ensurePos(env);
  const w = monday(today), m = monthStart(today), from = w < m ? w : m;
  const { results } = await env.DB.prepare(`SELECT p.id, p.name, p.emoji, p.period, p.budget, p.archived,
      COALESCE(SUM(CASE WHEN t.date = ?1 THEN t.amount END), 0) AS today,
      COALESCE(SUM(CASE WHEN t.date >= ?2 THEN t.amount END), 0) AS week,
      COALESCE(SUM(CASE WHEN t.date >= ?3 THEN t.amount END), 0) AS month,
      COUNT(t.id) AS n
    FROM dompet_pos p LEFT JOIN dompet_tx t ON t.pos_id = p.id AND t.kind = 'expense' AND t.date >= ?4 AND t.date <= ?1
    GROUP BY p.id ORDER BY p.archived, CASE p.period WHEN 'daily' THEN 0 WHEN 'weekly' THEN 1 ELSE 2 END, p.name`).bind(today, w, m, from).all();
  return results.filter(p => all || !p.archived).map(p => {
    const spent = p.period === 'daily' ? p.today : p.period === 'weekly' ? p.week : p.month;
    return { ...p, spent, left: p.budget ? p.budget - spent : null, pct: p.budget ? Math.round(spent / p.budget * 100) : null };
  });
}

/** Spending today / this week / this month, income this month, and last month for comparison. */
export async function totals(env, today = witaDate()) {
  const w = monday(today), m = monthStart(today), pm = prevMonthStart(today), from = w < pm ? w : pm;
  // Same day of last month, for a fair "so far" comparison.
  const pmSameDay = addDays(pm, Math.min(Number(today.slice(8)) - 1, 27));
  const r = await env.DB.prepare(`SELECT
      COALESCE(SUM(CASE WHEN kind = 'expense' AND date = ?1 THEN amount END), 0) AS today,
      COALESCE(SUM(CASE WHEN kind = 'expense' AND date = ?5 THEN amount END), 0) AS yesterday,
      COALESCE(SUM(CASE WHEN kind = 'expense' AND date >= ?2 THEN amount END), 0) AS week,
      COALESCE(SUM(CASE WHEN kind = 'expense' AND date >= ?3 THEN amount END), 0) AS month,
      COALESCE(SUM(CASE WHEN kind = 'income' AND date >= ?3 THEN amount END), 0) AS income_month,
      COALESCE(SUM(CASE WHEN kind = 'expense' AND date >= ?4 AND date < ?3 THEN amount END), 0) AS last_month,
      COALESCE(SUM(CASE WHEN kind = 'expense' AND date >= ?4 AND date <= ?6 THEN amount END), 0) AS last_month_same_day
    FROM dompet_tx WHERE date >= ?7 AND date <= ?1`).bind(today, w, m, pm, addDays(today, -1), pmSameDay, from).first();
  return r;
}

/** Spending per day (last 31 days), per week (last 12 weeks) and per month (last 12 months), split by pos. */
export async function series(env, today = witaDate()) {
  const from = monthStart(addDays(monthStart(today), -330));
  const { results } = await env.DB.prepare(`SELECT date, pos_id, SUM(amount) AS amount FROM dompet_tx
    WHERE kind = 'expense' AND date >= ? AND date <= ? GROUP BY date, pos_id`).bind(from, today).all();
  const bucket = (keys, keyOf) => {
    const map = new Map(keys.map(k => [k, { key: k, amount: 0, by_pos: {} }]));
    for (const r of results) { const b = map.get(keyOf(r.date)); if (b) { b.amount += r.amount; b.by_pos[r.pos_id ?? 0] = (b.by_pos[r.pos_id ?? 0] || 0) + r.amount; } }
    return [...map.values()];
  };
  const days = Array.from({ length: 31 }, (_, i) => addDays(today, i - 30));
  const weeks = Array.from({ length: 12 }, (_, i) => addDays(monday(today), (i - 11) * 7));
  const months = []; for (let d = monthStart(today), i = 0; i < 12; i++, d = prevMonthStart(d)) months.unshift(d.slice(0, 7));
  return { daily: bucket(days, d => d), weekly: bucket(weeks, monday), monthly: bucket(months, d => d.slice(0, 7)) };
}

/** Finds a pos by id or (case-insensitive) name; creates it when `create` has a name that does not exist yet. */
export async function resolvePos(env, { id, name, period, emoji } = {}) {
  if (id) { const p = await env.DB.prepare('SELECT * FROM dompet_pos WHERE id = ?').bind(Number(id)).first(); if (p) return p; }
  const n = cleanText(name, 40);
  if (!n) return env.DB.prepare("SELECT * FROM dompet_pos WHERE name = 'Lain-lain'").first();
  const found = await env.DB.prepare('SELECT * FROM dompet_pos WHERE lower(name) = lower(?)').bind(n).first();
  if (found) { if (found.archived) await env.DB.prepare('UPDATE dompet_pos SET archived = 0 WHERE id = ?').bind(found.id).run(); return found; }
  const per = PERIODS.includes(period) ? period : 'monthly';
  await env.DB.prepare('INSERT INTO dompet_pos (name, emoji, period, created_at) VALUES (?,?,?,?)').bind(n, cleanText(emoji, 8) || '📌', per, now()).run();
  const p = await env.DB.prepare('SELECT * FROM dompet_pos WHERE lower(name) = lower(?)').bind(n).first();
  return { ...p, created: true };
}

/** Saves a pos (new or existing). Returns the pos row. */
export async function savePos(env, d) {
  const name = cleanText(d.name, 40);
  if (!name) throw new Error('Nama pos kosong');
  const period = PERIODS.includes(d.period) ? d.period : 'monthly';
  const budget = int(d.budget) > 0 ? int(d.budget) : null;
  if (d.id) {
    await env.DB.prepare('UPDATE dompet_pos SET name = ?, emoji = ?, period = ?, budget = ?, archived = ? WHERE id = ?')
      .bind(name, cleanText(d.emoji, 8) || null, period, budget, d.archived ? 1 : 0, Number(d.id)).run();
    return env.DB.prepare('SELECT * FROM dompet_pos WHERE id = ?').bind(Number(d.id)).first();
  }
  const p = await resolvePos(env, { name, period, emoji: d.emoji });
  await env.DB.prepare('UPDATE dompet_pos SET period = ?, budget = ?, emoji = COALESCE(?, emoji) WHERE id = ?').bind(period, budget, cleanText(d.emoji, 8) || null, p.id).run();
  return { ...(await env.DB.prepare('SELECT * FROM dompet_pos WHERE id = ?').bind(p.id).first()), created: p.created };
}

const fingerprint = (date, amount, merchant) => `${date}|${amount}|${cleanText(merchant, 40).toLowerCase().replace(/[^a-z0-9]/g, '')}`;

/** Records one expense or income. Returns { tx, pos, duplicate_of }. */
export async function addTx(env, d) {
  const kind = d.kind === 'income' ? 'income' : 'expense';
  const amount = Math.abs(int(d.amount));
  if (!amount) throw new Error('Jumlah kosong');
  const date = isDate(d.date) && d.date <= addDays(witaDate(), 1) ? d.date : witaDate();
  const pos = kind === 'expense' ? await resolvePos(env, { id: d.pos_id, name: d.pos, period: d.pos_period, emoji: d.pos_emoji }) : null;
  const merchant = cleanText(d.merchant, 80) || null, fp = fingerprint(date, amount, merchant || d.note);
  const dup = await env.DB.prepare('SELECT id FROM dompet_tx WHERE fingerprint = ? AND kind = ? ORDER BY id LIMIT 1').bind(fp, kind).first();
  const r = await env.DB.prepare(`INSERT INTO dompet_tx (kind, date, amount, pos_id, merchant, note, account, source, tg_file_id, tg_chat_msg, fingerprint, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`).bind(kind, date, amount, pos?.id ?? null, merchant, cleanText(d.note, 200) || null,
    cleanText(d.account, 40) || null, cleanText(d.source, 20) || 'web', d.tg_file_id || null, d.tg_chat_msg || null, fp, now()).first();
  return { tx: r, pos, duplicate_of: dup?.id || null };
}

export async function updateTx(env, id, d) {
  const t = await env.DB.prepare('SELECT * FROM dompet_tx WHERE id = ?').bind(Number(id)).first();
  if (!t) throw new Error('Transaksi tidak ditemukan');
  const next = { ...t };
  if (d.pos_id !== undefined || d.pos !== undefined) next.pos_id = (await resolvePos(env, { id: d.pos_id, name: d.pos }))?.id ?? null;
  if (d.amount !== undefined && int(d.amount)) next.amount = Math.abs(int(d.amount));
  if (d.date !== undefined && isDate(d.date)) next.date = d.date;
  if (d.kind !== undefined) next.kind = d.kind === 'income' ? 'income' : 'expense';
  for (const k of ['merchant', 'note', 'account']) if (d[k] !== undefined) next[k] = cleanText(d[k], k === 'note' ? 200 : 80) || null;
  next.fingerprint = fingerprint(next.date, next.amount, next.merchant || next.note);
  await env.DB.prepare('UPDATE dompet_tx SET kind = ?, date = ?, amount = ?, pos_id = ?, merchant = ?, note = ?, account = ?, fingerprint = ? WHERE id = ?')
    .bind(next.kind, next.date, next.amount, next.pos_id, next.merchant, next.note, next.account, next.fingerprint, t.id).run();
  return next;
}
export const deleteTx = (env, id) => env.DB.prepare('DELETE FROM dompet_tx WHERE id = ?').bind(Number(id)).run();

export async function listTx(env, { from, to, limit = 300 } = {}) {
  const f = isDate(from) ? from : '0000-01-01', t = isDate(to) ? to : '9999-12-31';
  const { results } = await env.DB.prepare(`SELECT t.id, t.kind, t.date, t.amount, t.pos_id, t.merchant, t.note, t.account, t.source,
      (t.tg_file_id IS NOT NULL) AS has_receipt, t.created_at, p.name AS pos_name, p.emoji AS pos_emoji, p.period AS pos_period
    FROM dompet_tx t LEFT JOIN dompet_pos p ON p.id = t.pos_id WHERE t.date >= ? AND t.date <= ?
    ORDER BY t.date DESC, t.id DESC LIMIT ?`).bind(f, t, Math.min(5000, limit)).all();
  return results;
}

// ---- Bitcoin -------------------------------------------------------------------------------------------

export async function addBtc(env, d) {
  const side = d.side === 'sell' ? 'sell' : 'buy';
  const btc = Math.abs(Number(String(d.btc).replace(',', '.')) || 0), idr = Math.abs(int(d.idr));
  if (!btc || !idr) throw new Error('Isi jumlah BTC dan rupiah');
  const date = isDate(d.date) ? d.date : witaDate();
  return env.DB.prepare('INSERT INTO dompet_btc (date, side, btc, idr, exchange, note, source, created_at) VALUES (?,?,?,?,?,?,?,?) RETURNING *')
    .bind(date, side, btc, idr, cleanText(d.exchange, 40) || null, cleanText(d.note, 200) || null, cleanText(d.source, 20) || 'web', now()).first();
}
export const deleteBtc = (env, id) => env.DB.prepare('DELETE FROM dompet_btc WHERE id = ?').bind(Number(id)).run();

/** Holdings with average-cost basis: realised profit on sells, unrealised on what is held at today's price. */
export function btcSummary(trades, price) {
  let qty = 0, cost = 0, realised = 0, bought = 0, sold = 0;
  for (const t of [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)) {
    if (t.side === 'buy') { qty += t.btc; cost += t.idr; bought += t.idr; }
    else { const avg = qty > 0 ? cost / qty : 0, q = Math.min(t.btc, qty); realised += t.idr - avg * q; cost -= avg * q; qty -= q; sold += t.idr; }
  }
  if (qty < 1e-9) { qty = 0; cost = 0; }
  const value = price ? qty * price : null;
  return { btc: qty, cost: Math.round(cost), avg_price: qty ? Math.round(cost / qty) : null, value: value == null ? null : Math.round(value),
    unrealised: value == null ? null : Math.round(value - cost), unrealised_pct: value != null && cost ? (value - cost) / cost * 100 : null,
    realised: Math.round(realised), bought, sold, trades: trades.length };
}

// ---- Investments ---------------------------------------------------------------------------------------

export const INVEST_KINDS = ['deposito', 'reksadana', 'obligasi', 'p2p', 'tabungan', 'saham', 'emas', 'lainnya'];
export async function saveInvest(env, d) {
  const name = cleanText(d.name, 60), principal = Math.abs(int(d.principal));
  const rate = Number(String(d.rate_pa ?? '').replace(',', '.'));
  if (!name || !principal) throw new Error('Isi nama dan pokok investasi');
  if (!(rate >= 0 && rate <= 100)) throw new Error('Bunga per tahun 0–100%');
  const row = [name, INVEST_KINDS.includes(d.kind) ? d.kind : 'lainnya', principal, rate, ['simple', 'daily', 'monthly'].includes(d.compounding) ? d.compounding : 'simple',
    Math.min(100, Math.max(0, Number(d.tax_pct) || 0)), isDate(d.start_date) ? d.start_date : witaDate(), isDate(d.end_date) ? d.end_date : null, cleanText(d.note, 200) || null];
  if (d.id) {
    await env.DB.prepare('UPDATE dompet_invest SET name = ?, kind = ?, principal = ?, rate_pa = ?, compounding = ?, tax_pct = ?, start_date = ?, end_date = ?, note = ? WHERE id = ?').bind(...row, Number(d.id)).run();
    return env.DB.prepare('SELECT * FROM dompet_invest WHERE id = ?').bind(Number(d.id)).first();
  }
  return env.DB.prepare('INSERT INTO dompet_invest (name, kind, principal, rate_pa, compounding, tax_pct, start_date, end_date, note, source, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING *')
    .bind(...row, cleanText(d.source, 20) || 'web', now()).first();
}
export async function investments(env, today = witaDate()) {
  const { results } = await env.DB.prepare('SELECT * FROM dompet_invest ORDER BY closed_at IS NOT NULL, start_date').all();
  return investSummary(results, today);
}
export async function btcTrades(env) {
  return (await env.DB.prepare('SELECT * FROM dompet_btc ORDER BY date DESC, id DESC').all()).results;
}
