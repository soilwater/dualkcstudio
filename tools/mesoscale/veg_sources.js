/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/mesoscale/veg_sources.js — Mesoscale's vegetation-index registry.
 *
 * Owned by Mesoscale alone (Field Scale has its own copy), so the two tools'
 * data layers never touch. Adding a coarse VI product is a config entry, not a
 * code change: ee_data.js reads these fields generically. The chosen source also
 * SETS THE GRID RESOLUTION for the whole run — soil and weather resample to it.
 *
 * Fields
 *   weather      — 'centroid' (one weather series, broadcast) or 'spatial'
 *                  (per-pixel weather grid)
 *   collection   — Earth Engine ImageCollection id (or a label, when build is set)
 *   build        — optional (ee, { start, endExcl, region, maxCloud }) → an
 *                  ImageCollection already carrying the index band(s), clouds
 *                  masked. Used for scene collections where the index is computed.
 *   cloudFilter  — true to expose the scene cloud-cover tolerance (%) in the UI
 *   bands        — { evi: bandName } — ONE index per source
 *   scaleFactor  — band value → index units (1 for a float composite)
 *   qa           — { band, max } to mask by a reliability band, or null
 *   scaleM       — grid resolution in metres (a coarser grid is a MEAN of pixels)
 *   nativeM      — source resolution, for mean aggregation onto a coarser grid
 */

/* Large watersheds and regions. VIIRS (500 m native) mean-aggregates gently to
   the coarser grids; a 30 m source at this scale overflows Earth Engine's
   memory, so fine-resolution scenes stay in the Field Scale tool. */
export const VEG_SOURCES = {
  viirs4km: {
    id: 'viirs4km',
    label: 'VIIRS VNP13A1 EVI',
    weather: 'spatial',
    collection: 'NASA/VIIRS/002/VNP13A1',
    bands: { evi: 'EVI' },        /* EVI only, to match the field tool */
    scaleFactor: 1,               /* this asset's EVI is already ~0–1 (NOT ×10⁴) */
    qa: { band: 'pixel_reliability', max: 2 },   /* rank: 0–2 = Excellent/Good/Acceptable */
    scaleM: 4000,
    nativeM: 500,                 /* VIIRS 500 m aggregated (mean) to the 4 km grid */
    note: 'VIIRS 500 m EVI — pick the grid resolution (500 m–4 km) to match the region size. Large watersheds and regions.',
  },
};

export const MESO_SOURCES = Object.values(VEG_SOURCES);

export function getVegSource(id) {
  return VEG_SOURCES[id] || VEG_SOURCES.viirs4km;
}
