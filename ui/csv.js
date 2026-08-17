/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * csv.js — pure CSV helpers shared by the ETo calculator (raw weather in)
 * and the model tools (an ETo-complete file in). No DOM, Node-testable.
 *
 * The model tools' contract is deliberately small: a run needs only date,
 * precipitation and reference ET. Wind and minimum RH are optional — they
 * feed the FAO-56 Eq. 72 Kc_max term and the Eq. 70 climate adjustment — and
 * when absent they default to the FAO-56 standard climate (u2 = 2 m/s,
 * RHmin = 45 %), which makes those corrections a no-op rather than an error.
 * ETo itself is never computed here; that is the ETo Calculator's job.
 */

import { recordSummary } from '../core/weather.js';
import { toUtcTimestamp } from '../core/dateUtils.js';

/** Columns a water-balance run strictly requires. */
export const MODEL_REQUIRED = ['date', 'prcp', 'eto'];

/**
 * Parses a CSV keeping ALL columns for later re-export. Returns `headers`
 * (original text), `keys` (lowercased), `rows` (numeric objects keyed by the
 * lowercased header; date kept as a string), and `rawRows` (the original
 * cells, aligned with `rows`). Rows are sorted by date. Only `date` required.
 */
export function parseLooseCsv(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length);
  if (lines.length < 2) throw new Error('CSV is empty or has no data rows.');
  const headers = lines[0].split(',').map(h => h.trim());
  const keys = headers.map(h => h.toLowerCase());
  if (!keys.includes('date')) throw new Error('CSV must have a "date" column.');

  const rows = [], rawRows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(c => c.trim());
    if (cells.length !== headers.length) continue;
    const row = {};
    keys.forEach((k, idx) => {
      if (k === 'date') row.date = cells[idx];
      else { const num = parseFloat(cells[idx]); row[k] = cells[idx] === '' || isNaN(num) ? NaN : num; }
    });
    if (!row.date) continue;
    rows.push(row); rawRows.push(cells);
  }
  if (!rows.length) throw new Error('No usable data rows found.');

  const order = rows.map((_, i) => i).sort((a, b) => toUtcTimestamp(rows[a].date) - toUtcTimestamp(rows[b].date));
  return { headers, keys, rows: order.map(i => rows[i]), rawRows: order.map(i => rawRows[i]) };
}

/** Linear fill of interior NaN gaps in df[*][key]; never extrapolates. */
function fillInteriorLinear(df, key) {
  const idx = [];
  for (let i = 0; i < df.length; i++) if (isFinite(df[i][key])) idx.push(i);
  if (idx.length < 2) return;
  for (let k = 0; k < idx.length - 1; k++) {
    const a = idx[k], b = idx[k + 1];
    for (let j = a + 1; j < b; j++) {
      const f = (j - a) / (b - a);
      df[j][key] = df[a][key] + f * (df[b][key] - df[a][key]);
    }
  }
}

/**
 * Loads an ETo-complete weather file for the model tools. Maps `eto` → `ETo`,
 * injects the FAO-56 standard climate where wind / RHmin are absent, fills
 * interior ETo gaps (no extrapolation), and returns an engine-ready daily
 * array plus the standard summary and which corrections are supported.
 *
 * @returns {{df, summary, hasWspd, hasRmin}}
 */
export function loadModelWeather(text) {
  const parsed = parseLooseCsv(text);
  const rows = parsed.rows.map(r => ({ ...r }));
  const hasWspd = parsed.keys.includes('wspd') && rows.some(r => isFinite(r.wspd));
  const hasRmin = parsed.keys.includes('rmin') && rows.some(r => isFinite(r.rmin));

  rows.forEach(r => {
    if (r.ETo === undefined) r.ETo = isFinite(r.eto) ? r.eto : NaN;
    if (isFinite(r.ETo)) r.ETo = Math.max(r.ETo, 0);
    if (!hasWspd) r.wspd = 2.0;   /* FAO-56 standard climate */
    if (!hasRmin) r.rmin = 45.0;
    if (!('prcp' in r) || isNaN(r.prcp)) r.prcp = 0.0;
    if ('rmin' in r && isFinite(r.rmin)) r.rmin = Math.min(Math.max(r.rmin, 0), 100);
    if ('wspd' in r && isFinite(r.wspd)) r.wspd = Math.max(r.wspd, 0);
  });
  fillInteriorLinear(rows, 'ETo');
  if (hasWspd) fillInteriorLinear(rows, 'wspd');
  if (hasRmin) fillInteriorLinear(rows, 'rmin');

  return { df: rows, summary: recordSummary(rows), hasWspd, hasRmin };
}
