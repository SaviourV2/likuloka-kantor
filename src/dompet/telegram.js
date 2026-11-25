// The Dompet bot on Telegram, shared by Kevin and Mey (secret DOMPET_BOT_TOKEN, separate from the website's briefing
// bot, because a webhook bot cannot also be read with getUpdates). Telegram posts updates to /tele/dompet; the request
// must carry the secret header set at setWebhook. Three chats can be paired with one-time codes from /dompet:
// Kevin's private chat, Mey's private chat and their shared group (Kevin, Mey and the bot). Anyone else is ignored.
// In the group, spending is shared ('bersama') unless clearly personal; in a private chat it is the sender's own
// unless clearly shared. Both see everything; Bitcoin, investments and the portfolio are Kevin's only.
import { getSetting, now, setSetting, witaDate } from '../common.js';
import { addBtc, addTx, deleteBtc, deleteTx, ensureSchema, MEMBERS, ownerLabel, PERIOD_ID, posWithSpend, rp, savePos, saveInvest } from './db.js';
import { parseMessage } from './parse.js';
import { budgetWarnings, dailyRecap, esc, portfolio, posLine, tanggal, textBtcFrom, textIhsgFrom, textInvestFrom, textMonth, textPortoFrom, textPos, textToday, textTotals, textWeek } from './report.js';

const KEY = 'dompet_telegram';
export const WEBHOOK_PATH = '/tele/dompet';
export const CHATS = { kevin: 'Kevin', mey: 'Mey', group: 'Grup bersama' };
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

/** Bot state (ops_settings 'dompet_telegram'). The first release kept one chat in `chat`: that becomes Kevin's. */
export async function tgState(env) {
  const s = (await getSetting(env, KEY, null)) || {};
  s.chats ||= {};
  if (s.chat) { s.chats.kevin ||= { ...s.chat, user_id: s.chat.id, last_recap: s.last_recap || null }; delete s.chat; delete s.last_recap; }
  if (s.last_batch?.items) s.last_batch = { kevin: s.last_batch };
  s.last_batch ||= {};
  return s;
}
const saveState = (env, s) => setSetting(env, KEY, s);
/** Which member a Telegram user is (their private chat was paired; in a private chat the user id is the chat id). */
const memberOf = (s, userId) => Object.keys(MEMBERS).find(k => s.chats[k] && String(s.chats[k].user_id ?? s.chats[k].id) === String(userId));

const COMMANDS = [
  ['hari', 'Pengeluaran hari ini'], ['minggu', 'Pengeluaran minggu ini'], ['bulan', 'Pengeluaran bulan ini'],
  ['pos', 'Pos & sisa budget'], ['btc', 'Harga Bitcoin (dan portofolio Kevin)'], ['ihsg', 'IHSG hari ini'],
  ['bunga', 'Bunga investasi hari ini (Kevin)'], ['porto', 'Total portofolio (Kevin)'], ['batal', 'Hapus catatan terakhirku'],
  ['rekap', 'Rekap lengkap sekarang'], ['bantuan', 'Cara pakai'],
];
const help = who => `👛 <b>Dompet Kevin & Mey</b>
Kirim saja:
• Teks: "makan siang 45rb", "gojek 23k kemarin", "gaji masuk 15jt"
• Screenshot struk, mutasi bank, riwayat GoPay/OVO, atau PDF e-statement (boleh banyak transaksi sekaligus)
• Bersama atau sendiri: di <b>grup</b> otomatis masuk pos 👥 Bersama; di <b>chat pribadi</b> masuk pos sendiri, kecuali ditulis "bersama" / "berdua" (mis. "belanja dapur berdua 320rb").
• Pos: "buat pos Kopi harian budget 50rb", "buat pos Belanja dapur bersama mingguan 1jt"
• Tanya: "minggu ini habis berapa?"${who === 'kevin' || who === 'group' ? `
• Kevin saja: Bitcoin ("beli btc 0,002 seharga 3,1jt") dan investasi ("deposito BCA 50jt 4,5% 6 bulan mulai 1 nov")` : ''}

Setiap catatan punya tombol 🗑 hapus dan 🏷 ganti pos.
Perintah: ${COMMANDS.map(c => '/' + c[0]).join(' ')}
Rekap otomatis tiap malam 21:00 WITA di chat pribadi.`;

