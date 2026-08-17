/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * modes/spatial/assemble.js — pure transforms from raw Earth Engine pixel
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
 * Per-pixel field capacity & wilting point for the surface (evaporation, Ze)
 * layer and the root zone (Zr), from a soil source's depth-mean texture.
 *
 *   sand, clay, om : { surface, profile } — each a Float32Array(nPixels) of RAW
 *                    band values (the 0–15 cm and 0–100 cm depth means built
 *                    server-side in soil_sources.js)
 *   conv           : { sand, clay, om } functions mapping raw band values to
 *                    percent / OM-percent (SOILGRIDS_CONV, POLARIS_CONV)
 *
 * The PTF is applied once to the surface mean (→ Ze) and once to the profile
 * mean (→ Zr). A pixel with no valid texture is NaN there.
 */
export function soilLimitsFromBands(sand, clay, om, conv = SOILGRIDS_CONV) {
  const nPixels = sand.surface.length;
  const rootzone_fc = new Float32Array(nPixels).fill(NaN);
  const rootzone_wp = new Float32Array(nPixels).fill(NaN);
  const surface_fc = new Float32Array(nPixels).fill(NaN);
  const surface_wp = new Float32Array(nPixels).fill(NaN);

  const limits = (s, c, o) => {
    if (!isData(s) || !isData(c)) return null;
    return saxtonRawls2006(conv.sand(s), conv.clay(c), isData(o) ? conv.om(o) : 0);
  };

  for (let p = 0; p < nPixels; p++) {
    const surf = limits(sand.surface[p], clay.surface[p], om.surface[p]);
    if (surf) { surface_fc[p] = surf.fc; surface_wp[p] = surf.wp; }
    const prof = limits(sand.profile[p], clay.profile[p], om.profile[p]);
    if (prof) { rootzone_fc[p] = prof.fc; rootzone_wp[p] = prof.wp; }
  }
  return { rootzone_fc, rootzone_wp, surface_fc, surface_wp };
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
