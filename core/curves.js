/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * curves.js — Pure series builders. No engine state, no options object,
 * no water balance. Everything here turns crop parameters (plus, in one
 * case, climate statistics) into a daily array or a single value.
 *
 * These exist so that a caller building a rotation can produce exactly the
 * same series engine.js would produce internally, stitch several of them
 * together, and hand the result back as `crop.Kcb` / `crop.Zr` / `crop.h` /
 * `crop.fc`. Anything the engine can generate, a caller can generate too —
 * that symmetry is what keeps the rotation path from being a second,
 * less-tested code path.
 *
 * Nothing here rounds. Kcb, Zr and h are state variables that feed the
 * water balance; rounding them would make it impossible to reproduce a
 * published FAO-56 worked example digit for digit. Round at presentation.
 */

// Scalar-or-array access, shared by the functions below.
function at(v, i) { return Array.isArray(v) ? v[i] : v; }

// Linear interpolation over stage breakpoints.
function interpLinear(x, xs, ys) {
  let last = xs.length - 1;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[last]) return ys[last];
  let i = 0;
  while (i < last && xs[i + 1] < x) i++;
  let span = xs[i + 1] - xs[i];
  let t = span !== 0 ? (x - xs[i]) / span : 0;
  return ys[i] + t * (ys[i + 1] - ys[i]);
}

function stageBreakpoints(crop) {
  let a = crop.L_ini;
  let b = a + crop.L_dev;
  let c = b + crop.L_mid;
  let d = c + crop.L_late;
  return [0, a, b, c, d];
}

// ── Kcb curves (FAO-56 Fig. 36) ────────────────────────────────────────────

/**
 * The literal FAO-56 Fig. 36 basal crop coefficient curve: flat at Kcb_ini
 * through the whole initial stage, linear rise through development, flat at
 * Kcb_mid through mid-season, linear decline to Kcb_end.
 */
export function kcbFlat(dayIdx, crop) {
  return interpLinear(dayIdx, stageBreakpoints(crop),
    [crop.Kcb_ini, crop.Kcb_ini, crop.Kcb_mid, crop.Kcb_mid, crop.Kcb_end]);
}

/**
 * Variant: Kcb rises linearly from 0 at planting to Kcb_ini at the end of
 * the initial stage, with no flat emergence sub-period.
 *
 * Rationale: Kcb is meant to be transpiration, and there is no canopy on
 * the day of planting. FAO-56's flat Kcb_ini lumps a small residual soil
 * evaporation into the basal coefficient. Charging that to Kcb puts it in
 * the root zone; charging it to Ke puts it in the surface layer, where it
 * belongs. Total ETc barely moves (the Ke ceiling Kr*(Kc_max - Kcb) rises
 * as Kcb falls) but the E/T split and the compartment drained both improve.
 */
export function kcbRampFromZero(dayIdx, crop) {
  return interpLinear(dayIdx, stageBreakpoints(crop),
    [0.0, crop.Kcb_ini, crop.Kcb_mid, crop.Kcb_mid, crop.Kcb_end]);
}

export function resolveKcbFn(options) {
  return options.kcbStartsAtZero ? kcbRampFromZero : kcbFlat;
}

/** Daily Kcb array for a single crop cycle of N days. */
export function kcbArray(N, crop, options = {}) {
  let fn = resolveKcbFn(options);
  let out = new Array(N);
  for (let i = 0; i < N; i++) out[i] = fn(i, crop);
  return out;
}

// ── Root depth (FAO-56 Ch. 8, standard linear root growth) ─────────────────

/**
 * Linear growth from Zr_ini to Zr_max over (L_ini + L_dev) days, constant
 * at Zr_max thereafter.
 */
export function rootDepthArray(N, crop) {
  let Zr_ini = crop.Zr_ini !== undefined ? crop.Zr_ini : 0.1;
  let Zr_max = crop.Zr_max;
  let growthDays = crop.L_ini + crop.L_dev;
  let out = new Array(N);
  for (let i = 0; i < N; i++) {
    out[i] = (growthDays > 0 && i < growthDays) ? Zr_ini + (Zr_max - Zr_ini) * i / growthDays : Zr_max;
  }
  return out;
}

// ── Canopy height (input to FAO-56 Eq. 72 and Eq. 76) ──────────────────────