/** From /dompet: point the bot's webhook here, set the command menu and, unless `who` is null, make a pairing code
 *  (15 minutes) for Kevin's chat, Mey's chat or the shared group. */
export async function setupBot(env, origin, who = 'kevin') {
  if (!env.DOMPET_BOT_TOKEN) throw new Error('Secret DOMPET_BOT_TOKEN belum diisi di worker likuloka-kantor');
  if (who !== null && !CHATS[who]) throw new Error('Pilih Kevin, Mey atau grup');
  const me = await tg(env, 'getMe');
  const url = (env.DOMPET_WEBHOOK_BASE || origin).replace(/\/$/, '') + WEBHOOK_PATH;
  await tg(env, 'setWebhook', { url, secret_token: await webhookSecret(env), allowed_updates: ['message', 'callback_query'], drop_pending_updates: true, max_connections: 1 });
  await tg(env, 'setMyCommands', { commands: COMMANDS.map(([command, description]) => ({ command, description })) });
  const s = await tgState(env);
  s.bot = { username: me.username, name: me.first_name, reads_groups: !!me.can_read_all_group_messages };
  if (who) s.pair = { who, code: String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)), until: new Date(Date.now() + 15 * 60e3).toISOString() };
  s.webhook_url = url;
  s.recap ??= true;
  await saveState(env, s);
  return status(env);
}

/** What /dompet shows about the bot: paired chats, webhook health (Access blocking it shows here), pairing code,
 *  and whether the bot can read ordinary group messages (BotFather's Group Privacy must be off for the group). */
export async function status(env) {
  const s = await tgState(env);
  const out = { token: !!env.DOMPET_BOT_TOKEN, claude: !!env.ANTHROPIC_API_KEY, bot: s.bot || null, chats: s.chats, recap: s.recap !== false,
    pair: s.pair && s.pair.until > now() ? s.pair : null };
  if (env.DOMPET_BOT_TOKEN && s.bot) {
    try {
      const [w, me] = await Promise.all([tg(env, 'getWebhookInfo'), tg(env, 'getMe')]);
      out.bot = { ...s.bot, reads_groups: !!me.can_read_all_group_messages };
      out.webhook = { url: w.url, pending: w.pending_update_count, error: w.last_error_message || null, error_at: w.last_error_date ? new Date(w.last_error_date * 1000).toISOString() : null };
    } catch (e) { out.webhook = { error: e.message }; }
  }
  return out;
}
export async function unpair(env, who) {
  const s = await tgState(env);
  if (who && CHATS[who]) delete s.chats[who]; else s.chats = {};
  delete s.pair; await saveState(env, s);
}
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

/** Webhook entry: checks the secret, answers when done (25 s at most) and finishes the rest after the response. */
export async function handleWebhook(req, env, ctx) {
  if (!env.DOMPET_BOT_TOKEN) return new Response('not configured', { status: 404 });
  if (req.headers.get('x-telegram-bot-api-secret-token') !== await webhookSecret(env)) return new Response('forbidden', { status: 403 });
  const update = await req.json().catch(() => null);
  if (!update) return new Response('ok');
  // With max_connections 1 Telegram sends the next update only after this one, so album photos come in order.
  const job = handleUpdate(env, update).catch(e => console.error('dompet update', e));
  ctx.waitUntil(job);
  await Promise.race([job, new Promise(r => setTimeout(r, 25e3))]);
  return new Response('ok');
}

// In the group Kevin and Mey also simply chat; only messages that look like money go to Claude.
const looksLikeMoney = (text, botName) => /\d/.test(text) || (botName && text.toLowerCase().includes('@' + botName.toLowerCase()))
  || /\b(berapa|habis|pengeluaran|budget|rekap|sisa|catat|pos)\b/i.test(text);

