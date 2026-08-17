/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * modes/gee-collector/gee.js — pure transforms for the GEE data collector. No
 * DOM, no Earth Engine calls: it takes the raw arrays that `getRegion().getInfo()`
 * returns and turns them into a ready-to-use CSV. Node-testable with mock arrays,
 * which is what lets the awkward, un-testable auth/fetch layer stay thin.
 *
 * Column mapping is the whole point — GRIDMET's names become the engine's:
 *   pr → prcp,  eto → eto,  rmin → rmin,  vs → wspd (10 m → 2 m, FAO-56).
 * A vegetation index (NDVI or EVI) is linearly rescaled between a soil and a
 * full-cover endpoint and written to `kcb_obs`, which the engine interpolates.
 */

/* FAO-56 Eq. 47: wind at 2 m from wind at 10 m (GRIDMET `vs` is 10 m). */
const U10_TO_U2 = 4.87 / Math.log(67.8 * 10 - 5.42);   /* ≈ 0.748 */
const VI_SCALE = 0.0001;   /* MODIS NDVI/EVI are stored ×10000 */

function num(v) { return v == null || v === '' || Number.isNaN(+v) ? NaN : +v; }
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/**
 * `getRegion().getInfo()` returns [[header…], [id, lon, lat, time_ms, …bands]].
 * Turns it into row objects keyed by the header, with an added UTC `date`.
 */
export function regionArrayToRows(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return [];
  const header = arr[0];
  const ti = header.indexOf('time');
  return arr.slice(1).map(r => {
    const o = {};
    header.forEach((h, i) => { o[h] = r[i]; });
    if (ti >= 0 && o.time != null) o.date = new Date(o.time).toISOString().slice(0, 10);
    return o;
  });
}

/** GRIDMET rows → app weather rows (renamed columns, wind to 2 m). */
export function gridmetToWeather(rows) {
  const out = rows.filter(r => r.date).map(r => ({
    date: r.date,
    prcp: num(r.pr),
    eto: num(r.eto),
    rmin: num(r.rmin),
    wspd: Number.isNaN(num(r.vs)) ? NaN : +(num(r.vs) * U10_TO_U2).toFixed(2),
  }));
  out.sort(byDate);
  return out;
}

/**
 * MODIS 16-day VI rows (MOD13Q1 ∪ MYD13Q1) → clear-sky NDVI/EVI. Keeps only
 * pixels whose SummaryQA is good/marginal (≤ qaMax) so the point is cloud-free,
 * and applies the 0.0001 scale. De-duplicates by date (Terra/Aqua overlap),
 * preferring the better QA.
 */
export function modisToVi(rows, { qaMax = 1 } = {}) {
  const kept = rows.filter(r => r.date && r.NDVI != null && (r.SummaryQA == null || num(r.SummaryQA) <= qaMax));
  const byDay = new Map();
  for (const r of kept) {
    const rec = { date: r.date, ndvi: +(num(r.NDVI) * VI_SCALE).toFixed(4), evi: r.EVI == null ? NaN : +(num(r.EVI) * VI_SCALE).toFixed(4), qa: num(r.SummaryQA) };
    const prev = byDay.get(r.date);
    if (!prev || (isFinite(rec.qa) && rec.qa < prev.qa)) byDay.set(r.date, rec);
  }
  const out = [...byDay.values()];
  out.sort(byDate);
  return out;
}

/** Linear rescale to [0,1] between `lo` (soil) and `hi` (full cover), clamped. */
export function rescaleClamped(v, lo, hi) {
  if (!isFinite(v) || !(hi > lo)) return NaN;
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}

function fmtN(v, d = 2) { return isFinite(v) ? (+v).toFixed(d) : ''; }
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Fills a daily Kcb series from sparse observations at given day-indices.
 * Interior gaps are linear; beyond the ends, `extrap` is either 'constant'
 * (hold the first / last value) or 'linear' (continue the end segment's
 * slope). Result clamped to [0,1]. A single observation is held everywhere.
 */
function fillDailyKcb(n, pts, extrap) {
  const out = new Array(n).fill(NaN);
  if (!pts.length) return out;
  if (pts.length === 1) { out.fill(clamp01(pts[0].v)); return out; }
  for (const p of pts) out[p.i] = p.v;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    for (let i = a.i + 1; i < b.i; i++) out[i] = a.v + (b.v - a.v) * (i - a.i) / (b.i - a.i);
  }
  const [f0, f1] = [pts[0], pts[1]];
  for (let i = 0; i < f0.i; i++) out[i] = extrap === 'linear' ? f0.v + (f1.v - f0.v) / (f1.i - f0.i) * (i - f0.i) : f0.v;
  const [l1, l0] = [pts[pts.length - 2], pts[pts.length - 1]];
  for (let i = l0.i + 1; i < n; i++) out[i] = extrap === 'linear' ? l0.v + (l0.v - l1.v) / (l0.i - l1.i) * (i - l0.i) : l0.v;
  return out.map(v => (isFinite(v) ? +clamp01(v).toFixed(3) : NaN));
}

/**
 * The daily kcb_obs series for a run: the chosen index rescaled at each clear
 * observation, optionally interpolated to every day. Returns the per-day
 * array (aligned with `weather`), the clear observation points (for plotting),
 * and their count.
 */
export function kcbSeries(weather, vi, { index = 'ndvi', soil, veg, interpolate = false, extrap = 'constant' } = {}) {
  const obs = vi.map(v => ({ date: v.date, value: rescaleClamped(v[index], soil, veg) })).filter(o => isFinite(o.value));
  const idxOf = new Map(weather.map((w, i) => [w.date, i]));
  let daily;
  if (interpolate) {
    const pts = obs.map(o => ({ i: idxOf.get(o.date), v: o.value })).filter(p => p.i != null).sort((a, b) => a.i - b.i);
    daily = fillDailyKcb(weather.length, pts, extrap);
  } else {
    const m = new Map(obs.map(o => [o.date, +o.value.toFixed(3)]));
    daily = weather.map(w => (m.has(w.date) ? m.get(w.date) : NaN));
  }
  return { daily, obs, nObs: obs.length };
}

/**
 * Merges daily weather with the vegetation index into one ready-to-use CSV. Columns
 * are exactly the ones the model tools recognise; `kcb_obs` is sparse (only on
 * clear-observation days) or daily (interpolated), per options.
 */
export function assembleCsv(weather, vi, opts = {}) {
  const { daily, nObs } = kcbSeries(weather, vi, opts);
  const cols = ['date', 'prcp', 'eto', 'rmin', 'wspd', 'kcb_obs'];
  const lines = [cols.join(',')];
  weather.forEach((w, i) => lines.push([w.date, fmtN(w.prcp, 2), fmtN(w.eto, 2), fmtN(w.rmin, 1), fmtN(w.wspd, 2), isFinite(daily[i]) ? daily[i] : ''].join(',')));
  return { csv: lines.join('\n') + '\n', nDays: weather.length, nVi: nObs };
}
