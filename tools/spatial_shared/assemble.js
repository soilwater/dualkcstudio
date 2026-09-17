/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/spatial_shared/assemble.js — pure transforms from raw Earth Engine pixel
 * arrays to the per-pixel inputs run_grid.js needs. No Earth Engine, no DOM:
 * it takes the 2-D arrays sampleRectangle returns and produces flat
 * Float32Array grids, so the EE/auth layer (ee_data.js) stays thin.
 *
 * SoilGrids (ISRIC v2.0) band units, converted here to what the PTF wants:
 *   sand, clay : mapped g/kg → percent  (÷10)
 *   soc        : mapped dg/kg → organic-matter percent  (soc_dg/kg → g/kg ÷10
 *                → % ÷10 → OM% ×1.724, i.e. OM% = soc × 0.01724)
 * A masked / no-data pixel comes back as the sentinel and becomes NaN, which
 * propagates so run_grid.js skips that pixel.
 */

import { saxtonRawls2006 } from './soil_ptf.js';

const SENTINEL = -9999;
const isData = (v) => Number.isFinite(v) && v > SENTINEL + 1;

/** SoilGrids band value → conventional units for the PTF (sand/clay/om). */
export const SOILGRIDS_CONV = {
  sand: (v) => v / 10.0,          /* g/kg → % */
  clay: (v) => v / 10.0,          /* g/kg → % */
  om: (v) => v * 0.01724,         /* soc dg/kg → OM % (SOC%×1.724) */
};

/** Depth-band suffixes SoilGrids uses, keyed by the layer ids in soil_sources.js. */
export const SOILGRIDS_DEPTH = {
  '0_5': '0-5cm', '5_15': '5-15cm', '15_30': '15-30cm',
  '30_60': '30-60cm', '60_100': '60-100cm', '100_200': '100-200cm',
};

/** Flatten a sampleRectangle 2-D array (rows of cols) to a Float32Array. */
export function flattenGrid(arr2d) {
  const rows = arr2d.length;
  const cols = arr2d[0] ? arr2d[0].length : 0;
  const out = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const row = arr2d[r];
    for (let c = 0; c < cols; c++) out[r * cols + c] = row[c];
  }
  return { data: out, rows, cols };
}

/**
 * Per-pixel field capacity & wilting point for the (single, homogeneous) soil,
 * from a soil source's depth-weighted root-zone texture. FAO-56 uses one fc/wp
 * for the whole profile — evaporation layer, root zone and subsoil alike — so
 * the PTF is applied once, to the root-zone depth mean.
 *
 *   sand, clay, om : each a Float32Array(nPixels) of RAW band values (the
 *                    depth-weighted 0–100 cm mean built server-side in
 *                    soil_sources.js)
 *   conv           : { sand, clay, om } functions mapping raw band values to
 *                    percent / OM-percent (SOILGRIDS_CONV, POLARIS_CONV)
 *
 * A pixel with no valid texture is NaN, which propagates so run_grid skips it.
 */
export function soilLimitsFromBands(sand, clay, om, conv = SOILGRIDS_CONV) {
  const nPixels = sand.length;
  const fc = new Float32Array(nPixels).fill(NaN);
  const wp = new Float32Array(nPixels).fill(NaN);

  for (let p = 0; p < nPixels; p++) {
    const s = sand[p], c = clay[p], o = om[p];
    if (!isData(s) || !isData(c)) continue;
    const lim = saxtonRawls2006(conv.sand(s), conv.clay(c), isData(o) ? conv.om(o) : 0);
    fc[p] = lim.fc; wp[p] = lim.wp;
  }
  return { fc, wp };
}

/**
 * A vegetation-index observation grid: raw VI band → scaled VI with masked /
 * no-data / poor-quality pixels set to NaN.
 *
 *   qaFlat      : optional QA band (same length). Pass null for sources that
 *                 are already cloud-screened composites (e.g. the Landsat
 *                 8-day EVI), which carry no QA band — only no-data is masked.
 *   qaMax       : keep pixels with 0 ≤ QA ≤ qaMax.
 *   scaleFactor : band → index units (1 for a float product).
 */
export function viFromBands(viFlat, qaFlat, qaMax = 1, scaleFactor = 1) {
  const n = viFlat.length;
  const out = new Float32Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const v = viFlat[i];
    if (!isData(v)) continue;
    if (qaFlat) { const q = qaFlat[i]; if (!(Number.isFinite(q) && q >= 0 && q <= qaMax)) continue; }
    out[i] = v * scaleFactor;
  }
  return out;
}
