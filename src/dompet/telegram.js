// The Dompet bot on Telegram: Kevin's own bot (secret DOMPET_BOT_TOKEN, separate from the website's briefing bot,
// because a webhook bot cannot also be read with getUpdates). Telegram posts updates to /tele/dompet; the request must
// carry the secret header set at setWebhook, and only the chat paired with a one-time code from /dompet is answered.
import { getSetting, now, setSetting, witaDate } from '../common.js';
import { addBtc, addTx, deleteBtc, deleteTx, PERIOD_ID, posWithSpend, rp, savePos, saveInvest } from './db.js';
import { parseMessage } from './parse.js';
import { budgetWarnings, dailyRecap, esc, portfolio, posLine, tanggal, textBtcFrom, textIhsgFrom, textInvestFrom, textMonth, textPortoFrom, textPos, textToday, textTotals, textWeek } from './report.js';

const KEY = 'dompet_telegram';
export const WEBHOOK_PATH = '/tele/dompet';
const api = env => env.TELEGRAM_API || 'https://api.telegram.org';

export async function tg(env, method, body) {
  const r = await fetch(`${api(env)}/bot${env.DOMPET_BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const d = await r.json().catch(() => ({}));
  if (!d.ok) throw new Error(`Telegram ${method}: ${d.description || r.status}`);
  return d.result;
}
/** Secret header value Telegram sends back on every update (derived from the token, so there is no extra secret to keep). */
export async function webhookSecret(env) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('dompet-webhook:' + env.DOMPET_BOT_TOKEN));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}
export const tgState = async env => (await getSetting(env, KEY, null)) || {};
const saveState = (env, s) => setSetting(env, KEY, s);

const COMMANDS = [
  ['hari', 'Pengeluaran hari ini'], ['minggu', 'Pengeluaran minggu ini'], ['bulan', 'Pengeluaran bulan ini'],
  ['pos', 'Pos & sisa budget'], ['btc', 'Harga & portofolio Bitcoin'], ['ihsg', 'IHSG hari ini'],
  ['bunga', 'Bunga investasi hari ini'], ['porto', 'Total portofolio'], ['batal', 'Hapus catatan terakhir'],
  ['rekap', 'Rekap lengkap sekarang'], ['bantuan', 'Cara pakai'],
];
const HELP = `👛 <b>Dompet Kevin</b>
Kirim saja:
• Teks: "makan siang 45rb", "gojek 23k kemarin", "gaji masuk 15jt"
• Screenshot struk, mutasi bank, riwayat GoPay/OVO, atau PDF e-statement (boleh banyak transaksi sekaligus)
• Bitcoin: "beli btc 0,002 seharga 3,1jt" atau screenshot dari Indodax/Pintu
• Investasi: "deposito BCA 50jt 4,5% 6 bulan mulai 1 nov"
• Pos: "buat pos Kopi harian budget 50rb", "budget makan 150rb sehari"
• Tanya: "minggu ini habis berapa?"

Setiap catatan punya tombol 🗑 hapus dan 🏷 ganti pos.
Perintah: ${COMMANDS.map(c => '/' + c[0]).join(' ')}
Rekap otomatis tiap malam 21:00 WITA.`;

/** From /dompet: point the bot's webhook here, set the command menu and make a pairing code (valid 15 minutes). */
export async function setupBot(env, origin) {
  if (!env.DOMPET_BOT_TOKEN) throw new Error('Secret DOMPET_BOT_TOKEN belum diisi di worker likuloka-kantor');
  const me = await tg(env, 'getMe');
  const url = (env.DOMPET_WEBHOOK_BASE || origin).replace(/\/$/, '') + WEBHOOK_PATH;
  await tg(env, 'setWebhook', { url, secret_token: await webhookSecret(env), allowed_updates: ['message', 'callback_query'], drop_pending_updates: true, max_connections: 1 });
  await tg(env, 'setMyCommands', { commands: COMMANDS.map(([command, description]) => ({ command, description })) });
  const s = await tgState(env);
  s.bot = { username: me.username, name: me.first_name };
  s.pair = { code: String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)), until: new Date(Date.now() + 15 * 60e3).toISOString() };
  s.webhook_url = url;
  s.recap ??= true;
  await saveState(env, s);
  return status(env);
}

/** What /dompet shows about the bot: connected chat, webhook health (Access blocking it shows here), pairing code. */
export async function status(env) {
  const s = await tgState(env);
  const out = { token: !!env.DOMPET_BOT_TOKEN, claude: !!env.ANTHROPIC_API_KEY, bot: s.bot || null, chat: s.chat || null, recap: s.recap !== false,
    pair: s.pair && s.pair.until > now() && !s.chat ? s.pair : null, last_recap: s.last_recap || null };
  if (env.DOMPET_BOT_TOKEN && s.bot) {
    try {
      const w = await tg(env, 'getWebhookInfo');
      out.webhook = { url: w.url, pending: w.pending_update_count, error: w.last_error_message || null, error_at: w.last_error_date ? new Date(w.last_error_date * 1000).toISOString() : null };
    } catch (e) { out.webhook = { error: e.message }; }
  }
  return out;
}
export async function unpair(env) { const s = await tgState(env); delete s.chat; delete s.pair; await saveState(env, s); }
export async function setRecap(env, on) { const s = await tgState(env); s.recap = !!on; await saveState(env, s); }

export async function send(env, chatId, text, extra = {}) {
  const parts = [];
  let rest = text;
  while (rest.length > 3900) { let cut = rest.lastIndexOf('\n', 3900); if (cut < 1000) cut = 3900; parts.push(rest.slice(0, cut)); rest = rest.slice(cut).replace(/^\n/, ''); }
  parts.push(rest);
  let last;
  for (let i = 0; i < parts.length; i++)
    last = await tg(env, 'sendMessage', { chat_id: chatId, text: parts[i], parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(i === parts.length - 1 ? extra : {}) });
  return last;
}

function toBase64(buf) {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
/** Downloads a Telegram file (photo, image document or PDF) for Claude. */
export async function telegramFile(env, fileId) {
  const f = await tg(env, 'getFile', { file_id: fileId });
  const r = await fetch(`${api(env)}/file/bot${env.DOMPET_BOT_TOKEN}/${f.file_path}`);
  if (!r.ok) throw new Error(`Telegram file ${r.status}`);
  return { buf: await r.arrayBuffer(), path: f.file_path };
}
const mediaType = (path, mime) => {
  if (mime && /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(mime)) return mime;
  const ext = (path.split('.').pop() || '').toLowerCase();
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' }[ext] || 'image/jpeg';
};

/** Webhook entry: checks the secret, answers 200 at once and does the work after the response. */
export async function handleWebhook(req, env, ctx) {
  if (!env.DOMPET_BOT_TOKEN) return new Response('not configured', { status: 404 });
  if (req.headers.get('x-telegram-bot-api-secret-token') !== await webhookSecret(env)) return new Response('forbidden', { status: 403 });
  const update = await req.json().catch(() => null);
  if (!update) return new Response('ok');
  // Answer when done, or after 25 s at the latest (a long PDF statement): the rest then runs in waitUntil.
  // With max_connections 1 Telegram sends the next update only after this one, so album photos come in order.
  const job = handleUpdate(env, update).catch(e => console.error('dompet update', e));
  ctx.waitUntil(job);
  await Promise.race([job, new Promise(r => setTimeout(r, 25e3))]);
  return new Response('ok');
}

async function handleUpdate(env, u) {
  const s = await tgState(env);
  if (u.update_id && (s.seen || []).includes(u.update_id)) return; // Telegram retry of an update already handled
  const msg = u.message, cb = u.callback_query;
  const chat = msg?.chat || cb?.message?.chat;
  if (!chat || chat.type !== 'private') return;
  const text = (msg?.text || msg?.caption || '').trim();

  // Pairing: "/start 123456" with the code shown on /dompet.
  if (!s.chat || String(s.chat.id) !== String(chat.id)) {
    const code = text.match(/^\/start\s+(\d{6})$/)?.[1];
    if (!s.chat && code && s.pair?.code === code && s.pair.until > now()) {
      s.chat = { id: chat.id, name: [chat.first_name, chat.last_name].filter(Boolean).join(' '), username: chat.username || null, at: now() };
      delete s.pair; s.seen = [u.update_id]; await saveState(env, s);
      await send(env, chat.id, '✅ Dompet tersambung ke chat ini.\n\n' + HELP);
    } else if (msg) await send(env, chat.id, 'Bot ini pribadi. Sambungkan dari halaman Dompet di Kantor (tombol "Sambungkan bot").');
    return;
  }
  s.seen = [...(s.seen || []), u.update_id].slice(-50); delete s.last_update_id; await saveState(env, s);
  if (cb) return handleCallback(env, cb);
  if (!msg) return;

  const cmd = text.match(/^\/([a-z_]+)(?:@\w+)?/i)?.[1]?.toLowerCase();
  if (cmd) return command(env, chat.id, cmd);

  const fileId = msg.photo?.length ? msg.photo.at(-1).file_id : msg.document && /^(image\/|application\/pdf)/.test(msg.document.mime_type || '') ? msg.document.file_id : null;
  if (!text && !fileId) return send(env, chat.id, 'Kirim teks, screenshot, atau PDF. /bantuan untuk contoh.');
  if (msg.document && msg.document.file_size > 15e6) return send(env, chat.id, 'File terlalu besar (maks 15 MB). Kirim per halaman atau sebagai foto.');
  await tg(env, 'sendChatAction', { chat_id: chat.id, action: 'typing' }).catch(() => {});

  let media = null;
  if (fileId) {
    const f = await telegramFile(env, fileId);
    media = { media_type: mediaType(f.path, msg.document?.mime_type), data: toBase64(f.buf) };
  }
  const today = witaDate();
  let out;
  try { out = await parseMessage(env, { text, media, today, pos: await posWithSpend(env, today) }); }
  catch (e) { return send(env, chat.id, `⚠️ ${esc(e.message)}`); }

  const source = msg.photo ? 'telegram_photo' : msg.document ? 'telegram_file' : 'telegram_text';
  const lines = [], buttons = [], batch = [], newPos = [];
  for (const it of out.items || []) {
    try {
      if (it.type === 'expense' || it.type === 'income') {
        if (!it.amount) continue;
        const r = await addTx(env, { kind: it.type, date: it.date, amount: it.amount, pos: it.pos, pos_period: it.pos_period, pos_emoji: it.pos_emoji,
          merchant: it.merchant, note: it.note, account: it.account, source, tg_file_id: fileId, tg_chat_msg: msg.message_id });
        if (r.pos?.created) newPos.push(r.pos);
        batch.push({ t: 'tx', id: r.tx.id });
        const who = esc(r.tx.merchant || r.tx.note || '');
        lines.push(it.type === 'income'
          ? `💰 Masuk ${rp(r.tx.amount)}${who ? ' · ' + who : ''}${r.tx.account ? ` → ${esc(r.tx.account)}` : ''}${r.tx.date !== today ? ` (${tanggal(r.tx.date)})` : ''}`
          : `${r.pos?.emoji || '•'} <b>${rp(r.tx.amount)}</b> ${esc(r.pos?.name || '')}${who ? ' · ' + who : ''}${r.tx.date !== today ? ` (${tanggal(r.tx.date)})` : ''}${r.duplicate_of ? ` ⚠️ mirip #${r.duplicate_of}` : ''}`);
        buttons.push(it.type === 'income' ? [{ text: `🗑 #${r.tx.id}`, callback_data: `d:tx:${r.tx.id}` }]
          : [{ text: `🗑 #${r.tx.id}`, callback_data: `d:tx:${r.tx.id}` }, { text: `🏷 Ganti pos #${r.tx.id}`, callback_data: `p:${r.tx.id}` }]);
      } else if (it.type === 'btc_buy' || it.type === 'btc_sell') {
        const b = await addBtc(env, { side: it.type === 'btc_sell' ? 'sell' : 'buy', btc: it.btc, idr: it.amount, date: it.date, exchange: it.merchant, note: it.note, source });
        batch.push({ t: 'btc', id: b.id });
        lines.push(`₿ ${b.side === 'buy' ? 'Beli' : 'Jual'} ${b.btc.toLocaleString('id-ID', { maximumFractionDigits: 8 })} BTC · ${rp(b.idr)} (${rp(b.idr / b.btc)}/BTC)${b.exchange ? ' · ' + esc(b.exchange) : ''}`);
        buttons.push([{ text: `🗑 BTC #${b.id}`, callback_data: `d:btc:${b.id}` }]);
      } else if (it.type === 'investment') {
        const v = await saveInvest(env, { name: it.merchant || it.note || it.invest_kind, kind: it.invest_kind, principal: it.amount, rate_pa: it.rate_pa,
          compounding: it.compounding, tax_pct: it.tax_pct, start_date: it.date, end_date: it.end_date, note: it.note, source });
        batch.push({ t: 'inv', id: v.id });
        const perDay = v.principal * v.rate_pa / 100 / 365 * (1 - v.tax_pct / 100);
        lines.push(`🏦 ${esc(v.name)} ${rp(v.principal)} @ ${v.rate_pa.toLocaleString('id-ID')}%/th${v.tax_pct ? ` (pajak ${v.tax_pct.toLocaleString('id-ID')}%)` : ''} → ±${rp(perDay)}/hari${v.end_date ? ` · jatuh tempo ${tanggal(v.end_date)}` : ''}`);
        buttons.push([{ text: `🗑 Investasi #${v.id}`, callback_data: `d:inv:${v.id}` }]);
      } else if (it.type === 'pos') {
        const p = await savePos(env, { name: it.pos, period: it.pos_period, budget: it.amount, emoji: it.pos_emoji });
        lines.push(`🏷 Pos ${p.emoji || ''} ${esc(p.name)} (${PERIOD_ID[p.period]})${p.budget ? ` budget ${rp(p.budget)}` : ''} ${p.created ? 'dibuat' : 'disimpan'}`);
      }
    } catch (e) { lines.push(`⚠️ Tidak tersimpan: ${esc(e.message)}`); }
  }
  if (batch.length) { s.last_batch = { items: batch, at: now() }; await saveState(env, s); }

  const L = [];
  if (lines.length) L.push(`✅ Tercatat${lines.length > 1 ? ` ${lines.length}` : ''}`, ...lines);
  for (const p of newPos) L.push(`🆕 Pos baru: ${p.emoji || ''} ${esc(p.name)} (${PERIOD_ID[p.period]}). Atur budget di halaman Dompet.`);
  if (out.skipped) L.push(...(L.length ? [''] : []), `↪️ ${esc(out.skipped)}`);
  if (out.reply) L.push(...(L.length ? [''] : []), esc(out.reply));
  if (batch.some(b => b.t === 'tx')) {
    const pos = await posWithSpend(env, today);
    const touched = new Set((await Promise.all(batch.filter(b => b.t === 'tx').map(b => env.DB.prepare('SELECT pos_id FROM dompet_tx WHERE id = ?').bind(b.id).first()))).map(r => r?.pos_id));
    const mine = pos.filter(p => touched.has(p.id));
    L.push('', await textTotals(env, today), ...mine.filter(p => p.budget).map(posLine), ...budgetWarnings(mine));
  }
  if (out.query && out.query !== 'none') { const q = await queryText(env, out.query); if (q) L.push(...(L.length ? [''] : []), q); }
  if (!L.length) L.push('Tidak ada yang bisa dicatat dari pesan ini. /bantuan untuk contoh.');
  // Telegram allows up to 100 buttons; long statements keep the first 30 rows of buttons.
  return send(env, chat.id, L.join('\n'), buttons.length ? { reply_markup: { inline_keyboard: buttons.slice(0, 30) } } : {});
}

