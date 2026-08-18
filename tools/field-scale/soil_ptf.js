/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/field-scale/soil_ptf.js — soil texture → FAO-56 water limits, per pixel.
 *
 * Saxton & Rawls (2006) pedotransfer functions turn sand / clay / organic-
 * matter fractions (POLARIS or SoilGrids) into the volumetric field capacity
 * (θ33) and wilting point (θ1500) that engine.js's soil input needs. Scalar
 * functions applied one pixel at a time, so they read exactly like the paper.
 *
 * Reference: Saxton, K.E. & Rawls, W.J. (2006). Soil Water Characteristic
 * Estimates by Texture and Organic Matter for Hydrologic Solutions. SSSAJ
 * 70:1569-1578. Eqs. 1-3 (moist range; no salinity / gravel / density term).
 */

/**
 * Field capacity and wilting point (v/v fractions) from texture.
 *   sandPct, clayPct — percent by mass (0-100)
 *   omPct           — percent organic matter by mass (0-100)
 * Returns { fc, wp } clipped to physical ranges, or { fc: NaN, wp: NaN } if any
 * input is not finite (a masked / no-data pixel).
 */
export function saxtonRawls2006(sandPct, clayPct, omPct) {
  if (!isFinite(sandPct) || !isFinite(clayPct) || !isFinite(omPct)) return { fc: NaN, wp: NaN };
  const S = sandPct / 100.0;
  const C = clayPct / 100.0;
  const OM = Math.max(omPct, 0.0);

  /* Eq. 1 — wilting point (1500 kPa) */
  const t1500 = -0.024 * S + 0.487 * C + 0.006 * OM
    + 0.005 * (S * OM) - 0.013 * (C * OM) + 0.068 * (S * C) + 0.031;
  let wp = t1500 + (0.14 * t1500 - 0.02);

  /* Eq. 2 — field capacity (33 kPa) */
  const t33 = -0.251 * S + 0.195 * C + 0.011 * OM
    + 0.006 * (S * OM) - 0.027 * (C * OM) + 0.452 * (S * C) + 0.299;
  let fc = t33 + (1.283 * t33 * t33 - 0.374 * t33 - 0.015);

  fc = Math.min(Math.max(fc, 0.02), 0.60);
  wp = Math.min(Math.max(wp, 0.01), fc - 0.02);
  return { fc, wp };
}
