// /api/dompet*: the Dompet page (public/dompet.html). Behind the Kantor sign-in (KANTOR_EMAILS only).
import { body, json, witaDate } from '../common.js';
import { addBtc, addTx, deleteBtc, deleteTx, ensureSchema, listTx, posWithSpend, saveInvest, savePos, series, totals, updateTx } from './db.js';
import { addDays } from './invest.js';
import { dailyRecap, portfolio } from './report.js';
import { send, setRecap, setupBot, status, telegramFile, tgState, unpair } from './telegram.js';

export async function dompetApi(req, env, url) {
  const p = url.pathname, m = req.method, today = witaDate();
  await ensureSchema(env);
  if (p === '/api/dompet' && m === 'GET') {
    const from = url.searchParams.get('from') || addDays(today, -62);
    const [t, pos, s, tx, porto, prices, bot] = await Promise.all([totals(env, today), posWithSpend(env, today, { all: true }), series(env, today),
      listTx(env, { from, to: addDays(today, 1), limit: 1000 }), portfolio(env, today, { history: true }),
      env.DB.prepare("SELECT date, close FROM dompet_prices WHERE symbol = 'PORTO' ORDER BY date DESC LIMIT 120").all().then(r => r.results.reverse()),
      status(env).catch(e => ({ error: e.message }))]);
    return json({ today, totals: t, pos, series: s, tx, tx_from: from, market: porto.market, btc: porto.btc, btc_trades: porto.trades,
      invest: porto.invest, porto_total: porto.total, porto_partial: porto.partial, porto_history: prices, bot });
  }
  if (p === '/api/dompet/export.csv' && m === 'GET') {
    const rows = await listTx(env, { from: url.searchParams.get('from'), to: url.searchParams.get('to'), limit: 5000 });
    const q = v => (v == null ? '' : /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = ['tanggal,jenis,jumlah,pos,periode,merchant,catatan,akun,sumber'].concat(rows.map(r =>
      [r.date, r.kind === 'income' ? 'masuk' : 'keluar', r.amount, r.pos_name, r.pos_period, r.merchant, r.note, r.account, r.source].map(q).join(','))).join('\n');
    return new Response('﻿' + csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="dompet-${today}.csv"`, 'cache-control': 'no-store' } });
  }
  const receipt = p.match(/^\/api\/dompet\/receipt\/(\d+)$/);
  if (receipt && m === 'GET') {
    const t = await env.DB.prepare('SELECT tg_file_id FROM dompet_tx WHERE id = ?').bind(Number(receipt[1])).first();
    if (!t?.tg_file_id || !env.DOMPET_BOT_TOKEN) return json({ error: 'Tidak ada bukti' }, 404);
    const f = await telegramFile(env, t.tg_file_id);
    const type = f.path.endsWith('.pdf') ? 'application/pdf' : f.path.endsWith('.png') ? 'image/png' : f.path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return new Response(f.buf, { headers: { 'content-type': type, 'cache-control': 'private, max-age=3600' } });
  }
  if (p === '/api/dompet' && m === 'POST') {
    const d = await body(req);
    try {
      switch (d.action) {
        case 'tx_add': return json({ ok: true, ...(await addTx(env, { ...d, member: d.member || 'kevin', source: 'web' })) });
        case 'tx_update': return json({ ok: true, tx: await updateTx(env, d.id, d) });
        case 'tx_delete': await deleteTx(env, d.id); return json({ ok: true });
        case 'pos_save': return json({ ok: true, pos: await savePos(env, d) });
        case 'pos_delete': {
          // A pos with history is archived (kept for old records); an unused one is removed.
          const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM dompet_tx WHERE pos_id = ?').bind(Number(d.id)).first();
          if (used.n) await env.DB.prepare('UPDATE dompet_pos SET archived = 1 WHERE id = ?').bind(Number(d.id)).run();
          else await env.DB.prepare('DELETE FROM dompet_pos WHERE id = ?').bind(Number(d.id)).run();
          return json({ ok: true, archived: !!used.n });
        }
        case 'btc_add': return json({ ok: true, trade: await addBtc(env, d) });
        case 'btc_delete': await deleteBtc(env, d.id); return json({ ok: true });
        case 'inv_save': return json({ ok: true, invest: await saveInvest(env, d) });
        case 'inv_close': await env.DB.prepare('UPDATE dompet_invest SET closed_at = ? WHERE id = ?').bind(d.reopen ? null : (d.date || today) + 'T00:00:00Z', Number(d.id)).run(); return json({ ok: true });
        case 'inv_delete': await env.DB.prepare('DELETE FROM dompet_invest WHERE id = ?').bind(Number(d.id)).run(); return json({ ok: true });
        case 'bot_setup': return json({ ok: true, bot: await setupBot(env, url.origin, d.who || 'kevin') });
        case 'bot_webhook': return json({ ok: true, bot: await setupBot(env, url.origin, null) });
        case 'bot_unpair': await unpair(env, d.who); return json({ ok: true, bot: await status(env) });
        case 'bot_recap': await setRecap(env, d.on); return json({ ok: true, bot: await status(env) });
        case 'bot_test': {
          // Kevin's recap to Kevin's chat (Mey's arrives with the evening run).
          const s = await tgState(env);
          if (!s.chats.kevin) return json({ error: 'Chat Kevin belum tersambung' }, 400);
          await send(env, s.chats.kevin.id, await dailyRecap(env, today, 'kevin'));
          return json({ ok: true });
        }
        default: return json({ error: 'Aksi tidak dikenal' }, 400);
      }
    } catch (e) {
      return json({ error: e.message || String(e) }, 400);
    }
  }
  return json({ error: 'Not found' }, 404);
}
