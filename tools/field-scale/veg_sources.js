/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/field-scale/veg_sources.js — the registry of vegetation-index datasets.
 *
 * Adding a satellite VI product is a config entry here, not a code change:
 * ee_data.js reads these fields generically. The chosen source also SETS THE
 * GRID RESOLUTION for the whole run — soil and weather are resampled to it.
 *
 * Fields
 *   group        — which tool offers it ('field' | 'meso')
 *   weather      — 'centroid' (one GRIDMET series, broadcast) or 'spatial'
 *                  (per-pixel GRIDMET grid)
 *   collection   — Earth Engine ImageCollection id
 *   bands        — { evi?, ndvi? } band names; a source may offer only one
 *   scaleFactor  — band value → index units (1 for a float composite)
 *   qa           — { band, max } to mask by a reliability band, or null for a
 *                  pre-screened composite that carries no QA (mask no-data only)
 *   scaleM       — target grid resolution in metres
 *   nativeM      — source resolution, for mean aggregation onto a coarser grid
 *   soil         — id of the paired soil source (soil_sources.js)
 *   maxHa        — hard area cap in hectares for a drawn field
 */

export const VEG_SOURCES = {
  landsat8dayEvi: {
    id: 'landsat8dayEvi',
    label: 'Landsat 8-day EVI — 30 m',
    group: 'field',
    weather: 'centroid',
    collection: 'LANDSAT/COMPOSITES/C02/T1_L2_8DAY_EVI',
    bands: { evi: 'EVI' },        /* EVI only — no NDVI in this product */
    scaleFactor: 1,               /* pre-composited float EVI */
    qa: null,                     /* already cloud-screened; mask no-data only */
    scaleM: 30,
    nativeM: 30,
    soil: 'polaris',              /* 30 m POLARIS matches the 30 m grid (CONUS) */
    maxHa: 2500,                  /* large fields / small watersheds */
    note: 'Cloud-free 8-day composite, low latency, EVI only. Field scale at 30 m over POLARIS soil.',
  },

  /* Mesoscale (4 km): large watersheds and regions (up to 250,000 km²). VIIRS
     (500 m native) aggregates gently to 4 km; a 30 m source at this scale
     overflows Earth Engine's memory, so Landsat is field-only. */
  viirs4km: {
    id: 'viirs4km',
    label: 'VIIRS VNP13A1 — 4 km (mesoscale)',
    group: 'meso',
    weather: 'spatial',
    collection: 'NASA/VIIRS/002/VNP13A1',
    bands: { evi: 'EVI' },        /* EVI only, to match the field tool */
    scaleFactor: 1,               /* this asset's EVI is already ~0–1 (NOT ×10⁴) */
    qa: { band: 'pixel_reliability', max: 2 },   /* rank: 0–2 = Excellent/Good/Acceptable */
    scaleM: 4000,
    nativeM: 500,                 /* VIIRS 500 m aggregated (mean) to the 4 km grid */
    soil: 'soilgrids',
    maxHa: 25000000,              /* 250,000 km² */
    note: 'VIIRS 500 m EVI on a 4 km grid over SoilGrids soil — large watersheds and regions.',
  },
};

const VEG_LIST = Object.values(VEG_SOURCES);
export const FIELD_SOURCES = VEG_LIST.filter((s) => s.group === 'field');
export const MESO_SOURCES = VEG_LIST.filter((s) => s.group === 'meso');

export function getVegSource(id) {
  return VEG_SOURCES[id] || VEG_SOURCES.landsat8dayEvi;
}

/** The index keys a source offers, e.g. ['evi']. */
export function indexOptions(src) {
  return Object.keys(src.bands).map((k) => ({ value: k, label: k.toUpperCase() }));
}
