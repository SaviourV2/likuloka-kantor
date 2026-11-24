// Plain-text summaries for the Dompet bot (Telegram HTML) and the evening recap.
import { witaDate } from '../common.js';
import { btcSummary, btcTrades, investments, monday, PERIOD_ID, posWithSpend, rp, rupiah, series, totals } from './db.js';
import { addDays } from './invest.js';
import { market, snapshotPrices } from './market.js';

export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const tanggal = d => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
export const hari = d => `${DAYS[new Date(d + 'T00:00:00Z').getUTCDay()]} ${tanggal(d)}`;
const pct = (v, digits = 1) => (v == null ? '' : `${v >= 0 ? '+' : ''}${v.toLocaleString('id-ID', { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`);
const bar = p => { const n = Math.max(0, Math.min(10, Math.round((p || 0) / 10))); return '▓'.repeat(n) + '░'.repeat(10 - n); };
const btcFmt = v => (Number(v) || 0).toLocaleString('id-ID', { maximumFractionDigits: 8 });

/** One pos line with its budget for its own period. */
export function posLine(p) {
  const base = `${p.emoji || '•'} ${esc(p.name)} (${PERIOD_ID[p.period]}): ${rp(p.spent)}`;
  if (!p.budget) return base;
  const warn = p.pct >= 100 ? ' ⛔' : p.pct >= 80 ? ' ⚠️' : '';
  return `${base} / ${rp(p.budget)}${warn}`;
}

/** Budget warnings for pos at or over 80% of their period budget. */
export const budgetWarnings = pos => pos.filter(p => p.budget && p.pct >= 80)
  .map(p => p.pct >= 100 ? `⛔ ${esc(p.name)} lewat budget ${PERIOD_ID[p.period]}: ${rp(p.spent)} dari ${rp(p.budget)}` : `⚠️ ${esc(p.name)} sudah ${p.pct}% budget ${PERIOD_ID[p.period]} (sisa ${rp(p.left)})`);

export async function textTotals(env, today = witaDate()) {
  const t = await totals(env, today);
  return `Hari ini <b>${rp(t.today)}</b> · Minggu ini <b>${rp(t.week)}</b> · Bulan ini <b>${rp(t.month)}</b>`;
}

async function spendByPos(env, from, to) {
  const { results } = await env.DB.prepare(`SELECT p.name, p.emoji, SUM(t.amount) AS amount, COUNT(*) AS n FROM dompet_tx t LEFT JOIN dompet_pos p ON p.id = t.pos_id
    WHERE t.kind = 'expense' AND t.date >= ? AND t.date <= ? GROUP BY t.pos_id ORDER BY amount DESC`).bind(from, to).all();
  return results;
}
const posBreakdown = (rows, total, max = 8) => rows.slice(0, max).map(r => `${r.emoji || '•'} ${esc(r.name || 'Tanpa pos')}: ${rp(r.amount)}${total ? ` (${Math.round(r.amount / total * 100)}%)` : ''}`)
  .concat(rows.length > max ? [`… dan ${rows.length - max} pos lain`] : []);

export async function textToday(env, today = witaDate()) {
  const [t, rows, { results: tx }] = await Promise.all([totals(env, today), spendByPos(env, today, today),
    env.DB.prepare(`SELECT t.amount, t.merchant, t.note, p.emoji FROM dompet_tx t LEFT JOIN dompet_pos p ON p.id = t.pos_id
      WHERE t.kind = 'expense' AND t.date = ? ORDER BY t.id DESC LIMIT 12`).bind(today).all()]);
  const L = [`📅 <b>${hari(today)}</b>: ${rp(t.today)}${t.yesterday ? ` (kemarin ${rp(t.yesterday)})` : ''}`];
  if (rows.length) L.push(...posBreakdown(rows, t.today));
  if (tx.length) L.push('', ...tx.map(x => `  ${x.emoji || '•'} ${rp(x.amount)} ${esc(x.merchant || x.note || '')}`.trimEnd()));
  if (!t.today) L.push('Belum ada pengeluaran hari ini.');
  L.push('', `Minggu ini ${rp(t.week)} · Bulan ini ${rp(t.month)}`);
  return L.join('\n');
}

