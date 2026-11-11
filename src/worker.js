// Kantor (kantor.likuloka.com): Kevin's office of Claude desks, with the Villa & Kahuna desk.
// Its own Worker and repo, on the same D1 database as likuloka.com (it reads the site's tables and owns
// ops_settings 'kantor_status' / 'kantor_board' and the villa_* tables). Cloudflare Access sits in front of the
// whole hostname; the worker checks the Access JWT again and lets only KANTOR_EMAILS in.
import { checkAccess } from './access.js';
import { body, cleanText, getSetting, inlineScriptHashes, json, missingReports, now, safeColor, safeLink, sameOriginJson, secure, setSetting, witaDate } from './common.js';
import { villaCards, villaStatus } from './villa.js';

const SITE = 'https://likuloka.com';   // the main site's /admin pages that live cards link to
const asList = v => (v || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
const canSeeKantor = (who, env) => who.email === 'dev@localhost' || asList(env.KANTOR_EMAILS).includes(who.email);

// Kantor board (ops_settings 'kantor_board'): Kevin's decisions on cards (approved = done and checked) and the
// tasks he adds himself. The scheduled Ops run reads it to close approved cards and pick up new tasks.
const KANTOR_BOARD = 'kantor_board';
const MAX_DECISIONS = 500;
async function kantorCard(env, d, who) {
  const b = (await getSetting(env, KANTOR_BOARD, null)) || { added: [], decisions: {} };
  b.added ||= []; b.decisions ||= {}; b.routines ||= [];
  const id = cleanText(d.id, 80), desk = cleanText(d.desk, 40), text = cleanText(d.text, 300), note = cleanText(d.note, 300), at = now();
  if (d.action === 'add') {
    if (!desk || text.length < 3) return json({ error: 'Pilih meja dan tulis tugasnya' }, 400);
    b.added.push({ id: 'k-' + crypto.randomUUID().slice(0, 8), desk, text, tone: d.tone === 'macet' ? 'macet' : 'todo', by: who.email, at });
  } else if (d.action === 'approve' || d.action === 'review') {
    if (!id) return json({ error: 'Kartu tidak dikenal' }, 400);
    b.decisions[id] = { status: d.action === 'approve' ? 'approved' : 'review', at, by: who.email, note, desk, text };
  } else if (d.action === 'reopen') {
    delete b.decisions[id];
  } else if (d.action === 'add_routine') {
    const every = ['daily', 'weekly', 'monthly'].includes(d.every) ? d.every : 'weekly';
    const day = every === 'weekly' ? Math.min(7, Math.max(1, Number(d.day) || 1)) : every === 'monthly' ? Math.min(31, Math.max(1, Number(d.day) || 1)) : null;
    if (!desk || text.length < 3) return json({ error: 'Pilih meja dan tulis rutinitasnya' }, 400);
    b.routines.push({ id: 'r-' + crypto.randomUUID().slice(0, 8), desk, text, every, day, by: who.email, at });
  } else if (d.action === 'delete_routine') {
    b.routines = b.routines.filter(r => r.id !== id);
  } else return json({ error: 'Aksi tidak dikenal' }, 400);
  // Keep the board small: approved tasks Kevin added drop off after 60 days, old decisions too, and at most
  // MAX_DECISIONS decisions are kept (newest first). An approved task leaves together with its decision, so it
  // does not come back as open.
  const cutoff = new Date(Date.now() - 60 * 864e5).toISOString();
  b.added = b.added.filter(t => !(b.decisions[t.id]?.status === 'approved' && b.decisions[t.id].at < cutoff)).slice(-200);
  for (const [k, v] of Object.entries(b.decisions)) if (v.at < cutoff) delete b.decisions[k];
  const newest = Object.keys(b.decisions).sort((x, y) => (b.decisions[x].at < b.decisions[y].at ? 1 : -1));
  for (const k of newest.slice(MAX_DECISIONS)) {
    if (b.decisions[k].status === 'approved') b.added = b.added.filter(t => t.id !== k);
    delete b.decisions[k];
  }
  b.routines = b.routines.slice(-100);
  await setSetting(env, KANTOR_BOARD, b);
  return { ok: true, board: b };
}

// Routines (Kevin's recurring tasks): the latest occurrence on or before today (WITA) becomes a card on its desk,
// id 'r:<routine>:<date>', and stays until approved; the next occurrence makes a new card.
function routineCards(board, today) {
  const out = {}, dec = board?.decisions || {};
  const [y, m, dd] = today.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, dd));
  const iso = x => x.toISOString().slice(0, 10), WD = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
  for (const r of board?.routines || []) {
    let last;
    if (r.every === 'daily') last = t;
    else if (r.every === 'weekly') { const wd = t.getUTCDay() || 7; last = new Date(t.getTime() - ((wd - r.day + 7) % 7) * 864e5); }
    else { const at = (yy, mm) => new Date(Date.UTC(yy, mm, Math.min(r.day, new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate())));
      last = at(y, m - 1); if (last > t) last = at(m === 1 ? y - 1 : y, m === 1 ? 11 : m - 2); }
    if (r.at && !isNaN(Date.parse(r.at)) && iso(last) < witaDate(new Date(r.at))) continue;   // not due yet since it was added (both WITA)
    const id = `r:${r.id}:${iso(last)}`;
    if (dec[id]?.status === 'approved') continue;
    const when = r.every === 'daily' ? 'harian' : r.every === 'weekly' ? 'tiap ' + WD[r.day] : 'tiap tanggal ' + r.day;
    (out[r.desk] ||= []).push({ id, text: `${r.text} (${when}, ${iso(last)})`, tone: 'todo', routine: true, ...(dec[id]?.status === 'review' ? { review: true } : {}) });
  }
  return out;
}