async function handleUpdate(env, u) {
  await ensureSchema(env);
  const s = await tgState(env);
  if (u.update_id && (s.seen || []).includes(u.update_id)) return; // Telegram retry of an update already handled
  const msg = u.message, cb = u.callback_query;
  const chat = msg?.chat || cb?.message?.chat, from = msg?.from || cb?.from;
  if (!chat || !from) return;
  const isGroup = chat.type === 'group' || chat.type === 'supergroup';
  if (!isGroup && chat.type !== 'private') return;
  const text = (msg?.text || msg?.caption || '').trim();

  // A group that becomes a supergroup gets a new id.
  if (msg?.migrate_to_chat_id && s.chats.group && String(s.chats.group.id) === String(chat.id)) {
    s.chats.group.id = msg.migrate_to_chat_id; await saveState(env, s); return;
  }

  // Pairing: "/start 123456" with the code shown on /dompet (in the group also "/start@bot 123456").
  const code = text.match(/^\/start(?:@\w+)?\s+(\d{6})$/)?.[1];
  if (code && s.pair?.code === code && s.pair.until > now()) {
    const who = s.pair.who || 'kevin';
    if ((who === 'group') !== isGroup) return send(env, chat.id, who === 'group' ? 'Kode ini untuk grup: kirim di grup bersama Kevin, Mey dan bot.' : `Kode ini untuk chat pribadi ${MEMBERS[who]} dengan bot.`);
    const taken = !isGroup && Object.keys(MEMBERS).find(k => k !== who && s.chats[k] && String(s.chats[k].id) === String(chat.id));
    if (taken) return send(env, chat.id, `Chat ini sudah tersambung sebagai ${MEMBERS[taken]}. Putuskan dulu di halaman Dompet.`);
    s.chats[who] = isGroup ? { id: chat.id, title: chat.title || 'Grup', at: now() }
      : { id: chat.id, user_id: from.id, name: [from.first_name, from.last_name].filter(Boolean).join(' '), username: from.username || null, at: now() };
    delete s.pair; s.seen = [...(s.seen || []), u.update_id].slice(-50); await saveState(env, s);
    const hi = who === 'group' ? '✅ Grup ini tersambung sebagai grup bersama Kevin & Mey. Pengeluaran yang dikirim di sini masuk pos 👥 Bersama.'
      : `✅ Dompet tersambung untuk ${MEMBERS[who]}.`;
    const groupNote = who === 'group' && !s.bot?.reads_groups ? '\n\n⚠️ Bot belum bisa membaca pesan biasa di grup. Di @BotFather: /setprivacy → pilih bot → Disable, lalu keluarkan dan masukkan lagi bot ke grup.' : '';
    return send(env, chat.id, `${hi}${groupNote}\n\n${help(who)}`);
  }

  // Who is talking, and is this a paired chat?
  const member = memberOf(s, from.id);
  const paired = isGroup ? !!s.chats.group && String(s.chats.group.id) === String(chat.id) : !!member && String(s.chats[member].id) === String(chat.id);
  if (!paired || !member) {
    if (!isGroup && msg) await send(env, chat.id, 'Bot ini pribadi untuk Kevin & Mey. Sambungkan dari halaman Dompet di Kantor.');
    return; // an unpaired group, or someone else in the group: stay silent
  }
  s.seen = [...(s.seen || []), u.update_id].slice(-50); await saveState(env, s);
  const ctx = { chatId: chat.id, member, where: isGroup ? 'group' : 'private' };
  if (cb) return handleCallback(env, cb, ctx);
  if (!msg) return;

  const cmd = text.match(/^\/([a-z_]+)(?:@\w+)?/i)?.[1]?.toLowerCase();
  if (cmd) return command(env, ctx, cmd);

  const fileId = msg.photo?.length ? msg.photo.at(-1).file_id : msg.document && /^(image\/|application\/pdf)/.test(msg.document.mime_type || '') ? msg.document.file_id : null;
  if (!text && !fileId) return isGroup ? null : send(env, chat.id, 'Kirim teks, screenshot, atau PDF. /bantuan untuk contoh.');
  if (isGroup && !fileId && !looksLikeMoney(text, s.bot?.username)) return;
  if (msg.document && msg.document.file_size > 15e6) return send(env, chat.id, 'File terlalu besar (maks 15 MB). Kirim per halaman atau sebagai foto.');
  await tg(env, 'sendChatAction', { chat_id: chat.id, action: 'typing' }).catch(() => {});
  return record(env, s, ctx, msg, text, fileId);
}

