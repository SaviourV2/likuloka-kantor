// Market prices for the Dompet: Bitcoin (IDR and USD) and IHSG (Jakarta Composite, ^JKSE).
// Sources are free and need no key: CoinGecko (Indodax as fallback for BTC/IDR) and Yahoo Finance's chart API.
// Results are cached in ops_settings 'dompet_market' for 10 minutes (history for 6 hours), and the last good value
// is kept when a source is down, with its time, so the page and the bot always have something honest to show.
import { getSetting, now, setSetting, witaDate } from '../common.js';

const KEY = 'dompet_market';
const FRESH = 10 * 60e3, HIST_FRESH = 6 * 3600e3;
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; likuloka-kantor/1.0)', accept: 'application/json' };

async function getJson(url, headers = {}) {
  const host = new URL(url).hostname;
  const r = await fetch(url, { headers: { ...UA, ...headers }, cf: { cacheTtl: 60 } }).catch(() => { throw new Error(`${host} tidak bisa dihubungi`); });
  if (!r.ok) throw new Error(`${host} ${r.status}`);
  return r.json();
}
const cgHeaders = env => (env.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': env.COINGECKO_API_KEY } : {});

async function fetchBtc(env) {
  try {
    const d = await getJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=idr,usd&include_24hr_change=true', cgHeaders(env));
    const b = d.bitcoin;
    if (!b?.idr) throw new Error('CoinGecko: no price');
    return { idr: b.idr, usd: b.usd, change_24h: b.idr_24h_change ?? b.usd_24h_change ?? null, source: 'CoinGecko', at: now() };
  } catch (e) {
    // Indodax (Indonesian exchange) as fallback: rupiah price only.
    const d = await getJson('https://indodax.com/api/ticker/btcidr');
    const t = d.ticker;
    if (!t?.last) throw new Error(`BTC: ${e.message}; Indodax: no price`);
    return { idr: Number(t.last), usd: null, change_24h: null, source: 'Indodax', at: now() };
  }
}

async function fetchBtcHistory(env) {
  const d = await getJson('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=idr&days=90&interval=daily', cgHeaders(env));
  const byDay = new Map();
  for (const [t, p] of d.prices || []) byDay.set(witaDate(new Date(t)), Math.round(p));
  return [...byDay].map(([date, close]) => ({ date, close }));
}

async function fetchIhsg() {
  let d, err;
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try { d = await getJson(`https://${host}/v8/finance/chart/%5EJKSE?range=3mo&interval=1d`); break; } catch (e) { err = e; }
  }
  const res = d?.chart?.result?.[0];
  if (!res) throw err || new Error('IHSG: no data');
  const closes = res.indicators?.quote?.[0]?.close || [];
  // Yahoo times are UTC seconds of the session open; +7h gives the Jakarta trading date.
  const jkt = t => new Date(t * 1000 + 7 * 3600e3).toISOString().slice(0, 10);
  const history = (res.timestamp || []).map((t, i) => ({ date: jkt(t), close: closes[i] }))
    .filter(x => x.close != null).map(x => ({ ...x, close: Math.round(x.close * 100) / 100 }));
  const m = res.meta || {};
  const last = m.regularMarketPrice ?? history.at(-1)?.close;
  const lastDate = m.regularMarketTime ? jkt(m.regularMarketTime) : history.at(-1)?.date;
  const prev = history.filter(x => x.date < lastDate).at(-1)?.close ?? null;
  return {
    quote: { last, prev, date: lastDate, change: prev ? last - prev : null, change_pct: prev ? (last - prev) / prev * 100 : null,
      time: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null, source: 'Yahoo Finance', at: now() },
    history,
  };
}

/** { btc, btc_history, ihsg, ihsg_history, errors } with cached values where a fetch failed. `force` skips the cache. */
export async function market(env, { history = false, force = false } = {}) {
  const c = (await getSetting(env, KEY, null)) || {};
  const age = x => (x?.at ? Date.now() - Date.parse(x.at) : Infinity);
  const errors = {};
  let changed = false;
  const jobs = [];
  if (force || age(c.btc) > FRESH) jobs.push(fetchBtc(env).then(v => { c.btc = v; changed = true; }).catch(e => { errors.btc = e.message; }));
  if (force || age(c.ihsg) > FRESH || (history && age(c.ihsg_history) > HIST_FRESH))
    jobs.push(fetchIhsg().then(v => { c.ihsg = v.quote; c.ihsg_history = { at: now(), list: v.history }; changed = true; }).catch(e => { errors.ihsg = e.message; }));
  if (history && (force || age(c.btc_history) > HIST_FRESH))
    jobs.push(fetchBtcHistory(env).then(v => { c.btc_history = { at: now(), list: v }; changed = true; }).catch(e => { errors.btc_history = e.message; }));
  await Promise.all(jobs);
  if (changed) await setSetting(env, KEY, c);
  return { btc: c.btc || null, ihsg: c.ihsg || null, btc_history: c.btc_history?.list || [], ihsg_history: c.ihsg_history?.list || [], errors };
}

/** Keeps today's closes (WITA date) in dompet_prices, so the page has history even if a source changes. */
export async function snapshotPrices(env, m, portoValue) {
  const d = witaDate(), rows = [];
  if (m.btc?.idr) rows.push(['BTCIDR', m.btc.idr]);
  if (m.btc?.usd) rows.push(['BTCUSD', m.btc.usd]);
  if (m.ihsg?.last) rows.push(['IHSG', m.ihsg.last]);
  if (portoValue != null) rows.push(['PORTO', portoValue]);
  if (!rows.length) return;
  await env.DB.batch(rows.map(([s, v]) => env.DB.prepare('INSERT INTO dompet_prices (date, symbol, close) VALUES (?,?,?) ON CONFLICT(date, symbol) DO UPDATE SET close = excluded.close').bind(d, s, v)));
}