// Live cards from the website's own data, so the office shows what is open right now without waiting for a run.
async function kantorLive(env) {
  const q = (sql, ...a) => env.DB.prepare(sql).bind(...a);
  const today = witaDate(), hour = new Date(Date.now() + 8 * 3600e3).getUTCHours();
  // Each source on its own: one failing query (e.g. a table renamed on the main site) only drops its own cards.
  const safe = (what, p, fallback) => p.catch(e => { console.error('live ' + what, e); return fallback; });
  const [waiting, errors, rejected, nota, quiet, sheet, wenv, missing] = await Promise.all([
    safe('waiting', q("SELECT COUNT(*) AS n, MIN(report_date) AS since FROM field_reports WHERE approval = 'waiting'").first(), null),
    safe('errors', q("SELECT id, project_id, report_date FROM field_reports WHERE analysis_status = 'error' ORDER BY id DESC LIMIT 5").all().then(r => r.results), []),
    safe('rejected', q("SELECT COUNT(*) AS n FROM field_reports WHERE approval = 'rejected' AND id NOT IN (SELECT report_id FROM report_redo) AND decided_at > strftime('%Y-%m-%dT%H:%M:%SZ','now','-30 days')").first(), null),
    safe('nota', q("SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS s FROM journal WHERE status = 'pending'").first(), null),
    safe('quiet', q(`SELECT p.id, p.name, (SELECT MAX(report_date) FROM field_reports r WHERE r.project_id = p.id) AS last FROM projects p
      WHERE p.status = 'in_progress' AND (p.started IS NULL OR p.started <= ?)`, today.slice(0, 7)).all().then(r => r.results), []),
    safe('jurnal_sheet', getSetting(env, 'jurnal_sheet', null), null), safe('worker_env', getSetting(env, 'worker_env', null), null),
    hour >= 15 ? missingReports(env, today).catch(() => []) : [],
  ]);
  const live = { konstruksi: [], ops: [] }, card = (desk, key, text, tone, link) => live[desk].push({ id: 'live:' + key, text, tone, live: true, link });
  if (waiting?.n) card('konstruksi', 'waiting', `${waiting.n} laporan lapangan menunggu approve (sejak ${waiting.since})`, 'kevin', SITE + '/admin/ops');
  for (const e of errors || []) card('konstruksi', 'err' + e.id, `Laporan #${e.id} (${e.project_id}, ${e.report_date}) gagal dianalisa; dicoba ulang otomatis`, 'macet', SITE + '/admin/ops');
  if (rejected?.n) card('konstruksi', 'rejected', `${rejected.n} laporan ditolak belum dikirim ulang oleh tim lapangan`, 'todo', SITE + '/admin/ops');
  const stale = d => d && (Date.parse(today) - Date.parse(d)) / 864e5;
  for (const p of quiet || []) if (!p.last || stale(p.last) >= 2) card('konstruksi', 'quiet-' + p.id, `${p.name}: belum ada laporan lapangan ${p.last ? 'sejak ' + p.last : 'sama sekali'}`, 'macet', SITE + '/admin/ops');
  if (missing.length) card('konstruksi', 'missing', `Belum lapor hari ini: ${[...new Set(missing.map(m => m.name))].join(', ')}`, 'todo', SITE + '/admin/ops');
  if (nota?.n) card('ops', 'nota', `${nota.n} nota lapangan menunggu keputusan (Rp ${Math.round(nota.s).toLocaleString('id-ID')})`, 'kevin', SITE + '/admin/jurnal');
  for (const s of (sheet?.skipped || []).filter(x => /tidak dikenal|tanpa jumlah/.test(x.why))) card('ops', 'sheet' + s.row, `Jurnal sheet baris ${s.row}: ${s.why}`, 'macet', SITE + '/admin/jurnal');
  if (sheet?.last_error) card('ops', 'sheet-err', `Sinkron jurnal sheet gagal: ${sheet.last_error}`, 'macet', SITE + '/admin/jurnal');
  for (const [k, label] of [['github', 'GITHUB_TOKEN (publish ke website)'], ['google_sa', 'GOOGLE_SA_KEY (sheet privat)']])
    if (wenv && wenv[k] === false) card('ops', 'secret-' + k, `Secret ${label} belum diisi di Cloudflare`, 'todo', null);
  return live;
}