/** Reads one message with Claude and records what is in it; replies in the same chat. */
async function record(env, s, ctx, msg, text, fileId) {
  const { chatId, member, where } = ctx, owners = ['bersama', member], today = witaDate();
  let media = null;
  if (fileId) {
    const f = await telegramFile(env, fileId);
    media = { media_type: mediaType(f.path, msg.document?.mime_type), data: toBase64(f.buf) };
  }
  let out;
  try { out = await parseMessage(env, { text, media, today, pos: await posWithSpend(env, today, { owners }), sender: MEMBERS[member], where }); }
  catch (e) { return send(env, chatId, `⚠️ ${esc(e.message)}`); }

  const source = msg.photo ? 'telegram_photo' : msg.document ? 'telegram_file' : 'telegram_text';
  const lines = [], shared = [], buttons = [], batch = [], newPos = [], touched = new Set();
  let kevinOnly = false;
  for (const it of out.items || []) {
    try {
      // Whose spending Claude says this is decides the pos: a shared item never lands in a personal pos of the same name.
      const owner = it.pos_owner === 'bersama' ? 'bersama' : member;
      if (it.type === 'expense' || it.type === 'income') {
        if (!it.amount) continue;
        const r = await addTx(env, { kind: it.type, date: it.date, amount: it.amount, pos: it.pos, pos_period: it.pos_period, pos_emoji: it.pos_emoji,
          merchant: it.merchant, note: it.note, account: it.account, source, tg_file_id: fileId, tg_chat_msg: msg.message_id, member, owner, owners: [owner] });
        if (r.pos?.created) newPos.push(r.pos);
        batch.push({ t: 'tx', id: r.tx.id });
        if (r.pos) touched.add(r.pos.id);
        const who = esc(r.tx.merchant || r.tx.note || ''), when = r.tx.date !== today ? ` (${tanggal(r.tx.date)})` : '';
        const line = it.type === 'income'
          ? `💰 Masuk ${rp(r.tx.amount)}${who ? ' · ' + who : ''}${r.tx.account ? ` → ${esc(r.tx.account)}` : ''}${when}`
          : `${r.pos?.emoji || '•'} <b>${rp(r.tx.amount)}</b> ${esc(r.pos?.name || '')}${r.owner === 'bersama' ? ' 👥' : ''}${who ? ' · ' + who : ''}${when}${r.duplicate_of ? ` ⚠️ mirip #${r.duplicate_of}` : ''}`;
        lines.push(line);
        if (it.type === 'expense' && r.owner === 'bersama') shared.push(line);
        buttons.push(it.type === 'income' ? [{ text: `🗑 #${r.tx.id}`, callback_data: `d:tx:${r.tx.id}` }]
          : [{ text: `🗑 #${r.tx.id}`, callback_data: `d:tx:${r.tx.id}` }, { text: `🏷 Ganti pos #${r.tx.id}`, callback_data: `p:${r.tx.id}` }]);
      } else if (it.type === 'btc_buy' || it.type === 'btc_sell' || it.type === 'investment') {
        if (member !== 'kevin') { kevinOnly = true; continue; }
        if (it.type === 'investment') {
          const v = await saveInvest(env, { name: it.merchant || it.note || it.invest_kind, kind: it.invest_kind, principal: it.amount, rate_pa: it.rate_pa,
            compounding: it.compounding, tax_pct: it.tax_pct, start_date: it.date, end_date: it.end_date, note: it.note, source });
          batch.push({ t: 'inv', id: v.id });
          const perDay = v.principal * v.rate_pa / 100 / 365 * (1 - v.tax_pct / 100);
          lines.push(`🏦 ${esc(v.name)} ${rp(v.principal)} @ ${v.rate_pa.toLocaleString('id-ID')}%/th${v.tax_pct ? ` (pajak ${v.tax_pct.toLocaleString('id-ID')}%)` : ''} → ±${rp(perDay)}/hari${v.end_date ? ` · jatuh tempo ${tanggal(v.end_date)}` : ''}`);
          buttons.push([{ text: `🗑 Investasi #${v.id}`, callback_data: `d:inv:${v.id}` }]);
        } else {
          const b = await addBtc(env, { side: it.type === 'btc_sell' ? 'sell' : 'buy', btc: it.btc, idr: it.amount, date: it.date, exchange: it.merchant, note: it.note, source });
          batch.push({ t: 'btc', id: b.id });
          lines.push(`₿ ${b.side === 'buy' ? 'Beli' : 'Jual'} ${b.btc.toLocaleString('id-ID', { maximumFractionDigits: 8 })} BTC · ${rp(b.idr)} (${rp(b.idr / b.btc)}/BTC)${b.exchange ? ' · ' + esc(b.exchange) : ''}`);
          buttons.push([{ text: `🗑 BTC #${b.id}`, callback_data: `d:btc:${b.id}` }]);
        }
      } else if (it.type === 'pos') {
        const p = await savePos(env, { name: it.pos, period: it.pos_period, budget: it.amount, emoji: it.pos_emoji, owner, owners: [owner] });
        lines.push(`🏷 Pos ${p.emoji || ''} ${esc(p.name)} · ${ownerLabel(p.owner)} (${PERIOD_ID[p.period]})${p.budget ? ` budget ${rp(p.budget)}` : ''} ${p.created ? 'dibuat' : 'disimpan'}`);
      }
    } catch (e) { lines.push(`⚠️ Tidak tersimpan: ${esc(e.message)}`); }
  }
  if (batch.length) { s.last_batch[member] = { items: batch, at: now() }; await saveState(env, s); }

  const L = [];
  if (lines.length) L.push(`✅ Tercatat${lines.length > 1 ? ` ${lines.length}` : ''}`, ...lines);
  for (const p of newPos) L.push(`🆕 Pos baru: ${p.emoji || ''} ${esc(p.name)} · ${ownerLabel(p.owner)} (${PERIOD_ID[p.period]}). Atur budget di halaman Dompet.`);
  if (kevinOnly) L.push('ℹ️ Bitcoin dan investasi hanya dicatat untuk Kevin.');
  if (out.skipped) L.push(...(L.length ? [''] : []), `↪️ ${esc(out.skipped)}`);
  if (out.reply) L.push(...(L.length ? [''] : []), esc(out.reply));
  if (touched.size) {
    const pos = (await posWithSpend(env, today)).filter(p => touched.has(p.id));
    const ownersTouched = [...new Set(pos.map(p => p.owner))];
    L.push('', ...(await Promise.all(ownersTouched.map(o => textTotals(env, today, o)))), ...pos.filter(p => p.budget).map(posLine), ...budgetWarnings(pos));
  }
  if (out.query && out.query !== 'none') { const q = await queryText(env, out.query, member); if (q) L.push(...(L.length ? [''] : []), q); }
  if (!L.length) {
    if (where === 'group') return; // ordinary chat in the group: stay quiet
    L.push('Tidak ada yang bisa dicatat dari pesan ini. /bantuan untuk contoh.');
  }
  // Telegram allows up to 100 buttons; long statements keep the first 30 rows of buttons.
  await send(env, chatId, L.join('\n'), buttons.length ? { reply_markup: { inline_keyboard: buttons.slice(0, 30) } } : {});

  // Shared spending recorded in a private chat: tell the other side (the group if there is one, else the partner).
  if (shared.length && where === 'private') {
    const partner = Object.keys(MEMBERS).find(k => k !== member && s.chats[k]);
    const target = s.chats.group?.id || (partner && s.chats[partner].id);
    if (target) await send(env, target, [`🧾 ${MEMBERS[member]} mencatat pengeluaran bersama:`, ...shared, '', await textTotals(env, today, 'bersama')].join('\n')).catch(e => console.error('dompet notify', e));
  }
}

