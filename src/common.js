// Small helpers shared by the Kantor worker. The D1 database is the same one likuloka.com uses.
export const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
});
export const now = () => new Date().toISOString();
/** Today's date in Bali (WITA, UTC+8) as YYYY-MM-DD. */
export const witaDate = (d = new Date()) => new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
export const parseJson = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };
export const cleanText = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export async function body(req) { try { return await req.json(); } catch { return {}; } }

/** CSRF guard for writes: a JSON body from this same origin only (a cross-site form or no-cors fetch cannot send that). */
export function sameOriginJson(req) {
  if (!(req.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return false;
  if (req.headers.get('origin') !== new URL(req.url).origin) return false;
  const site = req.headers.get('sec-fetch-site');
  return site === null || site === 'same-origin';
}

/** Values the browser may draw or link from kantor_status: a hex colour, an https / same-page / same-site link. */
export const DEFAULT_COLOR = '#DDE0D2';
export const safeColor = c => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : DEFAULT_COLOR);
export function safeLink(l) {
  if (typeof l !== 'string' || !l) return null;
  if (l.startsWith('#') || /^\/(?![/\\])/.test(l)) return l;
  try { return new URL(l).protocol === 'https:' ? l : null; } catch { return null; }
}

// Security headers on every response. The page has one inline <script> (allowed by its sha256 hash, see worker.js),
// inline <style> blocks and style="" attributes (style-src 'unsafe-inline'), and Google Fonts (css + font files).
export function csp(scriptHashes = []) {
  return ["default-src 'self'", `script-src 'self' ${scriptHashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src https://fonts.gstatic.com",
    "img-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join('; ');
}
export function secure(res, scriptHashes) {
  const out = new Response(res.body, res);   // copy: Response.redirect() and asset responses have immutable headers
  out.headers.set('content-security-policy', csp(scriptHashes));
  out.headers.set('x-content-type-options', 'nosniff');
  out.headers.set('referrer-policy', 'same-origin');
  out.headers.set('x-frame-options', 'DENY');
  return out;
}
/** sha256 CSP sources for each inline <script> of an HTML page. */
export async function inlineScriptHashes(html) {
  const out = [];
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(m[1])));
    out.push(`'sha256-${btoa(String.fromCharCode(...d))}'`);
  }
  return out;
}

export async function getSetting(env, key, fallback) {
  const r = await env.DB.prepare('SELECT value FROM ops_settings WHERE key = ?').bind(key).first();
  return r ? parseJson(r.value, fallback) : fallback;
}
export async function setSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO ops_settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, JSON.stringify(value), now()).run();
}

/** Team members with a daily report duty who have not sent today's 'harian' report (same rule as likuloka.com). */
export async function missingReports(env, date = witaDate()) {
  const canSee = (m, pid) => { const l = parseJson(m.projects, ['*']); return l.includes('*') || l.includes(pid); };
  const { results: team } = await env.DB.prepare("SELECT id, name, projects FROM team WHERE active = 1 AND daily = 1 AND role != 'owner'").all();
  const { results: active } = await env.DB.prepare("SELECT id, name FROM projects WHERE status = 'in_progress'").all();
  const { results: sent } = await env.DB.prepare("SELECT DISTINCT team_id, project_id FROM field_reports WHERE report_date = ? AND kind = 'harian'").bind(date).all();
  const out = [];
  for (const t of team) for (const p of active.filter(p => canSee(t, p.id)))
    if (!sent.some(s => s.team_id === t.id && s.project_id === p.id)) out.push({ team_id: t.id, name: t.name, project_id: p.id, project_name: p.name });
  return out;
}
