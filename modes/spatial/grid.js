/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * modes/spatial/grid.js — AOI geometry, target grid, and the size cap.
 *
 * Pure geometry: no Earth Engine, no DOM. A rectangular area of interest (the
 * drawn shape's bounding box) is described in lon/lat; this module reports its
 * area and the pixel grid it implies at a given resolution, and whether that
 * fits under the dataset's hectare cap. The map UI and the Earth Engine layer
 * both read these numbers, so pixel count — the one thing that bounds download
 * size and browser memory — is computed in a single place.
 */

const R_EARTH = 6378137.0;               /* WGS-84 equatorial radius, m */
const DEG = Math.PI / 180.0;

/**
 * Metres per degree of longitude / latitude at a given latitude (spherical
 * approximation — only used for area/size reporting, never for reprojection).
 */
export function metresPerDegree(lat) {
  const mPerLat = R_EARTH * DEG;                    /* ~111.32 km, ~constant */
  const mPerLon = R_EARTH * DEG * Math.cos(lat * DEG);
  return { mPerLat, mPerLon };
}

/** A rectangle {west,south,east,north} → its width/height in metres. */
export function rectMetres(rect) {
  const midLat = 0.5 * (rect.south + rect.north);
  const { mPerLat, mPerLon } = metresPerDegree(midLat);
  return {
    widthM: Math.abs(rect.east - rect.west) * mPerLon,
    heightM: Math.abs(rect.north - rect.south) * mPerLat,
  };
}

/** Rectangle area in hectares. */
export function rectHectares(rect) {
  const { widthM, heightM } = rectMetres(rect);
  return (widthM * heightM) / 1e4;
}

/**
 * The pixel grid an AOI implies at a resolution: columns and rows (rounded up
 * so a partial pixel still counts) and the total.
 */
export function gridShape(rect, scaleM) {
  const { widthM, heightM } = rectMetres(rect);
  const cols = Math.max(1, Math.ceil(widthM / scaleM));
  const rows = Math.max(1, Math.ceil(heightM / scaleM));
  return { cols, rows, nPixels: cols * rows };
}

/** Size report against the dataset's hard area cap in hectares (`opts.maxHa`). */
export function checkAoi(rect, opts) {
  const ha = rectHectares(rect);
  const { cols, rows, nPixels } = gridShape(rect, opts.scaleM);
  const { widthM, heightM } = rectMetres(rect);
  const maxHa = opts.maxHa || Infinity;
  return {
    ha, km2: ha / 100.0, cols, rows, nPixels, widthM, heightM,
    ok: ha <= maxHa + 1e-6,
    overBy: ha / maxHa,
    maxHa, scaleM: opts.scaleM,
  };
}