async function queryText(env, q) {
  const today = witaDate();
  if (q === 'today') return textToday(env, today);
  if (q === 'week') return textWeek(env, today);
  if (q === 'month') return textMonth(env, today);
  if (q === 'pos') return textPos(env, today);
  if (q === 'help') return HELP;
  const p = await portfolio(env, today);
  if (q === 'btc') return textBtcFrom(p);
  if (q === 'ihsg') return textIhsgFrom(p);
  if (q === 'invest') return textInvestFrom(p);
  if (q === 'porto') return [textPortoFrom(p), '', textBtcFrom(p), '', textInvestFrom(p)].join('\n');
  return null;
}

async function command(env, chatId, cmd) {
  const map = { hari: 'today', today: 'today', minggu: 'week', bulan: 'month', pos: 'pos', btc: 'btc', bitcoin: 'btc', ihsg: 'ihsg',
    bunga: 'invest', invest: 'invest', investasi: 'invest', porto: 'porto', portofolio: 'porto', bantuan: 'help', help: 'help', start: 'help' };
  if (cmd === 'rekap') return send(env, chatId, await dailyRecap(env));
  if (cmd === 'batal') {
    const s = await tgState(env), b = s.last_batch;
    if (!b?.items?.length) return send(env, chatId, 'Tidak ada catatan terakhir untuk dibatalkan.');
    for (const it of b.items) await removeItem(env, it.t, it.id);
    delete s.last_batch; await saveState(env, s);
    return send(env, chatId, `↩️ ${b.items.length} catatan terakhir dihapus.\n${await textTotals(env)}`);
  }
  const q = map[cmd];
  return send(env, chatId, q ? await queryText(env, q) : 'Perintah tidak dikenal. /bantuan');
}

