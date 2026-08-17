/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * weather.js — Data loading, CSV parsing, gap-filling, and date-window
 * slicing. Every tool goes through this before calling engine.js:
 * engine.js requires an exact, ETo-complete daily window and does no
 * date arithmetic or interpolation of its own.
 */

import { toUtcTimestamp } from './dateUtils.js';

export const REQUIRED_COLS = ['date', 'tmin', 'tmax', 'rmin', 'rmax', 'srad', 'wspd', 'prcp'];
export const INTERP_VARS = ['tmin', 'tmax', 'rmin', 'rmax', 'srad', 'wspd'];
export const MISSING_WARN_FRAC = 0.05;
export const MIN_YEARS_FOR_SCENARIO = 10;

/**
 * Parses raw CSV string into a structured weather array.
 */
export function loadCsvContent(csvText) {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) throw new Error("CSV file is empty or missing data rows.");

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

  const missingCols = REQUIRED_COLS.filter(c => !headers.includes(c));
  if (missingCols.length > 0) {
    throw new Error(`Weather CSV is missing required column(s): [${missingCols.join(', ')}].`);
  }

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    if (values.length !== headers.length) continue;

    const row = {};
    headers.forEach((h, idx) => {
      const val = values[idx];
      if (h === 'date') {
        row.date = val;
      } else {
        const num = parseFloat(val);
        row[h] = isNaN(num) ? NaN : num;
      }
    });

    if (row.eto !== undefined && row.ETo === undefined) row.ETo = row.eto;
    records.push(row);
  }

  records.sort((a, b) => new Date(a.date) - new Date(b.date));

  return { df: records, summary: recordSummary(records) };
}

/**
 * PCHIP Interpolation (Monotone Cubic Hermite) for 1D arrays
 */