export async function textWeek(env, today = witaDate()) {
  const w = monday(today), [t, rows, s] = await Promise.all([totals(env, today), spendByPos(env, w, today), series(env, today)]);
  const lastWeek = s.weekly.at(-2)?.amount || 0;
  const days = s.daily.filter(d => d.key >= w).map(d => `  ${hari(d.key).split(' ')[0].slice(0, 3)} ${rp(d.amount)}`);
  return [`🗓 <b>Minggu ini</b> (${tanggal(w)}–${tanggal(today)}): ${rp(t.week)}${lastWeek ? ` · minggu lalu ${rp(lastWeek)}` : ''}`,
    ...posBreakdown(rows, t.week), '', ...days].join('\n');
}

export async function textMonth(env, today = witaDate()) {
  const m = today.slice(0, 8) + '01', [t, rows] = await Promise.all([totals(env, today), spendByPos(env, m, today)]);
  const day = Number(today.slice(8)), dim = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate();
  const L = [`📆 <b>${MONTHS[Number(today.slice(5, 7)) - 1]} ${today.slice(0, 4)}</b>: ${rp(t.month)} keluar`];
  if (t.income_month) L.push(`💰 Masuk ${rp(t.income_month)} · selisih ${rp(t.income_month - t.month)}`);
  if (t.last_month_same_day) L.push(`Bulan lalu sampai tgl ${day}: ${rp(t.last_month_same_day)} (${pct((t.month - t.last_month_same_day) / t.last_month_same_day * 100, 0)})`);
  if (day > 3 && t.month) L.push(`Rata-rata ${rp(t.month / day)}/hari · perkiraan akhir bulan ${rp(t.month / day * dim)}`);
  L.push('', ...posBreakdown(rows, t.month, 12));
  return L.join('\n');
}

export async function textPos(env, today = witaDate()) {
  const pos = await posWithSpend(env, today);
  const L = ['🏷 <b>Pos & budget</b>'];
  for (const per of ['daily', 'weekly', 'monthly']) {
    const list = pos.filter(p => p.period === per);
    if (!list.length) continue;
    const used = list.filter(p => p.budget || p.spent), idle = list.filter(p => !p.budget && !p.spent);
    L.push('', `<b>${PERIOD_ID[per][0].toUpperCase() + PERIOD_ID[per].slice(1)}</b>`);
    for (const p of used) L.push(posLine(p) + (p.budget ? `\n   ${bar(p.pct)} ${p.pct}%` : ''));
    if (idle.length) L.push(`<i>Belum terpakai: ${idle.map(p => `${p.emoji || ''}${esc(p.name)}`).join(', ')}</i>`);
  }
  L.push('', 'Ubah budget: tulis misalnya "budget makan 150rb sehari" atau buka halaman Dompet.');
  return L.join('\n');
}

export async function portfolio(env, today = witaDate(), { history = false } = {}) {
  const [m, trades, inv] = await Promise.all([market(env, { history }), btcTrades(env), investments(env, today)]);
  const btc = btcSummary(trades, m.btc?.idr);
  // Without a BTC price the total would quietly leave the coins out: mark it partial instead.
  const partial = btc.btc > 0 && btc.value == null;
  return { market: m, trades, btc, invest: inv, total: (btc.value || 0) + inv.value, partial };
}

export function textBtcFrom(p) {
  const { market: m, btc } = p, L = [];
  if (m.btc) L.push(`₿ <b>Bitcoin</b> ${rupiah(m.btc.idr)}${m.btc.usd ? ` · $${Math.round(m.btc.usd).toLocaleString('en-US')}` : ''}${m.btc.change_24h != null ? ` (${pct(m.btc.change_24h)} 24 jam)` : ''}`);
  else L.push(`₿ Harga Bitcoin belum bisa diambil${m.errors.btc ? ` (${esc(m.errors.btc)})` : ''}`);
  if (btc.btc) {
    L.push(`Punya ${btcFmt(btc.btc)} BTC · modal ${rp(btc.cost)} (rata-rata ${rp(btc.avg_price)}/BTC)`);
    if (btc.value != null) L.push(`Nilai sekarang <b>${rp(btc.value)}</b> · ${btc.unrealised >= 0 ? 'untung' : 'rugi'} ${rp(Math.abs(btc.unrealised))} (${pct(btc.unrealised_pct)})`);
  } else L.push('Belum ada BTC tercatat. Kirim screenshot pembelian atau tulis "beli btc 0,001 seharga 1,6jt".');
  if (btc.realised) L.push(`Untung/rugi yang sudah dijual: ${rp(btc.realised)}`);
  return L.join('\n');
}