async function queryText(env, q, member) {
  const today = witaDate();
  if (q === 'today') return textToday(env, today);
  if (q === 'week') return textWeek(env, today);
  if (q === 'month') return textMonth(env, today);
  if (q === 'pos') return textPos(env, today);
  if (q === 'help') return help(member);
  if ((q === 'invest' || q === 'porto') && member !== 'kevin') return 'ℹ️ Investasi dan portofolio hanya untuk Kevin.';
  const p = await portfolio(env, today);
  if (q === 'btc') return textBtcFrom(p, { holdings: member === 'kevin' });
  if (q === 'ihsg') return textIhsgFrom(p);
  if (q === 'invest') return textInvestFrom(p);
  if (q === 'porto') return [textPortoFrom(p), '', textBtcFrom(p), '', textInvestFrom(p)].join('\n');
  return null;
}

async function command(env, ctx, cmd) {
  const { chatId, member } = ctx;
  const map = { hari: 'today', today: 'today', minggu: 'week', bulan: 'month', pos: 'pos', btc: 'btc', bitcoin: 'btc', ihsg: 'ihsg',
    bunga: 'invest', invest: 'invest', investasi: 'invest', porto: 'porto', portofolio: 'porto', bantuan: 'help', help: 'help', start: 'help' };
  if (cmd === 'rekap') return send(env, chatId, await dailyRecap(env, witaDate(), member));
  if (cmd === 'batal') {
    const s = await tgState(env), b = s.last_batch[member];
    if (!b?.items?.length) return send(env, chatId, `Tidak ada catatan terakhir ${MEMBERS[member]} untuk dibatalkan.`);
    for (const it of b.items) await removeItem(env, it.t, it.id);
    delete s.last_batch[member]; await saveState(env, s);
    return send(env, chatId, `↩️ ${b.items.length} catatan terakhir ${MEMBERS[member]} dihapus.\n${await textTotals(env)}`);
  }
  const q = map[cmd];
  return send(env, chatId, q ? await queryText(env, q, member) : 'Perintah tidak dikenal. /bantuan');
}