/**
 * FAO-56 takes mean plant height h as a measured input. When it isn't
 * supplied, derive it from the Kcb series.
 *
 *   h = h_max * (Kcb_peak - Kc_min) / (Kcb_full - Kc_min),  clamped to [0, h_max]
 *
 * Two properties matter here:
 *
 *  - `Kcb_peak` is the running maximum of Kcb, not Kcb itself, so height
 *    does NOT fall when Kcb declines through senescence. A wheat canopy
 *    that has stopped transpiring is still 1 m tall, and Eq. 72's Kc_max
 *    and Eq. 76's exponent both care about the standing canopy.
 *  - The running maximum RESETS whenever Kcb drops to or below Kc_min,
 *    i.e. whenever there is no crop. That is what makes a stitched
 *    crop -> fallow -> crop series work: the fallow zeroes the canopy and
 *    the next crop starts from bare ground, with no special-casing.
 *
 * `Kcb_full` is the Kcb at which the canopy reaches h_max, normally
 * Kcb_mid. It and h_max may each be a scalar or a per-day array (the
 * rotation case, where each stage has its own crop).
 */
export function canopyHeightArray(KcbArr, { h_max, Kcb_full, Kc_min = 0.15 }) {
  let out = new Array(KcbArr.length);
  let peak = 0;
  for (let i = 0; i < KcbArr.length; i++) {
    let kcMin = at(Kc_min, i);
    let kcb = KcbArr[i];
    if (kcb <= kcMin) peak = 0;
    else peak = Math.max(peak, kcb);
    let hMax = at(h_max, i) || 0;
    let kcbFull = at(Kcb_full, i);
    let span = kcbFull - kcMin;
    let frac = span > 1e-9 ? (peak - kcMin) / span : 0;
    out[i] = hMax * Math.min(Math.max(frac, 0), 1);
  }
  return out;
}

// ── Fraction of soil covered by vegetation, fc (FAO-56 Eq. 76) ─────────────

/**
 * FAO-56 Eq. 76:
 *
 *      fc = [ (Kcb - Kc_min) / (Kc_max - Kc_min) ] ^ (1 + 0.5 h)
 *
 * limited to 0 .. fc_max (the manual caps at 0.99).
 *
 * `model` selects the exponent:
 *   'height' — the manual's 1 + 0.5h, using the day's canopy height.
 *   'kcb'    — exponent fixed at 1, i.e. fc is a straight rescaling of Kcb
 *              onto [0, 1] between bare soil and full cover. This is Eq. 76
 *              with the height term switched off (1 + 0.5h -> 1 as h -> 0),
 *              for callers who have no height information and would rather
 *              not invent one.
 *
 * Note the two models bracket each other: 'kcb' always returns a value at
 * or above 'height', since the base is <= 1 and a larger exponent shrinks it.
 *
 * 'kcb' isn't just a fallback for missing height data — for row crops it has
 * direct field support. Trout & DeJonge (2018, J. Irrig. Drain. Eng. 144(6))
 * measured six seasons of maize at Greeley, CO and fit Kcb = 1.10 fc + 0.17
 * (fc <= 0.8, R^2 = 0.91), i.e. a straight line, not the convex curve Eq. 76
 * predicts at maize height (h ~ 2m gives exponent 2, so fc = base^2). Their
 * conclusion: "linearly related to fractional canopy ground cover... a
 * better option than regionally specific Kcb relationships." Caveats: one
 * crop, one semi-arid Great Plains site, and their fitted line's own
 * intercept (0.17) doesn't match either model's forced fc=0 at Kcb=Kc_min —
 * a calibrated caller is still better off passing crop.fc directly. But it's
 * evidence the 'height' exponent's curvature is the wrong shape for at least
 * this crop, which is why 'kcb' stays available rather than being FAO-56
 * trivia. The choice matters most for tall canopies (it shifts E and yield).
 */
export function fcFromKcb(Kcb, { Kc_min = 0.15, Kc_max, h = 0, model = 'height', fc_max = 0.99 } = {}) {
  let span = Kc_max - Kc_min;
  if (!(span > 1e-9) || Kcb <= Kc_min) return 0.0;
  let base = Math.min((Kcb - Kc_min) / span, 1.0);
  let exponent = (model === 'kcb') ? 1.0 : 1.0 + 0.5 * Math.max(h, 0);
  return Math.min(Math.pow(base, exponent), fc_max);
}

// ── Kc_max, upper limit on evaporation + transpiration (FAO-56 Eq. 72) ─────

/**
 *   Kc_max = max{ 1.2 + [0.04(u2 - 2) - 0.004(RHmin - 45)] (h/3)^0.3 ,  Kcb + 0.05 }
 *
 * h is the day's mean plant height (m), not the season maximum — the wind
 * and humidity correction scales with the canopy actually standing there.
 */