// kantor_status is written by a routine, not by this page: keep only colours and links the page can use safely.
function cleanStatus(s) {
  if (!s || !Array.isArray(s.desks)) return s;
  return { ...s, desks: s.desks.map(d => ({ ...d, color: safeColor(d?.color),
    cards: Array.isArray(d?.cards) ? d.cards.map(c => ({ ...c, link: safeLink(c?.link) })) : [] })) };
}

export default {
  async fetch(req, env) {
    let res, hashes = [];
    try {
      res = await handle(req, env);
      // The page's inline script is allowed by its hash, so an injected <script> or on*= attribute does not run.
      if ((res.headers.get('content-type') || '').startsWith('text/html') && res.body) {
        const html = await res.text();
        hashes = await inlineScriptHashes(html);
        res = new Response(html, res);
      }
    } catch (e) {
      console.error(e);
      res = json({ error: 'Server error' }, 500);
    }
    return secure(res, hashes);
  },
};

async function handle(req, env) {
  const url = new URL(req.url), p = url.pathname, m = req.method;
  // CSRF: every write must be a same-origin JSON request (checked before sign-in and before any DB access).
  if (m !== 'GET' && m !== 'HEAD' && !sameOriginJson(req)) return json({ error: 'Permintaan ditolak (bukan dari halaman Kantor)' }, 403);
  const a = await checkAccess(req, env), who = a.who;
  if (!who || !canSeeKantor(who, env)) {
    const why = a.why || 'email ini tidak terdaftar untuk Kantor';
    // Not signed in yet: send the browser to the Cloudflare Access login, which comes back here afterwards.
    // ?masuk=1 marks the way back, so a hostname Access does not cover shows the reason instead of looping.
    if (a.login && !p.startsWith('/api/') && !url.searchParams.has('masuk') && env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
      // One leading slash only, so the way back can never become a protocol-relative '//other.host' URL.
      const back = url.pathname.replace(/^\/+/, '/') + (url.search ? url.search + '&' : '?') + 'masuk=1';
      const login = `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/login/${url.hostname}?kid=${env.ACCESS_AUD.split(',')[0].trim()}&redirect_url=${encodeURIComponent(back)}`;
      return Response.redirect(login, 302);
    }
    if (p.startsWith('/api/')) return json({ error: 'Khusus Kevin', why }, 401);
    // AUD / issuer come from a token that failed the check: shown only as plain text (nosniff), shortened.
    const extra = [a.email && 'Email: ' + a.email, a.aud && 'AUD token: ' + cleanText(a.aud, 200), a.iss && 'Issuer: ' + cleanText(a.iss, 200)].filter(Boolean).join('\n');
    return new Response(`Kantor khusus untuk Kevin. Masuk lewat Cloudflare Access.\n\nAlasan: ${why}${extra ? '\n' + extra : ''}`,
      { status: 401, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (p === '/api/status' && m === 'GET') {
    const [status, board, live, villa] = await Promise.all([getSetting(env, 'kantor_status', null).then(cleanStatus), getSetting(env, KANTOR_BOARD, null), kantorLive(env),
      villaStatus(env).catch(e => { console.error('villa', e); return null; })]);
    if (villa) live.villa = villaCards(villa);
    for (const [desk, cards] of Object.entries(routineCards(board, witaDate()))) (live[desk] ||= []).push(...cards);
    return json({ ...(status || { desks: null }), board: board || { added: [], decisions: {}, routines: [] }, live, villa, live_at: now() });
  }
  if (p === '/api/card' && m === 'POST') { const r = await kantorCard(env, await body(req), who); return r instanceof Response ? r : json(r); }
  if (p.startsWith('/api/')) return json({ error: 'Not found' }, 404);
  const res = await env.ASSETS.fetch(req);
  const out = new Response(res.body, res); out.headers.set('cache-control', 'no-store'); out.headers.set('x-robots-tag', 'noindex');
  return out;
}