async function removeItem(env, t, id) {
  if (t === 'tx') return deleteTx(env, id);
  if (t === 'btc') return deleteBtc(env, id);
  if (t === 'inv') return env.DB.prepare('DELETE FROM dompet_invest WHERE id = ?').bind(Number(id)).run();
}

/** Buttons under a record: d:<t>:<id> delete, p:<tx> choose a pos, s:<tx>:<pos> set it, x close the chooser. */
async function handleCallback(env, cb) {
  const [a, b, c] = String(cb.data || '').split(':');
  const chatId = cb.message.chat.id, msgId = cb.message.message_id;
  const answer = text => tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, ...(text ? { text } : {}) }).catch(() => {});
  if (a === 'd') {
    await removeItem(env, b, c);
    await answer('Dihapus');
    return send(env, chatId, `🗑 #${esc(c)} dihapus. ${await textTotals(env)}`);
  }
  if (a === 'p') {
    const pos = await posWithSpend(env);
    const rows = [];
    for (let i = 0; i < pos.length; i += 2) rows.push(pos.slice(i, i + 2).map(p => ({ text: `${p.emoji || ''} ${p.name}`.trim(), callback_data: `s:${b}:${p.id}` })));
    rows.push([{ text: '✖️ Batal', callback_data: 'x' }]);
    await answer();
    return tg(env, 'sendMessage', { chat_id: chatId, text: `Pilih pos untuk #${b}:`, reply_markup: { inline_keyboard: rows } });
  }
  if (a === 's') {
    const t = await env.DB.prepare('SELECT id FROM dompet_tx WHERE id = ?').bind(Number(b)).first();
    if (!t) { await answer('Transaksi sudah tidak ada'); return; }
    await env.DB.prepare('UPDATE dompet_tx SET pos_id = ? WHERE id = ?').bind(Number(c), Number(b)).run();
    const p = await env.DB.prepare('SELECT name, emoji FROM dompet_pos WHERE id = ?').bind(Number(c)).first();
    await answer(`Pindah ke ${p?.name || 'pos'}`);
    return tg(env, 'editMessageText', { chat_id: chatId, message_id: msgId, text: `🏷 #${b} → ${p?.emoji || ''} ${p?.name || ''}` });
  }
  if (a === 'x') { await answer(); return tg(env, 'deleteMessage', { chat_id: chatId, message_id: msgId }).catch(() => {}); }
  return answer();
}

/** Cron, 21:00 WITA: the evening recap to the paired chat (unless switched off on /dompet). */
export async function sendDailyRecap(env) {
  const s = await tgState(env);
  if (!env.DOMPET_BOT_TOKEN || !s.chat || s.recap === false) return { skipped: true };
  const today = witaDate();
  if (s.last_recap === today) return { skipped: 'sent' };
  await send(env, s.chat.id, await dailyRecap(env, today));
  s.last_recap = today; await saveState(env, s);
  return { ok: true };
}
