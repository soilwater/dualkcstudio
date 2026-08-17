/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * modes/probabilistic/orchestration.js — ensemble run logic for the
 * Probabilistic & Scenario mode: which years to run and what weather
 * window each member gets. Pure data-in/data-out (no DOM). Physics stays
 * in core/engine.js; the caller supplies a weather record whose rows
 * already have ETo.
 *
 * A "member" is one engine run:
 *   { year, rows, balance, warnings, yieldEst }
 * where `rows` is runModel's daily output with a 1-based `dap` added and
 * `yieldEst` is the FAO-33 water-limited estimate (null when the crop has
 * no Ymax defined).
 */

import { runModel, estimateYield, parseUtcParts, toUtcTimestamp } from '../../core/index.js';
import { sliceWeatherWindow } from '../../core/weather.js';
import { addDaysISO, cumsum } from '../../ui/format.js';

const DAY_MS = 86400000;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function yearsIn(df) {
  return Array.from(new Set(df.map(r => parseUtcParts(r.date).year))).sort((a, b) => a - b);
}

function runMember(year, windowDf, soil, crop, management, options) {
  const { df, balance, warnings } = runModel(soil, crop, management, windowDf, options);
  df.forEach((r, i) => { r.dap = i + 1; });
  return { year, rows: df, balance, warnings, yieldEst: estimateYield(df, crop) };
}

/**
 * One engine run per calendar year in the record, all planted on the same
 * month-day. Years whose weather window is incomplete are skipped.
 *
 * @param {object} p
 * @param {object[]} p.df           daily weather rows, ETo present
 * @param {string} p.plantMonthDay  reference planting date as 'MM-DD'
 * @param {number} p.seasonLen      days per member run
 * @returns {{members: object[], skippedYears: number[]}}
 */
export function runProbabilistic({ df, plantMonthDay, seasonLen, soil, crop, management, options }) {
  const members = [];
  const skippedYears = [];
  for (const yr of yearsIn(df)) {
    try {
      const windowDf = sliceWeatherWindow(df, `${yr}-${plantMonthDay}`, seasonLen);
      members.push(runMember(yr, windowDf, soil, crop, management, options));
    } catch {
      skippedYears.push(yr);
    }
  }
  return { members, skippedYears };
}

/* ── Analog-year similarity ────────────────────────────────────────────── */

/**
 * Similarity of a candidate year's cumulative curve to the reference
 * year's, over the observed window. Higher is more similar for every
 * method, so one descending sort ranks them all.
 */
function analogScore(ref, cand, method) {
  const idx = [];
  for (let i = 0; i < ref.length; i++) {
    if (isFinite(ref[i]) && isFinite(cand[i])) idx.push(i);
  }
  if (idx.length < 2) return -Infinity;
  const r = idx.map(i => ref[i]);
  const c = idx.map(i => cand[i]);

  if (method === 'cumulative') {
    let sumAbs = 0;
    for (let i = 0; i < r.length; i++) sumAbs += Math.abs(r[i] - c[i]);
    return -(sumAbs / r.length);
  }
  if (method === 'pearson') {
    const meanR = r.reduce((a, b) => a + b, 0) / r.length;
    const meanC = c.reduce((a, b) => a + b, 0) / c.length;
    let num = 0, denR = 0, denC = 0;
    for (let i = 0; i < r.length; i++) {
      const dR = r[i] - meanR, dC = c[i] - meanC;
      num += dR * dC; denR += dR * dR; denC += dC * dC;
    }
    if (denR < 1e-10 || denC < 1e-10) return -Infinity;
    return num / (Math.sqrt(denR) * Math.sqrt(denC));
  }
  if (method === 'cosine') {
    let dot = 0, normR = 0, normC = 0;
    for (let i = 0; i < r.length; i++) {
      dot += r[i] * c[i]; normR += r[i] * r[i]; normC += c[i] * c[i];
    }
    if (normR < 1e-10 || normC < 1e-10) return -Infinity;
    return dot / (Math.sqrt(normR) * Math.sqrt(normC));
  }
  if (method === 'nse') {
    const meanR = r.reduce((a, b) => a + b, 0) / r.length;
    let ssRes = 0, ssTot = 0;
    for (let i = 0; i < r.length; i++) {
      ssRes += (r[i] - c[i]) ** 2;
      ssTot += (r[i] - meanR) ** 2;
    }
    if (ssTot < 1e-10) return -Infinity;
    return 1.0 - ssRes / ssTot;
  }
  return -Infinity;
}