export function textIhsgFrom(p) {
  const q = p.market.ihsg;
  if (!q) return `📈 IHSG belum bisa diambil${p.market.errors.ihsg ? ` (${esc(p.market.errors.ihsg)})` : ''}`;
  const h = p.market.ihsg_history, month = h.length > 21 ? h.at(-22).close : null;
  return `📈 <b>IHSG</b> ${q.last.toLocaleString('id-ID', { maximumFractionDigits: 2 })}${q.change != null ? ` (${q.change >= 0 ? '+' : ''}${q.change.toLocaleString('id-ID', { maximumFractionDigits: 2 })}, ${pct(q.change_pct, 2)})` : ''}${q.date ? ` · ${tanggal(q.date)}` : ''}` +
    (month ? `\n1 bulan: ${pct((q.last - month) / month * 100)}` : '');
}

export function textInvestFrom(p) {
  const inv = p.invest, open = inv.list.filter(x => !x.closed_at);
  if (!open.length) return '🏦 Belum ada investasi berbunga. Tulis misalnya "deposito BCA 50jt 4,5% 6 bulan mulai 1 nov" atau kirim bukti penempatannya.';
  const L = [`🏦 <b>Investasi</b>: pokok ${rp(inv.principal)} · bunga bersih terkumpul ${rp(inv.earned)}`,
    `Bunga hari ini <b>${rupiah(inv.today)}</b> · 30 hari ke depan ±${rp(inv.next30)} · rata-rata ${inv.yield_pa.toLocaleString('id-ID', { maximumFractionDigits: 2 })}%/th bersih`, ''];
  for (const x of open) L.push(`• ${esc(x.name)} ${rp(x.principal)} @ ${x.rate_pa.toLocaleString('id-ID')}%${x.tax_pct ? ` (pajak ${x.tax_pct}%)` : ''}: +${rupiah(x.today_interest)}/hari, total ${rp(x.earned)}` +
    (x.matured ? ' · ✅ sudah jatuh tempo' : x.days_left != null ? ` · jatuh tempo ${tanggal(x.end_date)} (${x.days_left} hari)` : ''));
  return L.join('\n');
}

export function textPortoFrom(p) {
  return [`💼 <b>Portofolio</b>: <b>${rp(p.total)}</b>${p.partial ? ' (tanpa BTC, harga belum ada)' : ''}`,
    `₿ Bitcoin ${p.btc.value != null ? rp(p.btc.value) : '–'}${p.btc.unrealised_pct != null ? ` (${pct(p.btc.unrealised_pct)})` : ''}`,
    `🏦 Investasi ${rp(p.invest.value)} (bunga hari ini +${rupiah(p.invest.today)})`].join('\n');
}

/** Evening recap (21:00 WITA): today's spending, budgets at risk, markets and interest.
 *  Sunday evening adds the week's summary, the last day of the month adds the month's. */
export async function dailyRecap(env, today = witaDate()) {
  const [todayText, pos, p] = await Promise.all([textToday(env, today), posWithSpend(env, today), portfolio(env, today)]);
  const L = ['🌙 <b>Rekap Dompet</b>', '', todayText];
  const warns = budgetWarnings(pos);
  if (warns.length) L.push('', ...warns);
  L.push('', textBtcFrom(p), '', textIhsgFrom(p), '', textInvestFrom(p), '', textPortoFrom(p));
  const dow = new Date(today + 'T00:00:00Z').getUTCDay();
  if (dow === 0) L.push('', '— Tutup minggu —', await textWeek(env, today));
  const tomorrow = addDays(today, 1);
  if (tomorrow.endsWith('-01')) L.push('', '— Tutup bulan —', await textMonth(env, today));
  await snapshotPrices(env, p.market, p.partial ? null : p.total).catch(e => console.error('snapshot', e));
  return L.join('\n');
}
