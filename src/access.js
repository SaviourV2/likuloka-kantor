// Owner sign-in check. Cloudflare Access sits in front of /admin and /api/admin and
// adds a signed JWT to every request it lets through. We verify that JWT here too,
// so the private data stays private even if the Access rule is misconfigured.

const enc = new TextEncoder();
let jwksCache = { at: 0, keys: [] };

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlJson = s => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

function cookie(req, name) {
  const c = req.headers.get('cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }   // a malformed cookie counts as no token
}

async function jwks(env, fresh = false) {
  if (!fresh && Date.now() - jwksCache.at < 10 * 60 * 1000 && jwksCache.keys.length) return jwksCache.keys;
  const r = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error(`Access certs ${r.status}`);
  jwksCache = { at: Date.now(), keys: (await r.json()).keys || [] };
  return jwksCache.keys;
}
// The key for a token's kid. Access rotates its keys, so an unknown kid refetches the JWKS once (at most every
// 30 seconds, so tokens with made-up kids cannot make every request call the certs endpoint).
async function findKey(env, kid) {
  const jwk = (await jwks(env)).find(k => k.kid === kid);
  if (jwk || Date.now() - jwksCache.at < 30 * 1000) return jwk || null;
  return (await jwks(env, true)).find(k => k.kid === kid) || null;
}
// RS256 signature check; a malformed signature or key is just "not valid".
async function signatureOk(jwk, parts) {
  try {
    const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
  } catch { return false; }
}

/** Returns { email, role } for a signed-in owner ('owner') or office team member ('team'), or null.
 *  Team emails (TEAM_EMAILS) may only open the pages and API listed in TEAM_PAGES / TEAM_API in worker.js. */
/** Like verifyAccess, but returns { who } or { why, aud?, email? } so the page can say what is wrong. */
export async function checkAccess(req, env) {
  const why = (w, x = {}) => ({ who: null, why: w, ...x });
  const url = new URL(req.url);
  if (env.DEV_BYPASS_AUTH === '1' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return { who: { email: 'dev@localhost', role: 'owner' } };
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return why('ACCESS_TEAM_DOMAIN / ACCESS_AUD belum diisi');
  const token = req.headers.get('cf-access-jwt-assertion') || cookie(req, 'CF_Authorization');
  if (!token) return why('tidak ada token Cloudflare Access (hostname kantor.likuloka.com belum dilindungi Access)', { login: true });
  const parts = token.split('.');
  if (parts.length !== 3) return why('token rusak');
  let header, payload;
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]); } catch { return why('token rusak'); }
  if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') return why('token rusak');
  const t = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < t) return why('token kedaluwarsa, buka ulang halaman', { login: true });
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const allowed = String(env.ACCESS_AUD).split(',').map(x => x.trim());
  if (!aud.some(a => allowed.includes(a))) return why('aplikasi Access berbeda (AUD tidak cocok)', { aud: aud.join(',') });
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return why('team domain Access berbeda', { iss: payload.iss });
  const jwk = await findKey(env, header.kid);
  if (!jwk) return why('kunci Access tidak ditemukan');
  if (!(await signatureOk(jwk, parts))) return why('tanda tangan token tidak valid');
  const email = String(payload.email || '').toLowerCase();
  const list = v => (v || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  if (!list(env.KANTOR_EMAILS).includes(email)) return why('email ini tidak terdaftar untuk Kantor', { email });
  return { who: { email, role: 'owner' } };
}

export async function verifyAccess(req, env) {
  const url = new URL(req.url);
  // Local development only: `wrangler dev` on localhost with DEV_BYPASS_AUTH=1 in .dev.vars.
  if (env.DEV_BYPASS_AUTH === '1' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return { email: 'dev@localhost', role: 'owner' };

  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const token = req.headers.get('cf-access-jwt-assertion') || cookie(req, 'CF_Authorization');
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]); } catch { return null; }
  if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') return null;

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) return null;
  if (payload.nbf && payload.nbf > now + 60) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;

  const jwk = await findKey(env, header.kid);
  if (!jwk) return null;
  if (!(await signatureOk(jwk, parts))) return null;

  const list = v => (v || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  const email = String(payload.email || '').toLowerCase();
  if (!email) return null;
  if (list(env.OWNER_EMAILS).includes(email)) return { email, role: 'owner' };
  if (list(env.TEAM_EMAILS).includes(email)) return { email, role: 'team' };
  return null;
}