/**
 * Ranks every candidate year by how closely its cumulative ETo or
 * precipitation curve over the observed window matches the reference
 * year's. Returns the FULL ranking, best first — callers slice the top N.
 *
 * @param {object} p
 * @param {object[]} p.df        daily weather rows, ETo present
 * @param {string} p.plantingDate reference planting date, YYYY-MM-DD
 * @param {number} p.nObs        observed-window length, days
 * @param {string} p.analogVar   'eto' | 'prcp'
 * @param {string} p.method      'cumulative' | 'pearson' | 'cosine' | 'nse'
 * @param {?number} p.excludeYear extra year to leave out (besides the reference)
 * @returns {{year: number, score: number}[]}
 */
export function selectAnalogYears({ df, plantingDate, nObs, analogVar = 'prcp', method = 'nse', excludeYear = null }) {
  const col = analogVar === 'eto' ? 'ETo' : 'prcp';
  const { year: refY, monthIndex, day } = parseUtcParts(plantingDate);
  const monthDay = `${pad2(monthIndex + 1)}-${pad2(day)}`;

  const windows = new Map();
  for (const yr of yearsIn(df)) {
    try {
      const sub = sliceWeatherWindow(df, `${yr}-${monthDay}`, nObs);
      if (sub.every(r => isFinite(r[col]))) windows.set(yr, cumsum(sub.map(r => r[col])));
    } catch {
      /* incomplete window for this year — not a candidate */
    }
  }

  const ref = windows.get(refY);
  if (!ref) throw new Error(`No complete ${nObs}-day observed window for reference year ${refY}.`);

  const ranking = [];
  for (const [yr, vals] of windows) {
    if (yr === refY || yr === excludeYear) continue;
    ranking.push({ year: yr, score: analogScore(ref, vals, method) });
  }
  ranking.sort((a, b) => b.score - a.score);
  return ranking;
}

/**
 * Observed-to-date scenario: the weather from planting to the cutoff is
 * taken as-is, then each donor year contributes its continuation of the
 * season (same calendar window, re-dated to follow the observed days) and
 * the full stitched season runs through the engine.
 *
 * @param {object} p
 * @param {object[]} p.df          daily weather rows, ETo present
 * @param {string} p.plantingDate  YYYY-MM-DD, in the record
 * @param {string} [p.cutoffDate]  last observed day, YYYY-MM-DD (or give nObs)
 * @param {number} [p.nObs]        observed-window length, days (overrides cutoffDate)
 * @param {number} p.seasonLen     total season length, days
 * @param {string} p.scenarioType  'all_years' | 'analog'
 * @returns {{members: object[], skippedYears: number[], nObs: number,
 *            ranking: ?{year: number, score: number}[]}}
 */
export function runScenario({
  df, plantingDate, cutoffDate, nObs, seasonLen, soil, crop, management, options,
  scenarioType = 'all_years', nAnalogs = 5, analogMethod = 'nse', analogVar = 'eto',
}) {
  if (!isFinite(nObs)) {
    if (!cutoffDate) throw new Error('Give either a cutoff date or nObs.');
    nObs = Math.round((toUtcTimestamp(cutoffDate) - toUtcTimestamp(plantingDate)) / DAY_MS) + 1;
  }
  nObs = Math.min(Math.max(Math.round(nObs), 1), seasonLen);

  const { year: refY, monthIndex, day } = parseUtcParts(plantingDate);
  const monthDay = `${pad2(monthIndex + 1)}-${pad2(day)}`;
  const obs = sliceWeatherWindow(df, plantingDate, nObs);

  /* Season fully observed — a single deterministic member. */
  if (seasonLen - nObs <= 0) {
    return {
      members: [runMember(refY, obs, soil, crop, management, options)],
      skippedYears: [], nObs, ranking: null,
    };
  }

  let ranking = null;
  let donorYears = yearsIn(df).filter(y => y !== refY);
  if (scenarioType === 'analog') {
    ranking = selectAnalogYears({ df, plantingDate, nObs, analogVar, method: analogMethod, excludeYear: refY });
    donorYears = ranking.slice(0, nAnalogs).map(a => a.year);
  }

  const lastObsDate = obs[obs.length - 1].date;
  const members = [];
  const skippedYears = [];
  for (const yr of donorYears) {
    try {
      const donorWindow = sliceWeatherWindow(df, `${yr}-${monthDay}`, seasonLen);
      const continuation = donorWindow.slice(nObs)
        .map((r, i) => ({ ...r, date: addDaysISO(lastObsDate, i + 1) }));
      members.push(runMember(yr, [...obs, ...continuation], soil, crop, management, options));
    } catch {
      skippedYears.push(yr);
    }
  }
  return { members, skippedYears, nObs, ranking };
}
