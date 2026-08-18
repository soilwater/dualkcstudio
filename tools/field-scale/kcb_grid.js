/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/field-scale/kcb_grid.js — vegetation index → per-pixel daily Kcb stack.
 *
 * Two steps:
 *   1. Rescale each cloud-free VI observation to Kcb with a linear map
 *      (soil endpoint → kcbMin, full-cover endpoint → kcbMax), clipped.
 *   2. Linearly interpolate the sparse per-pixel observations onto every day
 *      of the season. Beyond a pixel's first/last clear date the nearest edge
 *      value is held — no extrapolation drift into the water balance.
 *
 * The stack is a single flat Float32Array laid out [day * nPixels + pixel], so
 * a whole pixel's daily Kcb is a strided column and a whole day's map is a
 * contiguous slice. NaN marks a pixel with no clear observation all season
 * (run_grid.js skips it, exactly as a cloud/out-of-bounds pixel).
 */

/** Days since the Unix epoch for a 'YYYY-MM-DD' string (UTC, calendar-exact). */
export function dayNumber(iso) {
  return Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
}

/** Linear VI→Kcb rescale of one value; NaN passes through. */
export function viToKcb(vi, viMin, viMax, kcbMin, kcbMax) {
  if (!isFinite(vi)) return NaN;
  const frac = Math.min(Math.max((vi - viMin) / (viMax - viMin), 0.0), 1.0);
  return kcbMin + (kcbMax - kcbMin) * frac;
}

/**
 * Build the daily Kcb stack.
 *
 *   obsDates   : array of 'YYYY-MM-DD' (clear VI observation dates)
 *   viStack    : array of Float32Array (one per obsDate, each length nPixels)
 *   seasonDates: array of 'YYYY-MM-DD', every day of the run (length T)
 *   opts       : { viMin, viMax, kcbMin, kcbMax }
 *
 * Returns { kcb: Float32Array(T*nPixels), T, nPixels }.
 */
export function buildKcbStack(obsDates, viStack, seasonDates, opts) {
  const { viMin, viMax, kcbMin, kcbMax } = opts;
  if (!(viMax > viMin)) throw new Error('viMax must exceed viMin.');

  /* Sort observations by date so interpolation walks forward in time. */
  const order = obsDates.map((d, i) => ({ d, i })).sort((a, b) => (a.d < b.d ? -1 : 1));
  const nObs = order.length;
  const nPixels = viStack[0].length;
  const T = seasonDates.length;

  const obsNum = order.map((o) => dayNumber(o.d));
  const seasonNum = seasonDates.map(dayNumber);

  /* Rescale every observation to Kcb up front: kcbObs[obs][pixel]. */
  const kcbObs = order.map((o) => {
    const src = viStack[o.i];
    const out = new Float32Array(nPixels);
    for (let p = 0; p < nPixels; p++) out[p] = viToKcb(src[p], viMin, viMax, kcbMin, kcbMax);
    return out;
  });

  const kcb = new Float32Array(T * nPixels).fill(NaN);

  /* Per-pixel linear interpolation with edge-hold. Reuse small scratch arrays
     for the finite observations of the current pixel. */
  const fVal = new Float64Array(nObs);
  const fNum = new Float64Array(nObs);
  for (let p = 0; p < nPixels; p++) {
    let m = 0;
    for (let k = 0; k < nObs; k++) {
      const v = kcbObs[k][p];
      if (isFinite(v)) { fVal[m] = v; fNum[m] = obsNum[k]; m++; }
    }
    if (m === 0) continue;                       /* no clear obs — leave NaN */
    if (m === 1) { for (let t = 0; t < T; t++) kcb[t * nPixels + p] = fVal[0]; continue; }

    let seg = 0;                                 /* current interpolation segment */
    for (let t = 0; t < T; t++) {
      const x = seasonNum[t];
      if (x <= fNum[0]) { kcb[t * nPixels + p] = fVal[0]; continue; }
      if (x >= fNum[m - 1]) { kcb[t * nPixels + p] = fVal[m - 1]; continue; }
      while (seg < m - 2 && x > fNum[seg + 1]) seg++;
      const t0 = fNum[seg], t1 = fNum[seg + 1];
      const w = (x - t0) / (t1 - t0);
      kcb[t * nPixels + p] = fVal[seg] + w * (fVal[seg + 1] - fVal[seg]);
    }
  }

  return { kcb, T, nPixels };
}