function pchipInterpolateArray(y) {
  const n = y.length;
  const result = [...y];

  const knownIndices = [];
  for (let i = 0; i < n; i++) {
    if (!isNaN(y[i])) knownIndices.push(i);
  }

  if (knownIndices.length < 2) return result;

  const first = knownIndices[0];
  const last = knownIndices[knownIndices.length - 1];

  const m = knownIndices.length;
  const xK = knownIndices;
  const yK = knownIndices.map(i => y[i]);

  const h = [];
  const delta = [];
  for (let i = 0; i < m - 1; i++) {
    h[i] = xK[i + 1] - xK[i];
    delta[i] = (yK[i + 1] - yK[i]) / h[i];
  }

  const d = new Array(m).fill(0);

  for (let i = 1; i < m - 1; i++) {
    if (delta[i - 1] * delta[i] > 0) {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      d[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
    } else {
      d[i] = 0;
    }
  }

  // Endpoints
  d[0] = ((2 * h[0] + h[1]) * delta[0] - h[0] * delta[1]) / (h[0] + h[1]);
  if (d[0] * delta[0] <= 0) d[0] = 0;
  else if (delta[0] * delta[1] < 0 && Math.abs(d[0]) > 3 * Math.abs(delta[0])) d[0] = 3 * delta[0];

  d[m - 1] = ((2 * h[m - 2] + h[m - 3]) * delta[m - 2] - h[m - 2] * delta[m - 3]) / (h[m - 2] + h[m - 3]);
  if (d[m - 1] * delta[m - 2] <= 0) d[m - 1] = 0;
  else if (delta[m - 2] * delta[m - 3] < 0 && Math.abs(d[m - 1]) > 3 * Math.abs(delta[m - 2])) d[m - 1] = 3 * delta[m - 2];

  // Evaluate inside limits
  for (let k = first; k <= last; k++) {
    if (isNaN(result[k])) {
      let idx = 0;
      while (idx < m - 1 && xK[idx + 1] < k) idx++;

      const t = (k - xK[idx]) / h[idx];
      const h00 = (1 + 2 * t) * Math.pow(1 - t, 2);
      const h10 = t * Math.pow(1 - t, 2);
      const h01 = Math.pow(t, 2) * (3 - 2 * t);
      const h11 = Math.pow(t, 2) * (t - 1);

      result[k] = h00 * yK[idx] + h10 * h[idx] * d[idx] + h01 * yK[idx + 1] + h11 * h[idx] * d[idx + 1];
    }
  }

  return result;
}

function linearInterpolateArray(y) {
  const n = y.length;
  const result = [...y];
  const known = [];
  for (let i = 0; i < n; i++) if (!isNaN(y[i])) known.push(i);
  if (known.length < 2) return result;

  const first = known[0];
  const last = known[known.length - 1];

  for (let i = first; i <= last; i++) {
    if (isNaN(result[i])) {
      let prev = i - 1;
      while (isNaN(result[prev])) prev--;
      let next = i + 1;
      while (isNaN(result[next])) next++;

      const frac = (i - prev) / (next - prev);
      result[i] = result[prev] + frac * (result[next] - result[prev]);
    }
  }
  return result;
}

export function preprocess(dfRaw, interpConfig = {}) {
  const df = dfRaw.map(r => ({ ...r }));
  const warnings = [];
  const n = Math.max(df.length, 1);

  const varsHere = INTERP_VARS.filter(c => c in df[0]);
  if ('vpd' in df[0]) varsHere.push('vpd');

  varsHere.forEach(col => {
    const missingCount = df.filter(r => isNaN(r[col])).length;
    if (missingCount === 0) return;

    const frac = missingCount / n;
    const cfg = interpConfig[col] || {};
    const method = cfg.method || 'pchip';

    if (method === 'constant') {
      const val = cfg.value;
      if (val === undefined || isNaN(val)) {
        warnings.push(`${col}: 'constant' selected but no value given — ${missingCount} day(s) left unfilled.`);
      } else {
        df.forEach(r => { if (isNaN(r[col])) r[col] = Number(val); });
      }
    } else {
      const colValues = df.map(r => r[col]);
      const filled = (method === 'linear') ? linearInterpolateArray(colValues) : pchipInterpolateArray(colValues);
      df.forEach((r, idx) => r[col] = filled[idx]);
    }

    if (frac > MISSING_WARN_FRAC) {
      warnings.push(`${col}: ${missingCount} of ${df.length} days missing (${(frac * 100).toFixed(1)}%), filled by ${method}.`);
    }

    const remain = df.filter(r => isNaN(r[col])).length;
    if (remain > 0 && (method === 'pchip' || method === 'linear')) {
      warnings.push(`${col}: ${remain} edge day(s) left unfilled — ${method} does not extrapolate beyond known values.`);
    }
  });

  // kcb_obs: an optional, sparse, user-supplied override of the tabulated
  // Kcb curve (see cropSettings.js / engine.js). Interpolated the same
  // "no extrapolation beyond known values" way as the required weather
  // columns above, just linear rather than PCHIP (a handful of sparse
  // field observations doesn't usually justify PCHIP's extra curvature
  // assumptions) and with no missing-data warning (it's optional, so
  // sparse/absent is expected, not a data quality problem).
  if ('kcb_obs' in df[0]) {
    const missingCount = df.filter(r => isNaN(r.kcb_obs)).length;
    if (missingCount > 0 && missingCount < df.length) {
      const filled = linearInterpolateArray(df.map(r => r.kcb_obs));
      df.forEach((r, idx) => { r.kcb_obs = filled[idx]; });
    }
  }

  df.forEach(r => {
    ['prcp', 'irrig'].forEach(col => {
      if (col in r) r[col] = isNaN(r[col]) ? 0.0 : r[col];
    });

    if ('kcb_obs' in r && !isNaN(r['kcb_obs'])) r['kcb_obs'] = Math.max(r['kcb_obs'], 0.0);

    ['rmin', 'rmax'].forEach(col => {
      if (col in r && !isNaN(r[col])) r[col] = Math.min(Math.max(r[col], 0), 100);
    });

    ['wspd', 'prcp', 'srad', 'ETo'].forEach(col => {
      if (col in r && !isNaN(r[col])) r[col] = Math.max(r[col], 0);
    });
  });

  return { df, warnings };
}

/**
 * Slices `numDays` consecutive daily records starting at startDateStr
 * (inclusive, matched by UTC calendar date) out of weatherDf. This is the
 * date-window logic every tool needs before calling engine.js — engine.js
 * itself does no date filtering, so a caller can't accidentally hand it a
 * window that silently starts or ends on the wrong day.
 *
 * @param {object[]} weatherDf daily records, each with a `date` field
 * @param {string} startDateStr window start, YYYY-MM-DD
 * @param {number} numDays window length, days
 * @returns {object[]} exactly `numDays` records
 * @throws if weatherDf doesn't fully cover the requested window
 */
export function sliceWeatherWindow(weatherDf, startDateStr, numDays) {
  const startUtc = toUtcTimestamp(startDateStr);
  const endUtc = startUtc + (numDays - 1) * 86400000;

  const window = weatherDf.filter(r => {
    const t = toUtcTimestamp(r.date);
    return t >= startUtc && t <= endUtc;
  });

  if (window.length < numDays) {
    throw new Error(
      `Weather data covers only ${window.length} of the ${numDays} day(s) needed starting ${startDateStr}.`
    );
  }
  return window.slice(0, numDays);
}

function missingReport(df) {
  const n = Math.max(df.length, 1);
  const report = {};
  const cols = INTERP_VARS.filter(c => c in df[0]);
  if ('vpd' in df[0]) cols.push('vpd');

  cols.forEach(col => {
    const k = df.filter(r => isNaN(r[col])).length;
    if (k > 0) report[col] = { n: k, frac: k / n };
  });
  return report;
}

export function recordSummary(df) {
  const years = Array.from(new Set(df.map(r => new Date(r.date).getFullYear()))).sort((a, b) => a - b);
  return {
    n_days: df.length,
    n_years: years.length,
    years,
    date_min: df[0]?.date,
    date_max: df[df.length - 1]?.date,
    has_eto: 'ETo' in df[0],
    has_kcb_obs: df.some(r => !isNaN(r.kcb_obs)),
    enough_for_scenario: years.length >= MIN_YEARS_FOR_SCENARIO,
    missing: missingReport(df),
    warn_frac: MISSING_WARN_FRAC
  };
}