async function removeItem(env, t, id) {
  if (t === 'tx') return deleteTx(env, id);
  if (t === 'btc') return deleteBtc(env, id);
  if (t === 'inv') return env.DB.prepare('DELETE FROM dompet_invest WHERE id = ?').bind(Number(id)).run();
}

/** Buttons under a record: d:<t>:<id> delete, p:<tx> choose a pos, s:<tx>:<pos> set it, x close the chooser. */
async function handleCallback(env, cb, { chatId, member }) {
  const [a, b, c] = String(cb.data || '').split(':');
  const msgId = cb.message.message_id;
  const answer = text => tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, ...(text ? { text } : {}) }).catch(() => {});
  if (a === 'd') {
    if ((b === 'btc' || b === 'inv') && member !== 'kevin') return answer('Hanya Kevin');
    await removeItem(env, b, c);
    await answer('Dihapus');
    return send(env, chatId, `🗑 #${esc(c)} dihapus oleh ${MEMBERS[member]}. ${await textTotals(env)}`);
  }
  if (a === 'p') {
    const pos = await posWithSpend(env, witaDate(), { owners: ['bersama', member] });
    const rows = [];
    for (let i = 0; i < pos.length; i += 2) rows.push(pos.slice(i, i + 2).map(p => ({ text: `${p.emoji || ''} ${p.name}${p.owner === 'bersama' ? ' 👥' : ''}`.trim(), callback_data: `s:${b}:${p.id}` })));
    rows.push([{ text: '✖️ Batal', callback_data: 'x' }]);
    await answer();
    return tg(env, 'sendMessage', { chat_id: chatId, text: `Pilih pos untuk #${b}:`, reply_markup: { inline_keyboard: rows } });
  }
  if (a === 's') {
    const t = await env.DB.prepare('SELECT id FROM dompet_tx WHERE id = ?').bind(Number(b)).first();
    const p = await env.DB.prepare('SELECT name, emoji, owner FROM dompet_pos WHERE id = ?').bind(Number(c)).first();
    if (!t || !p) { await answer('Sudah tidak ada'); return; }
    await env.DB.prepare('UPDATE dompet_tx SET pos_id = ? WHERE id = ?').bind(Number(c), Number(b)).run();
    await answer(`Pindah ke ${p.name}`);
    return tg(env, 'editMessageText', { chat_id: chatId, message_id: msgId, text: `🏷 #${b} → ${p.emoji || ''} ${p.name}${p.owner === 'bersama' ? ' (bersama)' : ''}` });
  }
  if (a === 'x') { await answer(); return tg(env, 'deleteMessage', { chat_id: chatId, message_id: msgId }).catch(() => {}); }
  return answer();
}

/** Cron, 21:00 WITA: each member's evening recap in their private chat (unless switched off on /dompet). */
export async function sendDailyRecap(env) {
  const s = await tgState(env);
  if (!env.DOMPET_BOT_TOKEN || s.recap === false) return { skipped: true };
  const today = witaDate();
  let sent = 0;
  for (const m of Object.keys(MEMBERS)) {
    const c = s.chats[m];
    if (!c || c.last_recap === today) continue;
    try { await send(env, c.id, await dailyRecap(env, today, m)); c.last_recap = today; sent++; }
    catch (e) { console.error('dompet recap ' + m, e); }
  }
  await saveState(env, s);
  return { ok: sent > 0, sent };
}
