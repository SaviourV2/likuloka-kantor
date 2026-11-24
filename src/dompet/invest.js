// Daily interest on Kevin's investments. Interest accrues per calendar day from start_date up to today
// (or the maturity / withdrawal date, whichever comes first), with the yearly rate split over 365 days.
//   simple   value = P × (1 + r × d/365)               deposito, SBN coupons paid out, P2P
//   daily    value = P × (1 + r/365)^d                  reksa dana pasar uang, bank digital savings
//   monthly  value = P × (1 + r/12)^(d / 30.4375)      deposito ARO (rolled over monthly)
// Tax (tax_pct, e.g. 20 for deposito) is taken off the interest, so the numbers shown are net.
const DAY = 864e5;
export const daysBetween = (a, b) => Math.max(0, Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY));
export const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

/** Gross interest earned after d days. */
function grossInterest(inv, d) {
  const P = inv.principal, r = (Number(inv.rate_pa) || 0) / 100;
  if (inv.compounding === 'daily') return P * (Math.pow(1 + r / 365, d) - 1);
  if (inv.compounding === 'monthly') return P * (Math.pow(1 + r / 12, d / 30.4375) - 1);
  return P * r * d / 365;
}

/** One investment as of `today`: days running, net interest so far, today's interest, value, and a 30-day projection. */
export function investNow(inv, today) {
  const stops = [inv.end_date, inv.closed_at?.slice(0, 10)].filter(Boolean).sort();
  const last = stops[0] && stops[0] < today ? stops[0] : today;
  const net = 1 - (Number(inv.tax_pct) || 0) / 100;
  const days = inv.start_date > last ? 0 : daysBetween(inv.start_date, last);
  const earned = grossInterest(inv, days) * net;
  const running = inv.start_date <= today && last === today && !inv.closed_at;
  const today_interest = running && days > 0 ? earned - grossInterest(inv, days - 1) * net : 0;
  const next30 = running ? grossInterest(inv, days + 30) * net - earned : 0;
  return {
    ...inv, days, earned: Math.round(earned), today_interest, value: Math.round(inv.principal + earned),
    next30: Math.round(next30), running, matured: !!inv.end_date && inv.end_date <= today && !inv.closed_at,
    days_left: inv.end_date && inv.end_date > today ? daysBetween(today, inv.end_date) : null,
  };
}

/** All investments plus totals (running ones only for today's interest). */
export function investSummary(rows, today) {
  const list = rows.map(r => investNow(r, today));
  const open = list.filter(x => !x.closed_at);
  const sum = (arr, k) => arr.reduce((s, x) => s + x[k], 0);
  return {
    list,
    principal: sum(open, 'principal'), earned: sum(open, 'earned'), value: sum(open, 'value'),
    today: sum(open, 'today_interest'), next30: sum(open, 'next30'),
    // Weighted net yield of what is running now, % per year.
    yield_pa: open.length ? open.filter(x => x.running).reduce((s, x) => s + x.principal * x.rate_pa * (1 - (x.tax_pct || 0) / 100), 0) / Math.max(1, sum(open.filter(x => x.running), 'principal')) : 0,
  };
}
