/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/field-scale/run_grid.js — the gridded run: engine.js, one pixel at a time.
 *
 * There is no second copy of the water balance here: a spatial run is a loop
 * over pixels that calls runModel with that pixel's soil, Kcb series and (for
 * mesoscale) weather. A 1-pixel grid therefore reproduces the Single Season
 * tool exactly. The cost is speed, which the area caps bound.
 *
 * Layout: every daily output grid is a flat Float32Array [day*nPixels + pixel]
 * (a day's map is a contiguous slice; a pixel's series is a stride). Per-pixel
 * season summaries are plain Float32Array(nPixels). Invalid pixels — masked
 * soil, or no clear VI observation all season — stay NaN everywhere and are
 * never run.
 */

import { runModel } from '../../core/engine.js';

/* Daily grids kept for the day-slider map (nPixels * T * 4 bytes each). Ke
   feeds the Kcb+Ke pixel plot; Sr_paw is root-zone plant-available water (mm). */
export const DEFAULT_DAILY_VARS = ['Kcb', 'Ke', 'Dr', 'Sr_paw', 'ETc', 'Ks'];

/**
 * Run the grid.
 *
 *   grid    : { cols, rows, nPixels }
 *   soil    : { rootzone_fc, rootzone_wp, surface_fc, surface_wp } — each
 *             Float32Array(nPixels); NaN marks a masked pixel
 *   scalars : field-wide soil { Ze, REW_frac, Zr_profile, faw0 } where faw0 is
 *             the initial fraction of available water (0 = wilting, 1 = FC)
 *   kcbStack: Float32Array(T*nPixels) daily per-pixel Kcb (from kcb_grid.js)
 *   dates   : array of T 'YYYY-MM-DD'
 *   weather : array of T rows { ETo, prcp, wspd, rmin, irrig? } — field-wide,
 *             or null when opts.weatherStacks carries per-pixel weather
 *   crop    : field-wide { Zr_max, h_max, Kcb_full, p_tab, Kc_min? }
 *   mgmt    : field-wide management dict for engine.js
 *   opts    : { dailyVars?, options?, onProgress?, weatherStacks? }
 *
 * Returns { cols, rows, T, nPixels, dates, daily:{var:Float32Array},
 *           summary:{var:Float32Array}, validMask:Uint8Array, nValid, nError }.
 */
export function runGrid(grid, soil, scalars, kcbStack, dates, weather, crop, mgmt, opts = {}) {
  const { cols, rows } = grid;
  const nPixels = cols * rows;
  const T = dates.length;
  const dailyVars = opts.dailyVars || DEFAULT_DAILY_VARS;
  const engineOptions = opts.options || {};
  const onProgress = opts.onProgress || null;
  /* Per-pixel weather (mesoscale) as Float32 stacks; absent → the field-wide
     `weather` array is broadcast to every pixel (field scale). */
  const wx = opts.weatherStacks || null;

  const { rootzone_fc, rootzone_wp, surface_fc, surface_wp } = soil;
  const { Ze, REW_frac, Zr_profile, faw0 } = scalars;
  const f0 = isFinite(faw0) ? Math.min(Math.max(faw0, 0), 1) : 0.7;

  const daily = {};
  for (const v of dailyVars) daily[v] = new Float32Array(T * nPixels).fill(NaN);
  const summary = {};
  for (const v of ['ETc_sum', 'T_sum', 'E_sum', 'deepPerc_sum', 'stressDays', 'finalPaw']) {
    summary[v] = new Float32Array(nPixels).fill(NaN);
  }
  const validMask = new Uint8Array(nPixels);

  /* Which pixels will actually run: soil present and at least one clear VI
     observation (edge-hold fills the whole column, so day 0 finite ⇒ all
     finite). Count first so progress can be reported against real work. */
  const todo = [];
  for (let p = 0; p < nPixels; p++) {
    /* Spatial weather: also require finite weather (a pixel off GRIDMET/CONUS
       coverage is NaN and must be skipped). */
    const wxOk = !wx || (isFinite(wx.eto[p]) && isFinite(wx.prcp[p]));
    if (isFinite(rootzone_fc[p]) && isFinite(rootzone_wp[p]) && isFinite(kcbStack[p]) && wxOk) {
      validMask[p] = 1;
      todo.push(p);
    }
  }
  const nValid = todo.length;

  const kcbCol = new Array(T);       /* reused per-pixel Kcb series */
  /* Reusable per-pixel weather rows (only when spatial); the engine copies each
     row, so mutating these between pixels is safe. */
  const pixelWx = wx ? Array.from({ length: T }, () => ({ irrig: 0 })) : null;
  let nError = 0;
  const reportEvery = Math.max(1, Math.floor(nValid / 100));

  for (let i = 0; i < nValid; i++) {
    const p = todo[i];
    const rzFc = rootzone_fc[p], rzWp = rootzone_wp[p];
    const sfFc = surface_fc[p], sfWp = surface_wp[p];
    const rzIni = rzWp + f0 * (rzFc - rzWp);
    const sfIni = sfWp + f0 * (sfFc - sfWp);

    const pixelSoil = {
      surface_fc: sfFc, surface_wp: sfWp, surface_ini: sfIni,
      rootzone_fc: rzFc, rootzone_wp: rzWp, rootzone_ini: rzIni,
      subsoil_ini: rzIni, Ze, REW_frac, Zr_profile,
    };

    for (let t = 0; t < T; t++) kcbCol[t] = kcbStack[t * nPixels + p];
    const pixelCrop = { ...crop, Kcb: kcbCol };

    let pixelWeather = weather;
    if (wx) {
      for (let t = 0; t < T; t++) {
        const k = t * nPixels + p, row = pixelWx[t];
        row.ETo = wx.eto[k]; row.prcp = wx.prcp[k]; row.wspd = wx.wspd[k]; row.rmin = wx.rmin[k];
      }
      pixelWeather = pixelWx;
    }

    let res;
    try {
      res = runModel(pixelSoil, pixelCrop, mgmt, pixelWeather, engineOptions);
    } catch (e) {
      validMask[p] = 0;
      nError++;
      continue;
    }

    const df = res.df;
    let etcSum = 0, tSum = 0, eSum = 0, dpSum = 0, stress = 0;
    for (let t = 0; t < T; t++) {
      const r = df[t];
      for (const v of dailyVars) daily[v][t * nPixels + p] = r[v];
      etcSum += r.ETc; tSum += r.T; eSum += r.E; dpSum += r.deep_percolation;
      if (r.Ks < 0.999) stress++;
    }
    summary.ETc_sum[p] = etcSum;
    summary.T_sum[p] = tSum;
    summary.E_sum[p] = eSum;
    summary.deepPerc_sum[p] = dpSum;
    summary.stressDays[p] = stress;
    summary.finalPaw[p] = df[T - 1].Sr_paw;

    if (onProgress && (i % reportEvery === 0 || i === nValid - 1)) onProgress((i + 1) / nValid);
  }

  return { cols, rows, T, nPixels, dates, daily, summary, validMask, nValid, nError };
}