export function kcMax(Kcb, { u2, rhmin, h }) {
  let hh = Math.max(h, 0);
  let climate = 1.2 + (0.04 * (u2 - 2.0) - 0.004 * (rhmin - 45.0)) * Math.pow(hh / 3.0, 0.3);
  return Math.max(climate, Kcb + 0.05);
}

// ── Climate adjustment of tabulated Kcb (FAO-56 Eq. 70) ────────────────────

/**
 * Table 17's Kcb values assume a standard climate (u2 = 2 m/s, RHmin = 45%).
 * Eq. 70 corrects a tabulated Kcb_mid or Kcb_end to the site's own climate,
 * using the same wind/humidity structure as Eq. 72:
 *
 *   Kcb_adj = Kcb_tab + [0.04(u2 - 2) - 0.004(RHmin - 45)] (h/3)^0.3
 *
 * Applied only above a tabulated value of 0.45 (p. 136: "Kcb mid and Kcb end
 * values larger than 0.45 must be adjusted"). Eq. 62 and Eq. 65 are this
 * same formula's counterparts for Kc_mid/Kc_end in the single crop
 * coefficient approach (Table 12, Chapter 6) — the right citation here,
 * for the basal coefficient (Table 17, Chapter 7), is Eq. 70.
 *
 * This is crop-parameter preparation, not part of the water balance. It is
 * exported so a rotation builder can apply it per stage, with that stage's
 * own climate, before stitching Kcb series together — which is the only way
 * it can be correct when several crops share one run.
 */
export function adjustKcbForClimate(kcbTabulated, { u2, rhmin, h }) {
  if (!(kcbTabulated > 0.45)) return kcbTabulated;
  return kcbTabulated + (0.04 * (u2 - 2.0) - 0.004 * (rhmin - 45.0)) * Math.pow(Math.max(h, 0) / 3.0, 0.3);
}

/**
 * Convenience wrapper: returns a copy of `crop` with Kcb_mid and Kcb_end
 * adjusted using the mean u2 and RHmin over each stage's own days.
 * `rows` must be the run's weather window.
 */
export function adjustCropForClimate(crop, rows) {
  let N = rows.length;
  let midStart = crop.L_ini + crop.L_dev;
  let midEnd = midStart + crop.L_mid;
  let lateEnd = midEnd + crop.L_late;

  function mean(arr, key) {
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i][key];
    return s / arr.length;
  }

  function forStage(tab, from, to) {
    let w = rows.slice(Math.max(from, 0), Math.min(to, N));
    if (w.length === 0) return tab;
    return adjustKcbForClimate(tab, { u2: mean(w, 'wspd'), rhmin: mean(w, 'rmin'), h: crop.h_max });
  }

  return {
    ...crop,
    Kcb_mid: forStage(crop.Kcb_mid, midStart, midEnd),
    Kcb_end: forStage(crop.Kcb_end, midEnd, lateEnd),
  };
}

// ── FAO-33 yield response (Doorenbos & Kassam, 1979) ───────────────────────

/**
 *   1 - Y/Ymax = Ky (1 - T/Tx)
 *
 * Deliberately NOT computed inside runModel. A run may span a rotation, and
 * one T/Tx ratio averaged over two crops and a fallow is meaningless. The
 * caller slices the rows for one crop's window and calls this.
 *
 * Applied to T/Tx rather than the original ETa/ETx so the penalty reflects
 * water stress on transpiration specifically, not on soil evaporation.
 *
 * Returns null — not 0 — when the crop has no attainable yield defined.
 * A returned 0 reads as total crop failure and has caused real confusion.
 *
 * @param {object[]} rows rows returned by runModel, for ONE crop's window
 * @param {object} crop   needs Ky and Ymax
 */
export function estimateYield(rows, crop) {
  if (crop.Ymax === undefined || crop.Ymax === null || !isFinite(crop.Ymax)) return null;
  let Ky = crop.Ky !== undefined ? crop.Ky : 1.0;

  let T_total = 0;
  let Tx_total = 0;
  for (let i = 0; i < rows.length; i++) {
    let r = rows[i];
    if (isFinite(r.T)) T_total += r.T;
    if (isFinite(r.T_potential)) Tx_total += r.T_potential;
  }
  if (!(Tx_total > 1e-6)) return null;
  return Math.max(crop.Ymax * (1.0 - Ky * (1.0 - T_total / Tx_total)), 0.0);
}
