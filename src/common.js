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
