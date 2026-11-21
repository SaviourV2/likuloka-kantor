// Villa Manager, the owner's app (/villa). One GET /api/villa gives the data of a calendar year; every section is
// drawn from it here, filtered by the villa chosen in the side menu. Changes go through POST /api/villa.
/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
function h(tag, props, ...kids) {   // h('div', { class: 'box', onclick }, child, 'text')
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e[k] = v; else if (k === 'style') e.style.cssText = v; else if (k in e && k !== 'list') e[k] = v; else e.setAttribute(k, v);
  }
  e.append(...kids.flat().filter(x => x != null && x !== false));
  return e;
}
const rp = n => 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
const rpSigned = n => (n < 0 ? '−' : '') + rp(Math.abs(n));
const rpShort = n => n >= 1e9 ? (n / 1e9).toFixed(1).replace('.', ',') + ' M' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + ' jt' : Math.round(n / 1e3) + ' rb';
const dfmt = (d, o = { day: 'numeric', month: 'short' }) => new Date(d + 'T00:00:00Z').toLocaleDateString('id-ID', { ...o, timeZone: 'UTC' });
const dlong = d => dfmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const tfmt = t => new Date(t).toLocaleString('id-ID', { timeZone: 'Asia/Makassar', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' WITA';
const addD = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const diff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const addM = (ym, n) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };
const sum = (arr, f = x => x) => arr.reduce((n, x) => n + (f(x) || 0), 0);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const CATS = { out: ['Listrik', 'Air', 'Internet', 'Kebersihan & laundry', 'Perbaikan & maintenance', 'Gaji staf', 'Perlengkapan tamu', 'Komisi platform', 'Pajak', 'Lainnya'], in: ['Layanan tambahan', 'Deposit', 'Lainnya'] };
const INBOX = { airbnb: 'https://www.airbnb.com/hosting/inbox', booking: 'https://admin.booking.com/', agoda: 'https://ycs.agoda.com/' };
const ICON = { beranda: 'M3 11l9-8 9 8M5 10v10h14V10', kalender: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4', booking: 'M5 4h14v17l-7-4-7 4z', harga: 'M4 13l8-9h8v8l-9 8zM16 8h.01',
  review: 'M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1L3.2 9.4l6.1-.8z', tim: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20c.5-3.5 3-5.5 6.5-5.5s6 2 6.500 5.5M17 11l2 2 3.500-4',
  keuangan: 'M4 20V10M10 20V4M16 20v-7M21 20H3', pengaturan: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4' };
const SECTIONS = [['beranda', 'Beranda'], ['kalender', 'Kalender'], ['booking', 'Booking'], ['harga', 'Harga'], ['review', 'Review'], ['tim', 'Tim & operasional'], ['keuangan', 'Keuangan'], ['pengaturan', 'Villa & platform']];

let D = null, month = null, villa = 0, section = location.hash.slice(1) || 'beranda', selDay = null, bookFilter = 'aktif', bookSearch = '', finTab = 'ringkasan';
if (!SECTIONS.some(s => s[0] === section)) section = 'beranda';
const L = () => D.labels;
const vname = id => D.villas.find(v => v.id === id)?.name || 'Semua villa';
const inScope = x => !villa || x.villa_id === villa;
const scopeVillas = () => D.villas.filter(v => !villa || v.id === villa);

function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2800); }
async function load() {
  const r = await fetch('/api/villa' + (month ? '?month=' + month : ''), { headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!r.ok) { toast(r.status === 401 ? 'Sesi habis, muat ulang halaman' : 'Gagal memuat data'); return; }
  D = await r.json(); month = D.month;
  if (villa && !D.villas.some(v => v.id === villa)) villa = 0;
  if (!selDay || selDay.slice(0, 7) !== month) selDay = D.today.slice(0, 7) === month ? D.today : month + '-01';
  render();
}
async function act(payload, errBox) {
  if (errBox) errBox.textContent = '';
  const r = await fetch('/api/villa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const m = j.error || 'Gagal menyimpan'; if (errBox) errBox.textContent = m; else toast(m); return null; }
  await load(); return j;
}
/** A form from a field list: { n: name, l: label, t: text|date|select|textarea|checks, o: [[value, label]], v, req, ph, wide, mode }. */
function form(fields, submit, onsubmit, extra = []) {
  const err = h('div', { class: 'err' }), f = h('form', { class: 'f' });
  for (const x of fields) {
    let input;
    if (x.t === 'select') { input = h('select', { name: x.n }, x.o.map(([v, l]) => h('option', { value: v }, l))); if (x.v != null) input.value = x.v; }
    else if (x.t === 'textarea') input = h('textarea', { name: x.n, value: x.v || '', placeholder: x.ph });
    else if (x.t === 'checks') { f.append(h('div', { class: 'wide', style: 'grid-column:1 / -1' }, h('div', { class: 'small muted', style: 'margin-bottom:4px' }, x.l),
      h('div', { class: 'checks' }, x.o.map(([v, l]) => h('label', {}, h('input', { type: 'checkbox', name: x.n, value: v, checked: (x.v || []).map(String).includes(String(v)) }), l))))); continue; }
    else input = h('input', { name: x.n, type: x.t || 'text', value: x.v ?? '', required: !!x.req, placeholder: x.ph, inputMode: x.mode, maxLength: x.max || 300 });
    f.append(h('label', { class: x.wide ? 'wide' : '' }, x.l, input));
  }
  const btn = h('button', { class: 'pri' }, submit);
  f.append(h('div', { class: 'row', style: 'grid-column:1 / -1;justify-content:flex-end' }, ...extra, btn), h('div', { class: 'err wide', style: 'grid-column:1 / -1' }));
  f.onsubmit = async ev => { ev.preventDefault(); const v = {};
    for (const x of fields) v[x.n] = x.t === 'checks' ? [...f.querySelectorAll(`input[name="${x.n}"]:checked`)].map(c => c.value) : f.elements[x.n].value;
    btn.disabled = true; await onsubmit(v, f.lastChild, f); btn.disabled = false; };
  return f;
}
function table(head, rows, empty = 'Belum ada data.') {   // head: ['Tamu', ['Nilai', 'num']]; rows: { cells: [...], onclick }
  if (!rows.length) return h('p', { class: 'muted' }, empty);
  return h('div', { class: 'tscroll' }, h('table', {}, h('tr', {}, head.map(x => Array.isArray(x) ? h('th', { class: x[1] }, x[0]) : h('th', {}, x))),
    rows.map(r => h('tr', { class: r.onclick ? 'click' : '', onclick: r.onclick }, r.cells.map((c, i) => h('td', { class: Array.isArray(head[i]) ? head[i][1] : '' }, c))))));
}
const tiles = list => h('div', { class: 'tiles' }, list.map(([l, v, sub]) => h('div', { class: 'tile' }, h('b', {}, v), h('span', {}, l), sub && h('div', { class: 'small muted' }, sub))));
const meter = (value, target) => h('div', { class: 'meter' + (target && value >= target ? ' done' : '') }, h('i', { style: `width:${target ? Math.min(100, value / target * 100) : 0}%` }));
function dialog(...kids) { const b = $('dlg-body'); b.replaceChildren(...kids.flat().filter(Boolean)); $('dlg').showModal(); }
const closeDlg = () => $('dlg').close();
const closeBtn = (label = 'Tutup') => h('button', { type: 'button', onclick: closeDlg }, label);

/* ---------- derived data ---------- */
/** Stays: bookings, plus platform reservations nobody completed yet. */
function stays() {
  return [...D.bookings.map(b => ({ ref: 'b:' + b.id, type: 'booking', villa_id: b.villa_id, guest: b.guest, guests: b.guests, s: b.check_in, e: b.check_out, source: b.source, total: b.total, cancelled: b.status === 'cancelled', raw: b })),
    ...D.ical.filter(e => !e.covered && e.kind === 'reserved').map(e => ({ ref: `i:${e.feed_id}:${e.uid}`, type: 'ical', villa_id: e.villa_id, guest: 'Reservasi ' + (L().platforms[e.platform] || e.platform), s: e.start_date, e: e.end_date, source: e.platform, raw: e }))];
}
const STATUS = { checkin: ['Check-in hari ini', 'in'], inhouse: ['In-house', 'house'], checkout: ['Check-out hari ini', 'out'], akan: ['Akan datang', 'soon'], selesai: ['Selesai', ''], batal: ['Dibatalkan', ''] };
const statusOf = s => s.cancelled ? 'batal' : s.e < D.today ? 'selesai' : s.e === D.today ? 'checkout' : s.s === D.today ? 'checkin' : s.s < D.today ? 'inhouse' : 'akan';
const statusTag = s => { const [l, c] = STATUS[statusOf(s)]; return h('span', { class: 'tag ' + c }, l); };
const op = (type, ref) => D.ops.find(o => o.type === type && o.ref === ref);
const payoutDue = b => { const r = D.config.payout_rules[b.source] || D.config.payout_rules.lainnya; return addD(b[r.basis], r.days); };
const awaiting = () => D.bookings.filter(b => b.status !== 'cancelled' && !b.payout_id && inScope(b));
/** Suggested nightly price of a villa on a date: area average (or the villa's own normal price), season, weekend, floor. */
function priceFor(v, d) {
  const market = D.market.find(m => m.area === v.area && m.month === +d.slice(5, 7))?.avg_price || null;
  const base = market ? market * (1 + (v.position_pct || 0) / 100) : v.base_price;
  if (!base) return null;
  const season = D.seasons.filter(s => (!s.villa_id || s.villa_id === v.id) && s.start_date <= d && s.end_date >= d).sort((a, b) => diff(a.start_date, a.end_date) - diff(b.start_date, b.end_date))[0] || null;
  const wd = new Date(d + 'T00:00:00Z').getUTCDay(), weekend = (wd === 5 || wd === 6) && v.weekend_pct ? v.weekend_pct : 0;
  const raw = base * (1 + (season?.pct || 0) / 100) * (1 + weekend / 100);
  return { price: Math.round(Math.max(v.min_price || 0, raw) / 10000) * 10000, season, weekend, market, floored: raw < (v.min_price || 0) };
}
/** Money per month of the shown year: revenue = booking values (check-in month) + other income + paid guest charges. */
function yearMoney() {
  const y = String(D.year), m = Array.from({ length: 12 }, () => ({ bookings: 0, other: 0, charges: 0, out: 0, prev: 0, prevOut: 0 }));
  for (const b of D.bookings) if (b.status !== 'cancelled' && inScope(b) && b.check_in.startsWith(y)) m[+b.check_in.slice(5, 7) - 1].bookings += b.total || 0;
  for (const l of D.ledger) if (inScope(l) && l.date.startsWith(y)) m[+l.date.slice(5, 7) - 1][l.type === 'in' ? 'other' : 'out'] += l.amount;
  for (const c of D.charges) if (c.status === 'paid' && inScope(c) && c.date.startsWith(y)) m[+c.date.slice(5, 7) - 1].charges += c.amount;
  for (const r of D.prev.bookings) if (inScope(r)) m[+r.m - 1].prev += r.n || 0;
  for (const r of D.prev.ledger) if (inScope(r)) m[+r.m - 1][r.type === 'in' ? 'prev' : 'prevOut'] += r.n || 0;
  m.forEach(x => x.rev = x.bookings + x.other + x.charges);
  return m;
}
function alerts() {
  const out = [], today = D.today, st = stays().filter(s => !s.cancelled && inScope(s));
  for (const c of D.conflicts.filter(inScope)) out.push({ text: `Bentrok di ${vname(c.villa_id)}, ${dfmt(c.from)} – ${dfmt(c.to)}: ${c.a} dan ${c.b}`, go: 'kalender', bad: true });
  for (const s of st.filter(s => (s.s === today || s.s === addD(today, 1)) && !op('ready', s.ref))) out.push({ text: `${vname(s.villa_id)} belum ditandai siap untuk check-in ${s.s === today ? 'hari ini' : 'besok'} (${s.guest})`, go: 'tim' });
  for (const s of st.filter(s => s.e <= today && s.e >= addD(today, -2) && !op('checkout', s.ref))) out.push({ text: `Pemeriksaan checkout ${vname(s.villa_id)} (${s.guest}, ${dfmt(s.e)}) belum diisi`, go: 'tim' });
  const late = awaiting().filter(b => b.total && payoutDue(b) < today);
  if (late.length) out.push({ text: `${late.length} payout terlambat, total ${rp(sum(late, b => b.total))}`, go: 'keuangan', tab: 'payout', bad: true });
  const ch = D.charges.filter(c => c.status === 'open' && inScope(c));
  if (ch.length) out.push({ text: `${ch.length} kerusakan / kehilangan belum ditagihkan ke tamu (${rp(sum(ch, c => c.amount))})`, go: 'keuangan', tab: 'tagihan' });
  const iss = D.ops.filter(o => o.type === 'issue' && o.status === 'open' && inScope(o));
  if (iss.length) out.push({ text: `${iss.length} laporan masalah dari tim belum selesai`, go: 'tim' });
  for (const f of D.feeds.filter(f => f.last_error && inScope(f))) out.push({ text: `Kalender ${L().platforms[f.platform]} ${vname(f.villa_id)} gagal dibaca: ${f.last_error}`, go: 'pengaturan', bad: true });
  const ic = st.filter(s => s.type === 'ical' && s.e >= today);
  if (ic.length) out.push({ text: `${ic.length} reservasi dari platform belum dilengkapi nama tamu dan nilainya`, go: 'booking' });
  const noReply = D.reviews.filter(r => inScope(r) && !r.replied).length;
  if (noReply) out.push({ text: `${noReply} review belum dibalas`, go: 'review' });
  return out;
}

/* ---------- shell ---------- */
function go(s, tab) { section = s; if (tab) finTab = tab; history.replaceState(null, '', '#' + s); $('side').classList.remove('open'); $('scrim').hidden = true; render(); window.scrollTo(0, 0); }
function render() {
  const al = alerts();
  $('villa-pick').replaceChildren(h('option', { value: 0 }, 'Semua villa'), ...D.villas.map(v => h('option', { value: v.id }, v.name))); $('villa-pick').value = villa;
  $('menu').replaceChildren(...SECTIONS.map(([k, l]) => { const b = h('button', { 'aria-current': k === section ? 'page' : null, onclick: () => go(k) });
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[k]}"/></svg>`; b.append(l);
    const n = al.filter(a => a.go === k).length; if (n) b.append(h('span', { class: 'count', title: n + ' perlu perhatian' }, n)); return b; }));
  $('title').textContent = SECTIONS.find(s => s[0] === section)[1];
  $('subtitle').textContent = (villa ? vname(villa) : D.villas.length > 1 ? 'Semua villa' : D.villas[0]?.name || '') + ' · hari ini ' + dfmt(D.today, { weekday: 'long', day: 'numeric', month: 'long' }) + ' (WITA)';
  $('month-label').textContent = dfmt(month + '-01', { month: 'long', year: 'numeric' });
  $('monthnav').hidden = !['kalender', 'harga', 'keuangan'].includes(section);
  const view = $('view');
  if (!D.villas.length && section !== 'pengaturan') return view.replaceChildren(h('div', { class: 'panel' }, h('h2', {}, 'Mulai dengan menambah villa'),
    h('p', { class: 'muted' }, 'Belum ada villa. Tambahkan villa pertama, lalu sambungkan kalender Airbnb / Booking.com-nya.'), h('div', {}, h('button', { class: 'pri', onclick: () => go('pengaturan') }, 'Tambah villa'))));
  view.replaceChildren(...{ beranda: vBeranda, kalender: vKalender, booking: vBooking, harga: vHarga, review: vReview, tim: vTim, keuangan: vKeuangan, pengaturan: vPengaturan }[section](al).filter(Boolean));
  const sc = view.querySelector('.cal-scroll'), hs = sc?.querySelector('.h.sel');
  if (hs && sc.scrollWidth > sc.clientWidth) sc.scrollLeft = Math.max(0, hs.offsetLeft - 180);
}

/* ---------- Beranda ---------- */
function stayLine(s, extra) {
  return h('li', {}, h('span', {}, h('b', {}, s.guest), s.guests ? ` · ${s.guests} tamu` : '', h('span', { class: 'muted' }, ' · ' + vname(s.villa_id))), h('span', { class: 'row' }, extra, h('button', { class: 'mini', onclick: () => openStay(s) }, 'Detail')));
}
function vBeranda(al) {
  const st = stays().filter(s => !s.cancelled && inScope(s)), t = D.today, mStart = month + '-01', mEnd = addM(month, 1) + '-01', days = diff(mStart, mEnd), money = yearMoney()[+month.slice(5) - 1];
  const col = (title, list, extra, empty) => h('div', { class: 'box' }, h('h3', {}, `${title} (${list.length})`), h('ul', { class: 'plain' }, list.length ? list.map(s => stayLine(s, extra(s))) : h('li', { class: 'muted' }, empty)));
  const ready = s => op('ready', s.ref) ? h('span', { class: 'tag good' }, 'Villa siap') : h('span', { class: 'tag bad' }, 'Belum siap');
  const insp = s => { const o = op('checkout', s.ref); return o ? h('span', { class: 'tag ' + (o.data?.found?.length ? 'bad' : 'good') }, o.data?.found?.length ? o.data.found.length + ' temuan' : 'Sudah diperiksa') : h('span', { class: 'tag' }, 'Belum diperiksa'); };
  const cards = D.villas.map(v => {
    const mine = st.filter(s => s.villa_id === v.id), cur = mine.find(s => s.s <= t && s.e > t), next = mine.filter(s => s.s > t).sort((a, b) => a.s.localeCompare(b.s))[0];
    const blk = D.blocks.find(b => b.villa_id === v.id && b.start_date <= t && b.end_date > t);
    const booked = sum(mine, s => Math.max(0, diff(s.s > mStart ? s.s : mStart, s.e < mEnd ? s.e : mEnd)));
    const rv = D.reviews.filter(r => r.villa_id === v.id), p = priceFor(v, t);
    return h('button', { class: 'vcard', 'aria-pressed': String(villa === v.id), onclick: () => { villa = villa === v.id ? 0 : v.id; render(); } },
      h('div', { class: 'row between' }, h('b', {}, v.name), cur ? h('span', { class: 'tag house' }, 'Terisi') : blk ? h('span', { class: 'tag soon' }, L().block_kinds[blk.kind]) : h('span', { class: 'tag good' }, 'Kosong')),
      h('span', { class: 'muted small' }, [v.area, v.note].filter(Boolean).join(' · ') || 'Daerah belum diisi'),
      h('span', {}, cur ? `${cur.guest}, sampai ${dfmt(cur.e)}` : next ? `Berikutnya ${next.guest}, masuk ${dfmt(next.s)}` : 'Belum ada booking ke depan'),
      h('span', { class: 'muted small' }, `Okupansi ${dfmt(mStart, { month: 'long' })} ${Math.round(booked / days * 100)}% · ${rv.length ? '★ ' + (sum(rv, r => r.rating) / rv.length).toFixed(1) + ` (${rv.length})` : 'belum ada review'}${p ? ' · harga saran malam ini ' + rpShort(p.price) : ''}`));
  });
  return [
    al.length ? h('div', { class: 'box' + (al.some(a => a.bad) ? ' warn' : '') }, h('h3', {}, 'Perlu perhatian'), h('ul', { class: 'plain' }, al.map(a => h('li', {}, h('span', {}, a.text), h('button', { class: 'mini', onclick: () => go(a.go, a.tab) }, 'Buka'))))) : null,
    h('div', { class: 'panel' }, h('h2', {}, 'Hari ini, ' + dfmt(t, { weekday: 'long', day: 'numeric', month: 'long' })),
      h('div', { class: 'grid3' }, col('Check-in', st.filter(s => s.s === t), ready, 'Tidak ada tamu masuk.'), col('In-house', st.filter(s => s.s < t && s.e > t), s => h('span', { class: 'muted small' }, 'sampai ' + dfmt(s.e)), 'Tidak ada tamu menginap.'),
        col('Check-out', st.filter(s => s.e === t), insp, 'Tidak ada tamu keluar.'))),
    h('div', { class: 'panel' }, h('div', { class: 'row between' }, h('h2', {}, 'Pilih villa'), h('span', { class: 'muted small' }, 'Klik villa untuk menampilkan datanya saja di semua menu; klik lagi untuk kembali ke semua villa.')),
      h('div', { class: 'grid3' }, cards)),
    tiles([['Pendapatan ' + dfmt(mStart, { month: 'long' }), rp(money.rev)], ['Pengeluaran', rp(money.out)], ['Bersih', rpSigned(money.rev - money.out)], ['Menunggu payout', rp(sum(awaiting(), b => b.total)), awaiting().length + ' booking']]),
  ];
}

/* ---------- Kalender ---------- */
function calEvents() {
  return [...stays().filter(s => !s.cancelled).map(s => ({ ...s, cls: s.type === 'ical' ? 'ota' : '', label: s.guest + (s.guests ? ' · ' + s.guests : ''), stay: true })),
    ...D.ical.filter(e => !e.covered && e.kind !== 'reserved').map(e => ({ type: 'closed', cls: 'closed', villa_id: e.villa_id, s: e.start_date, e: e.end_date, label: 'Ditutup di ' + (L().platforms[e.platform] || e.platform), raw: e })),
    ...D.blocks.map(b => ({ type: 'block', cls: ['maintenance', 'acara'].includes(b.kind) ? b.kind : 'pribadi', villa_id: b.villa_id, s: b.start_date, e: b.end_date, label: (L().block_kinds[b.kind] || 'Blokir') + (b.note ? ' · ' + b.note : ''), raw: b }))].filter(inScope);
}
const openEvent = e => e.stay ? openStay(e) : e.type === 'block' ? openBlockInfo(e) : dialog(h('h2', {}, e.label),
  h('p', {}, `${vname(e.villa_id)}, ${dfmt(e.s)} – ${dfmt(addD(e.e, -1))}. Tanggal ini ditutup di platform itu sendiri (atau gema dari kalender lain), jadi dibukanya dari platformnya.`), h('div', { class: 'row', style: 'justify-content:flex-end' }, closeBtn()));
function vKalender() {
  const start = month + '-01', N = diff(start, addM(month, 1) + '-01'), days = Array.from({ length: N }, (_, i) => addD(start, i)), evs = calEvents(), vs = scopeVillas();
  const pick = d => { selDay = d; render(); };
  const cal = h('div', { class: 'cal', role: 'table', 'aria-label': 'Kalender per villa', style: `grid-template-columns:auto repeat(${N}, minmax(38px, 1fr))` }, h('div', { class: 'h u', style: 'grid-row:1;grid-column:1' }, 'Villa'));
  days.forEach((d, i) => { const wd = new Date(d + 'T00:00:00Z').getUTCDay(), ins = evs.filter(e => e.stay && e.s === d).length, outs = evs.filter(e => e.stay && e.e === d).length;
    cal.append(h('button', { class: 'h' + (wd === 0 || wd === 6 ? ' we' : '') + (d === D.today ? ' today' : '') + (d === selDay ? ' sel' : ''), style: `grid-row:1;grid-column:${i + 2}`, onclick: () => pick(d),
      'aria-label': dlong(d) + `, ${ins} masuk, ${outs} keluar` }, h('small', {}, [ins ? '→' + ins : '', outs ? '←' + outs : ''].join(' ').trim()), h('div', {}, ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'][wd]), h('b', {}, String(+d.slice(8))))); });
  vs.forEach((v, r) => {
    cal.append(h('div', { class: 'u', title: v.name, style: `grid-row:${r + 2};grid-column:1` }, v.name));
    days.forEach((d, i) => cal.append(h('div', { class: 'cell' + (d === D.today ? ' today' : '') + (d === selDay ? ' sel' : ''), style: `grid-row:${r + 2};grid-column:${i + 2}`, onclick: () => pick(d) })));
    evs.filter(e => e.villa_id === v.id).forEach(e => { const s = Math.max(0, diff(start, e.s)), en = Math.min(N, diff(start, e.e)); if (en <= s) return;
      cal.append(h('button', { class: 'ev ' + e.cls, title: `${e.label}\n${dfmt(e.s)} → ${dfmt(e.e)}`, style: `grid-row:${r + 2};grid-column:${s + 2} / ${en + 2}`, onclick: () => openEvent(e) }, e.label)); });
  });
  // Agenda of the chosen day, grouped the way the day runs.
  const d = selDay, grp = (title, cls, list, extra) => list.length ? h('div', {}, h('div', { class: 'row', style: 'margin-bottom:4px' }, h('span', { class: 'tag ' + cls }, title), h('span', { class: 'muted small' }, list.length + '')),
    h('ul', { class: 'plain' }, list.map(e => h('li', {}, h('span', {}, h('b', {}, e.label), h('span', { class: 'muted' }, ' · ' + vname(e.villa_id))), h('span', { class: 'row' }, h('span', { class: 'muted small' }, extra(e)), h('button', { class: 'mini', onclick: () => openEvent(e) }, 'Detail')))))) : null;
  const busy = new Set(evs.filter(e => e.s <= d && e.e > d).map(e => e.villa_id)), free = vs.filter(v => !busy.has(v.id));
  const groups = [grp('Check-in 14:00', 'in', evs.filter(e => e.stay && e.s === d), e => 'sampai ' + dfmt(e.e)), grp('In-house', 'house', evs.filter(e => e.stay && e.s < d && e.e > d), e => dfmt(e.s) + ' – ' + dfmt(e.e)),
    grp('Check-out 11:00', 'out', evs.filter(e => e.stay && e.e === d), e => 'sejak ' + dfmt(e.s)), grp('Maintenance, acara & blokir', 'soon', evs.filter(e => !e.stay && e.s <= d && e.e > d), e => dfmt(e.s) + ' – ' + dfmt(addD(e.e, -1)))].filter(Boolean);
  const lg = (css, l) => h('span', {}, h('i', { style: 'background:' + css }), l);
  return [h('div', { class: 'panel' },
    h('div', { class: 'row between' }, h('h2', {}, 'Kalender ' + dfmt(start, { month: 'long', year: 'numeric' })), h('div', { class: 'row' }, h('button', { class: 'pri', onclick: () => openBooking() }, '+ Booking'), h('button', { onclick: openBlock }, 'Blokir / maintenance / acara'))),
    h('div', { class: 'cal-scroll' }, cal),
    h('div', { class: 'legend' }, lg('color-mix(in srgb, var(--ok) 28%, var(--card))', 'Booking'), lg('color-mix(in srgb, var(--sky) 30%, var(--card))', 'Reservasi platform (belum dilengkapi)'), lg('color-mix(in srgb, var(--bell) 30%, var(--card))', 'Pemakaian pribadi'),
      lg('color-mix(in srgb, var(--plum) 30%, var(--card))', 'Acara privat'), lg('repeating-linear-gradient(135deg, color-mix(in srgb, var(--alert) 26%, var(--card)) 0 4px, var(--card) 4px 8px)', 'Maintenance'),
      lg('repeating-linear-gradient(135deg, color-mix(in srgb, var(--muted) 20%, var(--card)) 0 4px, var(--card) 4px 8px)', 'Ditutup di platform'), h('span', {}, 'Di atas tanggal: → masuk, ← keluar. Klik tamu untuk detailnya.')),
    h('div', { class: 'box' }, h('h3', {}, 'Agenda ' + dlong(d)), ...groups, groups.length ? null : h('p', { class: 'muted' }, 'Tidak ada tamu atau kegiatan di tanggal ini.'),
      h('p', { class: 'muted small' }, free.length ? 'Kosong malam ini: ' + free.map(v => v.name).join(', ') : 'Semua villa terisi atau tertutup malam ini.')))];
}

/* ---------- guest detail, booking and block dialogs ---------- */
function chatLinks(s) {
  const b = s.type === 'booking' ? s.raw : null, out = [], src = L().sources[s.source] || s.source;
  const ev = s.type === 'ical' ? s.raw : D.ical.find(e => e.villa_id === s.villa_id && e.url && e.start_date >= s.s && e.end_date <= s.e);
  if (b?.chat_url) out.push(h('a', { class: 'btn pri', href: b.chat_url, target: '_blank', rel: 'noopener' }, 'Buka chat di ' + src));
  if (ev?.url) out.push(h('a', { class: 'btn' + (out.length ? '' : ' pri'), href: ev.url, target: '_blank', rel: 'noopener' }, 'Buka reservasi & pesan di ' + (L().platforms[ev.platform] || src)));
  if (!out.length && INBOX[s.source]) out.push(h('a', { class: 'btn', href: INBOX[s.source], target: '_blank', rel: 'noopener' }, 'Buka kotak pesan ' + src));
  const digits = (b?.contact || '').replace(/[^\d+]/g, '');
  if (/^\+?\d{9,15}$/.test(digits)) out.push(h('a', { class: 'btn', href: 'https://wa.me/' + digits.replace(/^\+/, '').replace(/^0/, '62'), target: '_blank', rel: 'noopener' }, 'WhatsApp'));
  return out;
}
function openStay(s) {
  const b = s.type === 'booking' ? s.raw : null, rd = op('ready', s.ref), co = op('checkout', s.ref), charges = D.charges.filter(c => c.ref === s.ref), payout = b?.payout_id && D.payouts.find(p => p.id === b.payout_id);
  const row = (k, v) => v ? h('li', {}, h('span', { class: 'muted' }, k), h('span', { style: 'text-align:right' }, v)) : null;
  dialog(h('div', { class: 'row between' }, h('h2', {}, s.guest), statusTag(s)),
    h('ul', { class: 'plain' }, row('Villa', vname(s.villa_id)), row('Check-in', dlong(s.s) + ', 14:00'), row('Check-out', dlong(s.e) + ', 11:00'), row('Lama', diff(s.s, s.e) + ' malam' + (s.guests ? ` · ${s.guests} tamu` : '')),
      row('Sumber', (L().sources[s.source] || s.source) + (b?.platform_ref ? ' · kode ' + b.platform_ref : '')), b && row('Kontak', b.contact), b && row('Nilai booking', b.total ? rp(b.total) : 'belum diisi'),
      b && !s.cancelled && row('Payout', payout ? `Sudah cair ${dfmt(payout.date)}` : `Belum cair, perkiraan ${dfmt(payoutDue(b))}`), b && row('Catatan', b.note),
      !s.cancelled && row('Kesiapan villa', rd ? `Siap, oleh ${rd.by_name} ${tfmt(rd.at)}` : 'Belum ditandai siap oleh tim'),
      !s.cancelled && s.e <= D.today && row('Pemeriksaan checkout', co ? `${co.data?.found?.length ? co.data.found.length + ' temuan' : 'Tidak ada kerusakan'}, oleh ${co.by_name} ${tfmt(co.at)}` : 'Belum diisi tim')),
    charges.length ? h('div', { class: 'box' }, h('h3', {}, 'Tagihan ke tamu (SOP)'), h('ul', { class: 'plain' }, charges.map(c => h('li', {}, h('span', {}, `${c.item} ${c.kind}${c.qty > 1 ? ' ×' + c.qty : ''}`), h('span', {}, rp(c.amount) + ' · ' + CH[c.status])))), h('p', { class: 'small muted' }, 'Total ' + rp(sum(charges, c => c.amount)) + '. Status diubah di Keuangan → Tagihan tamu.')) : null,
    s.type === 'ical' ? h('p', { class: 'muted small' }, 'Kalender platform hanya membawa tanggal. Lengkapi nama tamu dan nilainya supaya masuk ke keuangan dan payout.') : null,
    h('div', { class: 'row' }, chatLinks(s)),
    h('div', { class: 'row', style: 'justify-content:flex-end' }, closeBtn(), s.type === 'ical' ? h('button', { class: 'pri', onclick: () => openBooking({ villa_id: s.villa_id, check_in: s.s, check_out: s.e, source: s.source, chat_url: s.raw.url }) }, 'Lengkapi sebagai booking') : h('button', { class: 'pri', onclick: () => openBooking(b) }, 'Ubah booking')));
}
function openBooking(b = {}) {
  const f = form([{ n: 'villa_id', l: 'Villa', t: 'select', o: D.villas.map(v => [v.id, v.name]), v: b.villa_id || villa || D.villas[0]?.id }, { n: 'source', l: 'Sumber', t: 'select', o: Object.entries(L().sources), v: b.source || 'langsung' },
    { n: 'guest', l: 'Nama tamu', v: b.guest, req: 1, wide: 1, max: 80 }, { n: 'check_in', l: 'Check-in', t: 'date', v: b.check_in || selDay, req: 1 }, { n: 'check_out', l: 'Check-out', t: 'date', v: b.check_out || addD(b.check_in || selDay, 1), req: 1 },
    { n: 'guests', l: 'Jumlah tamu', v: b.guests, mode: 'numeric' }, { n: 'total', l: 'Nilai booking (Rp)', v: b.total ? b.total.toLocaleString('id-ID') : '', mode: 'numeric', ph: 'yang Anda terima' },
    { n: 'contact', l: 'Kontak (WhatsApp / email)', v: b.contact, max: 80 }, { n: 'platform_ref', l: 'Kode reservasi platform', v: b.platform_ref, max: 40 },
    { n: 'chat_url', l: 'Link chat tamu di platform', v: b.chat_url, ph: 'https://…', wide: 1, max: 500 }, { n: 'status', l: 'Status', t: 'select', o: [['confirmed', 'Terkonfirmasi'], ['cancelled', 'Dibatalkan']], v: b.status || 'confirmed' }, { n: 'note', l: 'Catatan', v: b.note }],
    'Simpan', async (v, err) => { if (await act({ action: 'booking_save', id: b.id || null, ...v }, err)) { closeDlg(); toast('Booking tersimpan'); } },
    [b.id ? h('button', { type: 'button', class: 'danger', style: 'margin-right:auto', onclick: async () => { if (confirm('Hapus booking ini? Nilainya ikut hilang dari keuangan.') && await act({ action: 'booking_delete', id: b.id })) { closeDlg(); toast('Booking dihapus'); } } }, 'Hapus') : null, closeBtn('Batal')]);
  dialog(h('h2', {}, b.id ? 'Ubah booking' : 'Booking baru'), f);
}
function openBlock() {
  dialog(h('h2', {}, 'Blokir tanggal'), h('p', { class: 'muted small' }, 'Untuk pemakaian pribadi, acara privat atau maintenance. Tanggalnya tidak bisa dibooking di sini dan ikut ditutup di platform yang mengimpor kalender villa.'),
    form([{ n: 'villa_ids', l: 'Villa', t: 'checks', o: D.villas.map(v => [v.id, v.name]), v: villa ? [villa] : D.villas.length === 1 ? [D.villas[0].id] : [] }, { n: 'start', l: 'Mulai', t: 'date', v: selDay, req: 1 }, { n: 'end', l: 'Sampai (termasuk malam ini)', t: 'date', v: selDay, req: 1 },
      { n: 'kind', l: 'Jenis', t: 'select', o: Object.entries(L().block_kinds) }, { n: 'note', l: 'Catatan', ph: 'Keluarga menginap, servis AC, pesta ulang tahun', wide: 1, max: 200 }],
      'Blokir', async (v, err) => { if (!v.villa_ids.length) { err.textContent = 'Pilih minimal satu villa'; return; } if (await act({ action: 'block_add', ...v }, err)) { closeDlg(); toast('Tanggal diblokir'); } }, [closeBtn('Batal')]));
}
function openBlockInfo(e) {
  const o = op('maintenance', 'm:' + e.raw.id);
  dialog(h('h2', {}, L().block_kinds[e.raw.kind] || 'Blokir'), h('ul', { class: 'plain' }, h('li', {}, h('span', { class: 'muted' }, 'Villa'), vname(e.villa_id)), h('li', {}, h('span', { class: 'muted' }, 'Tanggal'), `${dfmt(e.s)} – ${dfmt(addD(e.e, -1))} (${diff(e.s, e.e)} malam)`),
    e.raw.note ? h('li', {}, h('span', { class: 'muted' }, 'Catatan'), e.raw.note) : null, e.raw.kind === 'maintenance' ? h('li', {}, h('span', { class: 'muted' }, 'Pengerjaan'), o ? `Selesai, oleh ${o.by_name} ${tfmt(o.at)}${o.text ? ' · ' + o.text : ''}` : 'Belum ditandai selesai oleh tim') : null),
    h('div', { class: 'row', style: 'justify-content:flex-end' }, h('button', { class: 'danger', onclick: async () => { if (await act({ action: 'block_delete', id: e.raw.id })) { closeDlg(); toast('Blokir dihapus'); } } }, 'Hapus blokir'), closeBtn()));
}

/* ---------- Booking ---------- */
function vBooking() {
  const st = stays().filter(inScope), filters = [['aktif', 'Aktif & akan datang', s => ['checkin', 'inhouse', 'checkout', 'akan'].includes(statusOf(s))], ['checkin', 'Check-in hari ini'], ['inhouse', 'In-house'], ['checkout', 'Check-out hari ini'], ['akan', 'Akan datang'], ['selesai', 'Selesai'], ['batal', 'Dibatalkan'], ['semua', 'Semua', () => true]];
  const test = f => f[2] || (s => statusOf(s) === f[0]), cur = filters.find(f => f[0] === bookFilter), q = bookSearch.trim().toLowerCase();
  const list = st.filter(test(cur)).filter(s => !q || (s.guest + ' ' + (s.raw.platform_ref || '') + ' ' + vname(s.villa_id)).toLowerCase().includes(q)).sort((a, b) => ['selesai', 'batal', 'semua'].includes(bookFilter) ? b.s.localeCompare(a.s) : a.s.localeCompare(b.s));
  const search = h('input', { type: 'search', placeholder: 'Cari nama tamu, kode, villa', value: bookSearch, style: 'max-width:280px', oninput: ev => { bookSearch = ev.target.value; clearTimeout(vBooking.t); vBooking.t = setTimeout(() => { render(); const i = document.querySelector('input[type=search]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); } });
  return [h('div', { class: 'panel' },
    h('div', { class: 'row between' }, h('div', { class: 'chips' }, filters.map(f => h('button', { 'aria-pressed': String(f[0] === bookFilter), onclick: () => { bookFilter = f[0]; render(); } }, `${f[1]} (${st.filter(test(f)).length})`))), h('button', { class: 'pri', onclick: () => openBooking() }, '+ Booking')),
    search,
    table(['Tamu', 'Villa', 'Tanggal', 'Sumber', 'Status', 'Villa siap', ['Nilai', 'num'], 'Payout'], list.map(s => { const b = s.type === 'booking' ? s.raw : null, rd = op('ready', s.ref);
      return { onclick: () => openStay(s), cells: [h('b', {}, s.guest + (s.guests ? ` (${s.guests})` : '')), vname(s.villa_id), `${dfmt(s.s)} – ${dfmt(s.e)} · ${diff(s.s, s.e)} mlm`, L().sources[s.source] || s.source, statusTag(s),
        s.cancelled || s.e < D.today ? '' : rd ? h('span', { class: 'tag good' }, 'Siap') : h('span', { class: 'tag' }, 'Belum'), b ? (b.total ? rp(b.total) : h('span', { class: 'muted' }, 'belum diisi')) : h('span', { class: 'tag soon' }, 'Lengkapi'),
        !b || s.cancelled ? '' : b.payout_id ? h('span', { class: 'tag good' }, 'Cair') : payoutDue(b) < D.today ? h('span', { class: 'tag bad' }, 'Telat sejak ' + dfmt(payoutDue(b))) : h('span', { class: 'tag' }, 'Perkiraan ' + dfmt(payoutDue(b)))] }; }), 'Tidak ada booking di daftar ini.'),
    h('p', { class: 'muted small' }, `Menampilkan booking tahun ${D.year}. Ganti tahun lewat pemilih bulan di Kalender.`))];
}

/* ---------- Harga ---------- */
function vHarga() {
  const v = D.villas.find(x => x.id === villa) || D.villas[0], start = month + '-01', N = diff(start, addM(month, 1) + '-01'), days = Array.from({ length: N }, (_, i) => addD(start, i));
  const prices = days.map(d => priceFor(v, d)), have = prices.filter(Boolean), busy = d => stays().some(s => !s.cancelled && s.villa_id === v.id && s.s <= d && s.e > d) || D.blocks.some(b => b.villa_id === v.id && b.start_date <= d && b.end_date > d);
  const mk = D.market.find(m => m.area === v.area && m.month === +month.slice(5))?.avg_price, mine = D.bookings.filter(b => b.status !== 'cancelled' && b.villa_id === v.id && b.check_in.startsWith(month) && b.total);
  const adr = mine.length ? sum(mine, b => b.total) / sum(mine, b => diff(b.check_in, b.check_out)) : null;
  const pcal = h('div', { class: 'pcal' }, ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map(x => h('div', { class: 'dow' }, x)), Array.from({ length: (new Date(start + 'T00:00:00Z').getUTCDay() + 6) % 7 }, () => h('div')),
    days.map((d, i) => { const p = prices[i]; return h('div', { class: 'd ' + (p?.season?.kind || '') + (busy(d) ? ' busy' : '') + (d === D.today ? ' today' : ''), title: p ? `${dlong(d)}\n${rp(p.price)}${p.season ? `\n${p.season.name} (${p.season.pct > 0 ? '+' : ''}${p.season.pct}%)` : ''}${p.weekend ? `\nAkhir pekan +${p.weekend}%` : ''}${p.floored ? '\nDitahan di harga minimum' : ''}` : dlong(d) },
      h('span', { class: 'small muted' }, String(+d.slice(8))), h('b', {}, p ? rpShort(p.price) : '—'), h('small', {}, busy(d) ? 'terisi' : p?.season ? p.season.name : p?.weekend ? 'akhir pekan' : '')); }));
  const area = v.area || '', mrow = MONTHS.map((m, i) => ({ n: 'm' + i, l: m, mode: 'numeric', v: (D.market.find(x => x.area === area && x.month === i + 1)?.avg_price || '').toLocaleString('id-ID') }));
  return [
    D.villas.length > 1 && !villa ? h('p', { class: 'muted' }, `Menampilkan harga ${v.name}. Pilih villa lain di menu samping.`) : null,
    tiles([['Harga saran rata-rata ' + dfmt(start, { month: 'long' }), have.length ? rp(sum(have, p => p.price) / have.length) : '—', have.length ? `${rpShort(Math.min(...have.map(p => p.price)))} – ${rpShort(Math.max(...have.map(p => p.price)))} per malam` : 'isi harga normal atau harga pasar dulu'],
      ['Rata-rata pasar ' + (area || 'daerah ini'), mk ? rp(mk) : '—', mk ? 'per malam, bulan ini' : 'belum diisi'], ['Harga terjual rata-rata', adr ? rp(adr) : '—', adr ? `${mine.length} booking bulan ini` : 'belum ada booking bernilai'],
      ['Selisih dengan pasar', mk && adr ? (adr >= mk ? '+' : '−') + Math.abs(Math.round((adr / mk - 1) * 100)) + '%' : '—', 'harga terjual vs pasar']]),
    h('div', { class: 'panel' }, h('div', { class: 'row between' }, h('h2', {}, `Harga saran per malam, ${v.name}`), h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:var(--sky)' }), 'Low'), h('span', {}, h('i', { style: 'background:var(--bell)' }), 'High'), h('span', {}, h('i', { style: 'background:var(--alert)' }), 'Peak'), h('span', {}, h('i', { style: 'background:color-mix(in srgb, var(--ok) 14%, var(--card))' }), 'Terisi'))),
      pcal, h('p', { class: 'muted small' }, 'Rumus: rata-rata pasar bulan itu × posisi villa × musim × akhir pekan, tidak pernah di bawah harga minimum. Tanpa angka pasar, dipakai harga normal villa. Harga ini saran; memasangnya tetap dilakukan di tiap platform.')),
    h('div', { class: 'grid2' },
      h('div', { class: 'box' }, h('h3', {}, 'Dasar harga ' + v.name), form([{ n: 'area', l: 'Daerah', v: v.area, ph: 'Canggu', max: 40 }, { n: 'base_price', l: 'Harga normal / malam (Rp)', v: v.base_price?.toLocaleString('id-ID'), mode: 'numeric' }, { n: 'min_price', l: 'Harga minimum (Rp)', v: v.min_price?.toLocaleString('id-ID'), mode: 'numeric' },
        { n: 'weekend_pct', l: 'Tambahan Jumat & Sabtu (%)', v: v.weekend_pct, mode: 'numeric' }, { n: 'position_pct', l: 'Posisi vs rata-rata pasar (%)', v: v.position_pct, ph: '+10 atau -5' }],
        'Simpan', async (x, err) => { if (await act({ action: 'villa_save', id: v.id, name: v.name, note: v.note, ...x }, err)) toast('Dasar harga tersimpan'); })),
      h('div', { class: 'box' }, h('h3', {}, 'Musim (high / low season)'), h('ul', { class: 'plain' }, D.seasons.filter(s => !s.villa_id || s.villa_id === v.id).map(s => h('li', {}, h('span', {}, h('b', {}, s.name), ` · ${L().seasons[s.kind]} · ${dfmt(s.start_date)} – ${dfmt(s.end_date, { day: 'numeric', month: 'short', year: 'numeric' })}${s.villa_id ? '' : ' · semua villa'}`),
          h('span', { class: 'row' }, h('b', {}, (s.pct > 0 ? '+' : '') + s.pct + '%'), h('button', { class: 'mini danger', onclick: async () => { if (await act({ action: 'season_delete', id: s.id })) toast('Musim dihapus'); } }, 'Hapus')))), D.seasons.length ? null : h('li', { class: 'muted' }, 'Belum ada musim. Contoh: High season Juli–Agustus +30%, Low season Februari −15%.')),
        form([{ n: 'name', l: 'Nama', ph: 'Natal & Tahun Baru', req: 1, max: 40 }, { n: 'kind', l: 'Jenis', t: 'select', o: Object.entries(L().seasons), v: 'high' }, { n: 'start', l: 'Mulai', t: 'date', req: 1 }, { n: 'end', l: 'Sampai', t: 'date', req: 1 }, { n: 'pct', l: 'Naik / turun (%)', ph: '+30 atau -15', req: 1 },
          { n: 'villa_id', l: 'Berlaku untuk', t: 'select', o: [['', 'Semua villa'], [v.id, v.name]] }], 'Tambah musim', async (x, err, f) => { if (await act({ action: 'season_save', ...x }, err)) toast('Musim ditambahkan'); }))),
    h('div', { class: 'box' }, h('h3', {}, 'Rata-rata harga pasar per malam' + (area ? ' di ' + area : '')), area ? form(mrow, 'Simpan harga pasar', async (x, err) => { if (await act({ action: 'market_save', area, prices: MONTHS.map((_, i) => x['m' + i]) }, err)) toast('Harga pasar tersimpan'); })
      : h('p', { class: 'muted' }, 'Isi dulu daerah villa di "Dasar harga".'), h('p', { class: 'muted small' }, 'Angka ini diisi sendiri per bulan, dari survei villa sekelas di daerah yang sama atau dari layanan data pasar (misalnya AirDNA / PriceLabs). Villa lain di daerah yang sama memakai angka yang sama.'))];
}

/* ---------- Review ---------- */
const stars = r => h('span', { class: 'stars', title: r + ' dari 5' }, '★'.repeat(Math.round(r)) + '☆'.repeat(5 - Math.round(r)));
function reviewForm(r = {}) {
  return form([{ n: 'villa_id', l: 'Villa', t: 'select', o: D.villas.map(v => [v.id, v.name]), v: r.villa_id || villa || D.villas[0]?.id }, { n: 'platform', l: 'Platform', t: 'select', o: Object.entries(L().sources), v: r.platform || 'airbnb' },
    { n: 'guest', l: 'Nama tamu', v: r.guest, max: 80 }, { n: 'rating', l: 'Nilai (1–5)', v: r.rating, ph: '4.8', req: 1 }, { n: 'review_date', l: 'Tanggal review', t: 'date', v: r.review_date || D.today, req: 1 }, { n: 'text', l: 'Isi review', t: 'textarea', v: r.text, wide: 1 }],
    r.id ? 'Simpan' : 'Tambah review', async (v, err, f) => { if (await act({ action: 'review_save', id: r.id || null, reply: r.reply, replied: r.replied, ...v }, err)) { if (r.id) closeDlg(); toast('Review tersimpan'); } }, r.id ? [closeBtn('Batal')] : []);
}
function vReview() {
  const rs = D.reviews.filter(inScope), avg = l => l.length ? (sum(l, r => r.rating) / l.length).toFixed(2) : '—', plats = [...new Set(rs.map(r => r.platform))];
  return [tiles([['Rata-rata semua platform', avg(rs) + (rs.length ? ' ★' : ''), rs.length + ' review'], ...plats.map(p => [L().sources[p] || p, avg(rs.filter(r => r.platform === p)) + ' ★', rs.filter(r => r.platform === p).length + ' review']), ['Belum dibalas', String(rs.filter(r => !r.replied).length)]]),
    h('div', { class: 'panel' }, h('h2', {}, 'Review tamu'), rs.length ? null : h('p', { class: 'muted' }, 'Belum ada review yang dicatat.'),
      rs.map(r => { const ta = h('textarea', { placeholder: 'Tulis balasan di sini, lalu salin ke platformnya', value: r.reply || '', style: 'min-height:70px' });
        const save = replied => act({ action: 'review_save', ...r, id: r.id, reply: ta.value, replied }).then(j => j && toast(replied ? 'Ditandai sudah dibalas' : 'Balasan disimpan'));
        return h('div', { class: 'box' }, h('div', { class: 'row between' }, h('span', { class: 'row' }, stars(r.rating), h('b', {}, r.rating.toFixed(1)), h('span', {}, r.guest || 'Tamu'), h('span', { class: 'tag' }, L().sources[r.platform] || r.platform), h('span', { class: 'muted small' }, `${vname(r.villa_id)} · ${dfmt(r.review_date, { day: 'numeric', month: 'short', year: 'numeric' })}`)),
            h('span', { class: 'row' }, r.replied ? h('span', { class: 'tag good' }, 'Sudah dibalas') : h('span', { class: 'tag soon' }, 'Belum dibalas'), h('button', { class: 'mini', onclick: () => dialog(h('h2', {}, 'Ubah review'), reviewForm(r)) }, 'Ubah'),
              h('button', { class: 'mini danger', onclick: async () => { if (confirm('Hapus review ini?') && await act({ action: 'review_delete', id: r.id })) toast('Review dihapus'); } }, 'Hapus'))),
          r.text ? h('p', {}, r.text) : null, ta,
          h('div', { class: 'row' }, h('button', { class: 'mini', onclick: () => save(r.replied) }, 'Simpan balasan'), h('button', { class: 'mini', onclick: async () => { try { await navigator.clipboard.writeText(ta.value); toast('Balasan disalin'); } catch { toast('Salin manual dari kotak balasan'); } } }, 'Salin'),
            INBOX[r.platform] ? h('a', { class: 'btn mini', href: INBOX[r.platform], target: '_blank', rel: 'noopener' }, 'Buka ' + L().sources[r.platform]) : null, r.replied ? null : h('button', { class: 'mini pri', onclick: () => save(1) }, 'Tandai sudah dibalas'))); })),
    h('div', { class: 'box' }, h('h3', {}, 'Catat review'), reviewForm(), h('p', { class: 'muted small' }, 'Airbnb dan Booking.com tidak membuka review lewat sambungan kalender, jadi review dicatat di sini (nilai Booking.com skala 10 dibagi dua). Nilai rata-rata per villa ikut tampil di Beranda.'))];
}

/* ---------- Tim & operasional ---------- */
const CH = { open: 'Belum ditagih', billed: 'Sudah ditagih', paid: 'Lunas', waived: 'Dibebaskan' };
function vTim() {
  const t = D.today, st = stays().filter(s => !s.cancelled && inScope(s) && ((s.s >= addD(t, -1) && s.s <= addD(t, 7)) || (s.e >= addD(t, -3) && s.e <= addD(t, 7)))).sort((a, b) => a.s.localeCompare(b.s));
  const issues = D.ops.filter(o => o.type === 'issue' && inScope(o)), sop = D.config.sop, origin = location.origin;
  const badge = (o, okText) => o ? h('span', {}, h('span', { class: 'tag good' }, okText), h('span', { class: 'muted small' }, ` ${o.by_name}, ${tfmt(o.at)}`)) : h('span', { class: 'tag' }, 'Belum');
  return [
    h('div', { class: 'panel' }, h('h2', {}, 'Kesiapan villa dan pemeriksaan checkout'),
      table(['Tamu', 'Villa', 'Check-in', 'Villa siap', 'Check-out', 'Pemeriksaan barang'], st.map(s => { const co = op('checkout', s.ref);
        return { onclick: () => openStay(s), cells: [h('b', {}, s.guest), vname(s.villa_id), dfmt(s.s), s.s < addD(t, -1) ? '' : badge(op('ready', s.ref), 'Siap'), dfmt(s.e),
          s.e > t ? h('span', { class: 'muted small' }, 'di hari checkout') : co ? h('span', {}, h('span', { class: 'tag ' + (co.data?.found?.length ? 'bad' : 'good') }, co.data?.found?.length ? `${co.data.found.length} temuan, ${rp(sum(co.data.found, f => f.amount))}` : 'Lengkap'), h('span', { class: 'muted small' }, ` ${co.by_name}`)) : h('span', { class: 'tag bad' }, 'Belum diperiksa')] }; }), 'Tidak ada check-in atau check-out dalam 7 hari ini.'),
      h('p', { class: 'muted small' }, 'Diisi karyawan dari halaman tim. Temuan kerusakan atau kehilangan otomatis menjadi tagihan ke tamu dengan harga SOP, lihat Keuangan → Tagihan tamu.')),
    h('div', { class: 'box' }, h('h3', {}, 'Laporan masalah dari tim'), h('ul', { class: 'plain' }, issues.length ? issues.map(o => h('li', {}, h('span', {}, h('b', {}, vname(o.villa_id)), ' · ' + o.text, h('span', { class: 'muted small' }, ` · ${o.by_name}, ${tfmt(o.at)}`)),
      o.status === 'open' ? h('button', { class: 'mini', onclick: async () => { if (await act({ action: 'issue_done', id: o.id })) toast('Ditandai selesai'); } }, 'Tandai selesai') : h('span', { class: 'tag good' }, 'Selesai' + (o.data?.done_by ? ' · ' + o.data.done_by : '')))) : h('li', { class: 'muted' }, 'Tidak ada laporan.'))),
    h('div', { class: 'panel' }, h('h2', {}, 'Karyawan'),
      table(['Nama', 'Email masuk', 'Peran', 'Villa', ''], D.staff.map(s => ({ cells: [h('b', {}, s.name), s.email, L().roles[s.role], s.villas.includes('*') ? 'Semua villa' : s.villas.map(vname).join(', '),
        h('button', { class: 'mini danger', onclick: async ev => { ev.stopPropagation(); if (confirm(`Cabut akses ${s.name}?`) && await act({ action: 'staff_delete', id: s.id })) toast('Akses dicabut'); } }, 'Cabut akses')] })), 'Belum ada karyawan.'),
      form([{ n: 'name', l: 'Nama', req: 1, max: 60 }, { n: 'email', l: 'Email (untuk masuk)', t: 'email', req: 1, max: 120 }, { n: 'role', l: 'Peran', t: 'select', o: Object.entries(L().roles) }, { n: 'villas', l: 'Villa yang dipegang (kosong = semua)', t: 'checks', o: D.villas.map(v => [v.id, v.name]) }],
        'Tambah / perbarui karyawan', async (v, err, f) => { if (await act({ action: 'staff_save', ...v }, err)) { f.reset(); toast('Karyawan tersimpan'); } }),
      h('p', { class: 'muted small' }, 'Housekeeping: menandai villa siap dan memeriksa barang saat checkout. Maintenance: jadwal maintenance dan laporan masalah. Manajer villa: semuanya. Tidak ada peran yang melihat nilai booking, payout atau keuangan.')),
    h('div', { class: 'box' }, h('h3', {}, 'Pintu masuk karyawan'), h('p', {}, 'Karyawan membuka ', h('a', { href: '/tim/' }, origin + '/tim/'), ' dan masuk dengan kode sekali pakai ke email mereka. Supaya bisa, buat satu aplikasi Cloudflare Access khusus halaman itu (sekali saja):'),
      h('ol', { style: 'margin:0;padding-left:20px;display:grid;gap:4px' }, h('li', {}, 'Zero Trust → Access → Applications → Add an application → Self-hosted.'), h('li', {}, `Hostname ${location.hostname}, path tim. Policy: Allow, Emails = email karyawan (atau "Everyone" dengan One-time PIN; aplikasi ini tetap hanya menerima email yang terdaftar di atas).`),
        h('li', {}, 'Salin "Application Audience (AUD) Tag" aplikasi itu ke kolom di bawah.')),
      form([{ n: 'team_aud', l: 'AUD tag aplikasi Access halaman tim', v: D.config.team_aud, ph: '64 karakter', wide: 1, max: 64 }], 'Simpan', async (v, err) => { if (await act({ action: 'config_save', ...v }, err)) toast('Tersimpan'); })),
    h('div', { class: 'grid2' },
      h('div', { class: 'box' }, h('h3', {}, 'SOP: langkah yang dicentang karyawan'), form([{ n: 'ready', l: 'Sebelum check-in (villa siap), satu langkah per baris', t: 'textarea', v: sop.ready.join('\n'), wide: 1 }, { n: 'checkout', l: 'Saat check-out, satu langkah per baris', t: 'textarea', v: sop.checkout.join('\n'), wide: 1 }],
        'Simpan SOP', async (v, err) => { if (await act({ action: 'config_save', sop: v }, err)) toast('SOP tersimpan'); })),
      h('div', { class: 'box' }, h('h3', {}, 'SOP: daftar barang dan harga ganti'), table(['Barang', 'Villa', ['Ditagih jika rusak / hilang', 'num'], ''], D.items.map(i => ({ cells: [i.name, i.villa_id ? vname(i.villa_id) : 'Semua villa', rp(i.charge),
          h('button', { class: 'mini danger', onclick: async () => { if (await act({ action: 'item_delete', id: i.id })) toast('Barang dihapus'); } }, 'Hapus')] })), 'Belum ada barang. Isi sesuai SOP: handuk, remote AC, gelas, kunci, dan seterusnya.'),
        form([{ n: 'name', l: 'Barang', req: 1, max: 80 }, { n: 'charge', l: 'Harga ganti (Rp)', mode: 'numeric', req: 1 }, { n: 'villa_id', l: 'Villa', t: 'select', o: [['', 'Semua villa'], ...D.villas.map(v => [v.id, v.name])] }], 'Tambah barang', async (v, err, f) => { if (await act({ action: 'item_save', ...v }, err)) toast('Barang ditambahkan'); })))];
}

/* ---------- Keuangan ---------- */
function vKeuangan() {
  const tabs = [['ringkasan', 'Ringkasan & progres'], ['payout', 'Payout'], ['tagihan', 'Tagihan tamu'], ['catatan', 'Pengeluaran & pemasukan lain']];
  return [h('div', { class: 'chips' }, tabs.map(([k, l]) => h('button', { 'aria-pressed': String(k === finTab), onclick: () => { finTab = k; render(); } }, l))), ...{ ringkasan: fRingkasan, payout: fPayout, tagihan: fTagihan, catatan: fCatatan }[finTab]()];
}
function fRingkasan() {
  const m = yearMoney(), mi = +month.slice(5) - 1, cur = m[mi], target = villa ? 0 : D.config.targets[D.year] || 0, tMonth = target / 12, ytdTo = D.year < +D.today.slice(0, 4) ? 11 : D.year > +D.today.slice(0, 4) ? -1 : +D.today.slice(5, 7) - 1;
  const total = sum(m, x => x.rev), out = sum(m, x => x.out), prevTotal = sum(m, x => x.prev), ytd = sum(m.slice(0, ytdTo + 1), x => x.rev), prevYtd = sum(m.slice(0, ytdTo + 1), x => x.prev), mName = dfmt(month + '-01', { month: 'long' });
  const vs = (a, b) => b ? `${a >= b ? '+' : '−'}${Math.abs(Math.round((a / b - 1) * 100))}% dibanding ${D.year - 1}` : `belum ada angka ${D.year - 1}`;
  const max = Math.max(1, ...m.map(x => Math.max(x.rev, x.out))), tip = h('div', { class: 'tip', hidden: true }), chart = h('div', { class: 'chart' }, h('span', { class: 'top' }, max > 1 ? 'maks. ' + rpShort(max) : 'Belum ada angka'), tip);
  m.forEach((x, i) => { const g = h('button', { class: 'grp', 'aria-label': `${MONTHS[i]} ${D.year}: pendapatan ${rp(x.rev)}, pengeluaran ${rp(x.out)}`, onclick: () => { month = `${D.year}-${String(i + 1).padStart(2, '0')}`; load(); } }, h('i', { class: 'in', style: `height:${x.rev / max * 100}%` }), h('i', { class: 'out', style: `height:${x.out / max * 100}%` }));
    const show = () => { tip.replaceChildren(h('b', {}, `${MONTHS[i]} ${D.year}`), h('div', {}, 'Pendapatan ' + rp(x.rev)), h('div', {}, 'Pengeluaran ' + rp(x.out)), h('div', { class: 'muted' }, 'Bersih ' + rpSigned(x.rev - x.out)), h('div', { class: 'muted' }, `${D.year - 1}: ${rp(x.prev)}`));
      tip.hidden = false; tip.style.left = i < 6 ? (g.offsetLeft + g.offsetWidth) + 'px' : ''; tip.style.right = i < 6 ? '' : (chart.offsetWidth - g.offsetLeft) + 'px'; };
    g.onmouseenter = g.onfocus = show; g.onmouseleave = g.onblur = () => tip.hidden = true; chart.append(g); });
  const prog = (title, value, tgt, sub) => h('div', { class: 'box' }, h('h3', {}, title), h('div', { class: 'row between' }, h('b', { style: 'font-family:var(--f-display);font-size:20px' }, rp(value)), h('span', { class: 'muted' }, tgt ? `dari target ${rp(tgt)} · ${Math.round(value / tgt * 100)}%` : villa ? 'target berlaku untuk semua villa' : 'target belum diisi')), meter(value, tgt), h('span', { class: 'muted small' }, sub));
  return [
    h('div', { class: 'grid2' }, prog('Progres pendapatan ' + mName, cur.rev, tMonth, vs(cur.rev, cur.prev)), prog(`Progres pendapatan tahun ${D.year}`, total, target, ytdTo >= 0 && ytdTo < 11 ? `Sampai ${MONTHS[ytdTo]}: ${rp(ytd)} · ${vs(ytd, prevYtd)}` : vs(total, prevTotal))),
    tiles([['Pendapatan ' + mName, rp(cur.rev), `booking ${rpShort(cur.bookings)} · lain ${rpShort(cur.other + cur.charges)}`], ['Pengeluaran ' + mName, rp(cur.out)], ['Bersih ' + mName, rpSigned(cur.rev - cur.out)], ['Bersih tahun ' + D.year, rpSigned(total - out), `pendapatan ${rpShort(total)} · pengeluaran ${rpShort(out)}`]]),
    h('div', { class: 'box' }, h('div', { class: 'row between' }, h('h3', {}, `Pendapatan dan pengeluaran per bulan, ${D.year}`), h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:var(--s-in);border:0' }), 'Pendapatan'), h('span', {}, h('i', { style: 'background:var(--s-out);border:0' }), 'Pengeluaran'))),
      chart, h('div', { class: 'xlab' }, MONTHS.map((x, i) => h('span', { class: i === mi ? 'cur' : '' }, x))),
      h('details', {}, h('summary', { class: 'small muted', style: 'cursor:pointer' }, 'Lihat sebagai tabel'), table(['Bulan', ['Booking', 'num'], ['Pemasukan lain', 'num'], ['Pengeluaran', 'num'], ['Bersih', 'num'], [`Pendapatan ${D.year - 1}`, 'num']],
        [...m.map((x, i) => ({ cells: [`${MONTHS[i]} ${D.year}`, rp(x.bookings), rp(x.other + x.charges), rp(x.out), rpSigned(x.rev - x.out), rp(x.prev)] })), { cells: [h('b', {}, 'Total'), rp(sum(m, x => x.bookings)), rp(sum(m, x => x.other + x.charges)), rp(out), rpSigned(total - out), rp(prevTotal)] }]))),
    villa ? null : h('div', { class: 'box' }, h('h3', {}, 'Target pendapatan setahun'), form([{ n: 't', l: `Target ${D.year} (Rp), semua villa`, v: target ? target.toLocaleString('id-ID') : '', mode: 'numeric' }], 'Simpan target', async (v, err) => { if (await act({ action: 'config_save', targets: { [D.year]: v.t } }, err)) toast('Target tersimpan'); }),
      h('p', { class: 'muted small' }, 'Target bulanan = target setahun dibagi 12. Pendapatan = nilai booking di bulan check-in, pemasukan lain, dan tagihan tamu yang sudah lunas.'))];
}
function fPayout() {
  const y = String(D.year), wait = awaiting().sort((a, b) => payoutDue(a).localeCompare(payoutDue(b))), plats = Object.keys(L().sources), rules = D.config.payout_rules;
  const linked = p => D.bookings.filter(b => b.payout_id === p.id), summary = plats.map(p => { const bs = D.bookings.filter(b => b.status !== 'cancelled' && b.source === p && inScope(b) && b.check_in.startsWith(y));
    return { p, n: bs.length, expected: sum(bs, b => b.total), paid: sum(bs.filter(b => b.payout_id), b => b.total), late: bs.filter(b => !b.payout_id && b.total && payoutDue(b) < D.today) }; }).filter(x => x.n);
  const src = h('select', { name: 'platform' }, plats.map(p => h('option', { value: p }, L().sources[p]))), checks = h('div', { class: 'checks', style: 'display:grid' }), amountIn = h('input', { name: 'amount', inputMode: 'numeric', required: true, placeholder: 'jumlah yang masuk rekening' }), hint = h('span', { class: 'muted small' });
  const fill = () => { const bs = wait.filter(b => b.source === src.value); checks.replaceChildren(...(bs.length ? bs.map(b => h('label', {}, h('input', { type: 'checkbox', value: b.id, onchange: upd }), `${b.guest} · ${vname(b.villa_id)} · ${dfmt(b.check_in)} – ${dfmt(b.check_out)} · ${b.total ? rp(b.total) : 'nilai belum diisi'}`)) : [h('span', { class: 'muted' }, 'Tidak ada booking dari sumber ini yang menunggu payout.')])); upd(); };
  const upd = () => { const ids = [...checks.querySelectorAll('input:checked')].map(c => +c.value), t = sum(wait.filter(b => ids.includes(b.id)), b => b.total); hint.textContent = ids.length ? `${ids.length} booking dipilih, nilai ${rp(t)}` : 'Centang booking yang dibayar payout ini.'; if (ids.length && !amountIn.value) amountIn.placeholder = t.toLocaleString('id-ID'); };
  src.onchange = fill; fill();
  const err = h('div', { class: 'err' }), dateIn = h('input', { type: 'date', name: 'date', value: D.today, required: true }), refIn = h('input', { name: 'ref', placeholder: 'kode payout / mutasi', maxLength: 60 });
  const pf = h('form', { class: 'f', onsubmit: async ev => { ev.preventDefault(); if (await act({ action: 'payout_save', platform: src.value, date: dateIn.value, amount: amountIn.value, ref: refIn.value, booking_ids: [...checks.querySelectorAll('input:checked')].map(c => +c.value) }, err)) toast('Payout dicatat'); } },
    h('label', {}, 'Sumber', src), h('label', {}, 'Tanggal uang masuk', dateIn), h('label', {}, 'Jumlah (Rp)', amountIn), h('label', {}, 'Referensi', refIn), h('div', { style: 'grid-column:1 / -1;display:grid;gap:6px' }, hint, checks), h('div', { class: 'row', style: 'grid-column:1 / -1;justify-content:flex-end' }, h('button', { class: 'pri' }, 'Catat payout')), err);
  return [
    tiles([['Menunggu payout', rp(sum(wait, b => b.total)), wait.length + ' booking'], ['Terlambat', rp(sum(wait.filter(b => b.total && payoutDue(b) < D.today), b => b.total)), wait.filter(b => b.total && payoutDue(b) < D.today).length + ' booking lewat perkiraan'], [`Uang masuk ${D.year}`, rp(sum(D.payouts.filter(p => p.date.startsWith(y)), p => p.amount)), 'semua sumber']]),
    h('div', { class: 'box' }, h('h3', {}, `Per platform, booking check-in ${D.year}`), table(['Platform', ['Booking', 'num'], ['Nilai booking', 'num'], ['Sudah cair', 'num'], ['Belum cair', 'num'], 'Keterangan'], summary.map(x => ({ cells: [h('b', {}, L().sources[x.p]), x.n, rp(x.expected), rp(x.paid), rp(x.expected - x.paid),
      x.late.length ? h('span', { class: 'tag bad' }, x.late.length + ' terlambat') : x.expected - x.paid ? h('span', { class: 'tag' }, 'menunggu jadwal') : h('span', { class: 'tag good' }, 'lunas')] })), 'Belum ada booking tahun ini.')),
    h('div', { class: 'box' }, h('h3', {}, 'Booking yang menunggu payout'), table(['Tamu', 'Villa', 'Sumber', 'Menginap', ['Nilai', 'num'], 'Perkiraan cair'], wait.map(b => ({ onclick: () => openStay(stays().find(s => s.ref === 'b:' + b.id)), cells: [h('b', {}, b.guest), vname(b.villa_id), L().sources[b.source], `${dfmt(b.check_in)} – ${dfmt(b.check_out)}`, b.total ? rp(b.total) : '—',
      !b.total ? h('span', { class: 'tag soon' }, 'isi nilai booking') : payoutDue(b) < D.today ? h('span', { class: 'tag bad' }, `Telat ${diff(payoutDue(b), D.today)} hari (${dfmt(payoutDue(b))})`) : h('span', { class: 'tag' }, dfmt(payoutDue(b)))] })), 'Semua booking sudah cair.')),
    h('div', { class: 'box' }, h('h3', {}, 'Catat uang masuk'), pf),
    h('div', { class: 'box' }, h('h3', {}, 'Payout yang sudah dicatat'), table(['Tanggal', 'Sumber', 'Referensi', 'Booking', ['Masuk', 'num'], ['Selisih dari nilai booking', 'num'], ''], D.payouts.map(p => { const bs = linked(p), exp = sum(bs, b => b.total), d = p.amount - exp;
      return { cells: [dfmt(p.date, { day: 'numeric', month: 'short', year: 'numeric' }), L().sources[p.platform] || p.platform, p.ref || '', bs.map(b => b.guest).join(', ') || h('span', { class: 'muted' }, 'tidak dikaitkan'), rp(p.amount), !bs.length ? '' : d ? h('span', { class: 'tag ' + (d < 0 ? 'bad' : '') }, rpSigned(d)) : h('span', { class: 'tag good' }, 'cocok'),
        h('button', { class: 'mini danger', onclick: async () => { if (confirm('Hapus catatan payout ini? Bookingnya kembali berstatus belum cair.') && await act({ action: 'payout_delete', id: p.id })) toast('Payout dihapus'); } }, 'Hapus')] }; }), 'Belum ada payout yang dicatat.')),
    h('div', { class: 'box' }, h('h3', {}, 'Jadwal cair tiap platform (perkiraan)'), form(plats.flatMap(p => [{ n: p + '_basis', l: L().sources[p], t: 'select', o: [['check_in', 'setelah check-in'], ['check_out', 'setelah check-out']], v: rules[p].basis }, { n: p + '_days', l: 'Jumlah hari', v: rules[p].days, mode: 'numeric' }]), 'Simpan jadwal',
      async (v, err) => { if (await act({ action: 'config_save', payout_rules: Object.fromEntries(plats.map(p => [p, { basis: v[p + '_basis'], days: v[p + '_days'] }])) }, err)) toast('Jadwal tersimpan'); }),
      h('p', { class: 'muted small' }, 'Dipakai untuk menandai payout yang terlambat. Sesuaikan dengan pengaturan payout di akun tiap platform.'))];
}
function fTagihan() {
  const list = D.charges.filter(inScope), by = s => sum(list.filter(c => c.status === s), c => c.amount);
  const set = (c, status) => h('button', { class: 'mini', onclick: async ev => { ev.stopPropagation(); if (await act({ action: 'charge_set', id: c.id, status })) toast('Status: ' + CH[status]); } }, CH[status]);
  return [tiles([['Belum ditagih', rp(by('open'))], ['Sudah ditagih, belum dibayar', rp(by('billed'))], ['Lunas (masuk pendapatan)', rp(by('paid'))]]),
    h('div', { class: 'box' }, h('h3', {}, 'Kerusakan dan kehilangan yang ditagihkan ke tamu'), table(['Checkout', 'Tamu', 'Villa', 'Barang', ['Jumlah', 'num'], 'Status', 'Ubah status'], list.map(c => ({ cells: [dfmt(c.date), h('b', {}, c.guest || 'Tamu'), vname(c.villa_id), `${c.item} ${c.kind}${c.qty > 1 ? ' ×' + c.qty : ''}${c.note ? ' · ' + c.note : ''}`, rp(c.amount),
      h('span', { class: 'tag ' + (c.status === 'paid' ? 'good' : c.status === 'open' ? 'bad' : '') }, CH[c.status]), h('span', { class: 'row' }, ['billed', 'paid', 'waived', 'open'].filter(s => s !== c.status).map(s => set(c, s)))] })), 'Belum ada temuan dari pemeriksaan checkout.'),
      h('p', { class: 'muted small' }, 'Dibuat otomatis saat karyawan mencatat kerusakan atau kehilangan di pemeriksaan checkout, dengan harga dari daftar barang SOP. Penagihannya ke tamu dilakukan lewat platform atau langsung.'))];
}
function fCatatan() {
  const type = h('select', { name: 'type' }, h('option', { value: 'out' }, 'Pengeluaran'), h('option', { value: 'in' }, 'Pemasukan lain')), cat = h('select', { name: 'category' }), fillCat = () => cat.replaceChildren(...CATS[type.value].map(c => h('option', { value: c }, c)));
  type.onchange = fillCat; fillCat();
  const err = h('div', { class: 'err' }), date = h('input', { type: 'date', value: D.today.startsWith(month) ? D.today : month + '-01', required: true }), vsel = h('select', {}, h('option', { value: '' }, 'Semua / umum'), D.villas.map(v => h('option', { value: v.id }, v.name))), amt = h('input', { inputMode: 'numeric', placeholder: '500.000', required: true }), note = h('input', { maxLength: 200 });
  if (villa) vsel.value = villa;
  const rows = D.ledger.filter(l => inScope(l) && l.date.startsWith(month)), by = {};
  rows.forEach(r => { const k = (r.type === 'in' ? 'Masuk · ' : 'Keluar · ') + r.category; by[k] = (by[k] || 0) + r.amount; });
  return [h('div', { class: 'box' }, h('h3', {}, 'Catat pengeluaran / pemasukan lain'), h('form', { class: 'f', onsubmit: async ev => { ev.preventDefault(); if (await act({ action: 'ledger_add', type: type.value, date: date.value, category: cat.value, villa_id: vsel.value, amount: amt.value, note: note.value }, err)) toast('Tercatat'); } },
      h('label', {}, 'Jenis', type), h('label', {}, 'Tanggal', date), h('label', {}, 'Kategori', cat), h('label', {}, 'Villa', vsel), h('label', {}, 'Jumlah (Rp)', amt), h('label', {}, 'Catatan', note), h('button', { class: 'pri' }, 'Simpan')), err,
      h('p', { class: 'muted small' }, 'Nilai booking sudah dihitung otomatis sebagai pendapatan, jadi tidak dicatat lagi di sini.')),
    h('div', { class: 'box' }, h('h3', {}, 'Catatan ' + dfmt(month + '-01', { month: 'long', year: 'numeric' })), table(['Tanggal', 'Jenis', 'Kategori', 'Villa', 'Catatan', ['Jumlah', 'num'], ''], rows.map(r => ({ cells: [dfmt(r.date), h('span', { class: 'tag' }, r.type === 'in' ? 'Masuk' : 'Keluar'), r.category, r.villa_id ? vname(r.villa_id) : 'Umum', h('span', { class: 'muted' }, r.note || ''), (r.type === 'in' ? '+ ' : '− ') + rp(r.amount),
      h('button', { class: 'mini danger', onclick: async () => { if (confirm(`Hapus catatan ${r.category} ${rp(r.amount)}?`) && await act({ action: 'ledger_delete', id: r.id })) toast('Catatan dihapus'); } }, 'Hapus')] })), 'Belum ada catatan bulan ini.')),
    h('div', { class: 'box' }, h('h3', {}, 'Per kategori bulan ini'), h('ul', { class: 'plain' }, Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => h('li', {}, h('span', {}, k), h('span', {}, rp(v)))), rows.length ? null : h('li', { class: 'muted' }, 'Belum ada catatan.')))];
}

/* ---------- Villa & platform ---------- */
function vPengaturan() {
  const base = D.ical_export.host ? 'https://' + D.ical_export.host : null, P = L().platforms;
  const cards = D.villas.map(v => { const feeds = D.feeds.filter(f => f.villa_id === v.id), err = h('div', { class: 'err' });
    return h('div', { class: 'box' },
      h('div', { class: 'row between' }, h('div', {}, h('b', {}, v.name), h('span', { class: 'muted small' }, '  ' + [v.area, v.note].filter(Boolean).join(' · '))),
        h('div', { class: 'row' }, h('button', { class: 'mini', onclick: () => dialog(h('h2', {}, 'Ubah villa'), form([{ n: 'name', l: 'Nama villa', v: v.name, req: 1, max: 60 }, { n: 'area', l: 'Daerah', v: v.area, max: 40 }, { n: 'note', l: 'Catatan', v: v.note, wide: 1, max: 200 }], 'Simpan',
          async (x, e) => { if (await act({ action: 'villa_save', ...v, ...x }, e)) { closeDlg(); toast('Villa tersimpan'); } }, [closeBtn('Batal')])) }, 'Ubah'),
          h('button', { class: 'mini danger', onclick: async () => { if (confirm(`Arsipkan ${v.name}? Villa hilang dari kalender dan sinkron berhenti; booking dan catatan keuangannya tetap tersimpan.`) && await act({ action: 'villa_delete', id: v.id })) toast('Villa diarsipkan'); } }, 'Arsipkan'))),
      h('h3', {}, '1 · Ambil kalender dari platform'),
      h('ul', { class: 'plain' }, feeds.length ? feeds.map(f => h('li', {}, h('span', {}, h('b', {}, P[f.platform] || f.platform), h('span', { class: 'muted small' }, `  ${f.last_sync ? 'terakhir ' + tfmt(f.last_sync) + ` · ${f.last_count ?? 0} tanggal aktif` : 'belum pernah berhasil'}`)),
        h('span', { class: 'row' }, h('button', { class: 'mini', onclick: async ev => { ev.target.disabled = true; ev.target.textContent = 'Membaca…'; const j = await act({ action: 'feed_sync', id: f.id }); if (j) toast(j.sync[0]?.ok ? 'Kalender terbaca' : 'Gagal: ' + (j.sync[0]?.error || '')); } }, 'Sinkron'),
          h('button', { class: 'mini danger', onclick: async () => { if (confirm(`Putuskan kalender ${P[f.platform]} dari ${v.name}? Reservasi yang terbaca dari sana ikut hilang dari kalender.`) && await act({ action: 'feed_delete', id: f.id })) toast('Sambungan diputus'); } }, 'Putuskan')),
        f.last_error ? h('div', { class: 'err small', style: 'flex-basis:100%' }, 'Gagal dibaca: ' + f.last_error) : null)) : h('li', { class: 'muted' }, 'Belum ada kalender platform yang tersambung.')),
      form([{ n: 'platform', l: 'Platform', t: 'select', o: Object.entries(P) }, { n: 'url', l: 'Alamat kalender (iCal) dari platform', t: 'url', req: 1, ph: 'https://www.airbnb.com/calendar/ical/….ics', max: 1000 }], 'Sambungkan',
        async (x, e) => { const j = await act({ action: 'feed_add', villa_id: v.id, ...x }, e); if (j) toast(j.sync[0]?.ok ? `Tersambung, ${j.sync[0].count} tanggal terbaca` : 'Tersimpan, tapi belum terbaca: ' + (j.sync[0]?.error || '')); }),
      h('h3', {}, '2 · Kirim kalender ke platform'),
      base ? h('ul', { class: 'plain' }, Object.entries(P).map(([k, l]) => { const href = `${base}/ical/${D.ical_export.token}/${v.id}/${k}.ics`;
        return h('li', { style: 'flex-wrap:nowrap;align-items:center' }, h('span', { style: 'min-width:120px' }, k === 'lainnya' ? 'Platform lain' : 'Untuk ' + l), h('span', { class: 'url' }, href), h('button', { class: 'mini', onclick: async () => { try { await navigator.clipboard.writeText(href); toast('Alamat disalin'); } catch { prompt('Salin alamat ini', href); } } }, 'Salin')); }))
        : h('p', { class: 'muted small' }, 'Alamat kalender keluar muncul di sini setelah deploy berikutnya selesai (aplikasi perlu mengenali alamat publiknya dulu).')); });
  return [h('div', { class: 'box' }, h('h3', {}, 'Tambah villa'), form([{ n: 'name', l: 'Nama villa', req: 1, ph: 'Villa Senja', max: 60 }, { n: 'area', l: 'Daerah', ph: 'Canggu', max: 40 }, { n: 'note', l: 'Catatan', ph: 'Jumlah kamar, alamat', max: 200 }], 'Tambah villa',
      async (v, err, f) => { if (await act({ action: 'villa_save', ...v }, err)) { toast('Villa ditambahkan'); } })), ...cards,
    h('div', { class: 'box' }, h('h3', {}, 'Cara kerja sambungan platform'), h('p', {}, 'Airbnb, Booking.com, Agoda dan sejenisnya bertukar kalender lewat alamat iCal, dipasang sekali per villa per platform:'),
      h('ol', { style: 'margin:0;padding-left:20px;display:grid;gap:4px' }, h('li', {}, h('b', {}, 'Ambil dari platform: '), 'salin alamat "Export calendar" dari listing villa, tempel di kolom alamat kalender villa itu. Dibaca tiap 30 menit.'),
        h('li', {}, h('b', {}, 'Kirim ke platform: '), 'salin alamat "Untuk …" dan tempel di menu "Import calendar" platform yang sama. Platform lalu menutup tanggal yang sudah dibooking di tempat lain atau diblokir di sini.')),
      h('p', { class: 'muted small' }, 'Airbnb: Kalender → Ketersediaan → Hubungkan kalender. Booking.com: Kalender → Sinkronkan kalender. Platform mengambil ulang kalender impor menurut jadwal mereka sendiri (biasanya beberapa jam sekali), jadi penutupan tanggal di sana tidak seketika. Yang lewat sambungan ini hanya tanggal; chat, review, harga dan payout tidak disediakan platform untuk sambungan seperti ini.'))];
}

/* ---------- wiring ---------- */
$('villa-pick').onchange = ev => { villa = +ev.target.value; render(); };
$('prev').onclick = () => { month = addM(month, -1); load(); };
$('next').onclick = () => { month = addM(month, 1); load(); };
$('today-btn').onclick = () => { month = D.today.slice(0, 7); selDay = D.today; load(); };
$('burger').onclick = () => { $('side').classList.add('open'); $('scrim').hidden = false; };
$('scrim').onclick = () => { $('side').classList.remove('open'); $('scrim').hidden = true; };
$('dlg').onclick = ev => { if (ev.target === $('dlg')) closeDlg(); };
load();
