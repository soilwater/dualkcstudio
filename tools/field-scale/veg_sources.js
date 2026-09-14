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
 *   collection   — Earth Engine ImageCollection id (or a label, when build is set)
 *   build        — optional (ee, { start, endExcl, region, maxCloud }) → an
 *                  ImageCollection that already carries the index band(s) named
 *                  in 'bands', with clouds MASKED (masked pixels sample as
 *                  no-data; the per-pixel Kcb interpolation simply skips that
 *                  date for that pixel). Used for scene collections where the
 *                  index is computed here.
 *   cloudFilter  — true to expose the scene cloud-cover tolerance (%) in the UI;
 *                  passed to build() as maxCloud
 *   bands        — { evi?, ndvi? } band names; a source may offer only one
 *   scaleFactor  — band value → index units (1 for a float composite)
 *   qa           — { band, max } to mask by a reliability band, or null when
 *                  build() already masks clouds (mask no-data only)
 *   scaleM       — default grid resolution in metres
 *   resolutions  — optional list of grid resolutions the user may pick (a grid
 *                  coarser than nativeM is a MEAN of the source pixels)
 *   nativeM      — source resolution, for mean aggregation onto a coarser grid
 *   soil         — id of the paired soil source (soil_sources.js)
 */

/**
 * Landsat 8/9 Collection 2 Level 2 surface reflectance → EVI, cloud-masked.
 *   scenes    : LC08 + LC09 T1_L2, scene CLOUD_COVER ≤ maxCloud (%)
 *   mask      : QA_PIXEL bits 1–5 (dilated cloud, cirrus, cloud, shadow, snow)
 *               and QA_RADSAT saturation on the blue/red/NIR bands
 *   EVI       : 2.5 (NIR − RED) / (NIR + 6 RED − 7.5 BLUE + 1) on reflectance
 *               (DN × 0.0000275 − 0.2), bands SR_B5 / SR_B4 / SR_B2
 */
function buildLandsatSrEvi(ee, { start, endExcl, region, maxCloud }) {
  const prep = (img) => {
    const qa = img.select('QA_PIXEL');
    const sat = img.select('QA_RADSAT');
    const clear = qa.bitwiseAnd((1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5)).eq(0)
      .and(sat.bitwiseAnd((1 << 1) | (1 << 3) | (1 << 4)).eq(0));
    const sr = img.select(['SR_B2', 'SR_B4', 'SR_B5']).multiply(0.0000275).add(-0.2);
    const evi = sr.expression('2.5 * (N - R) / (N + 6 * R - 7.5 * B + 1)', {
      N: sr.select('SR_B5'), R: sr.select('SR_B4'), B: sr.select('SR_B2'),
    }).rename('EVI');
    return ee.Image(evi.updateMask(clear).copyProperties(img, ['system:time_start']));
  };
  const one = (id) => ee.ImageCollection(id)
    .filterDate(start, endExcl).filterBounds(region)
    .filter(ee.Filter.lte('CLOUD_COVER', maxCloud));
  return one('LANDSAT/LC08/C02/T1_L2').merge(one('LANDSAT/LC09/C02/T1_L2')).map(prep);
}

/**
 * Sentinel-2 L2A surface reflectance (harmonized) → EVI and NDVI, cloud-masked.
 *   scenes    : COPERNICUS/S2_SR_HARMONIZED, CLOUDY_PIXEL_PERCENTAGE ≤ maxCloud
 *               (the scene-level filter: a scene is in or out as a whole)
 *   mask      : Cloud Score+ (cs_cdf ≥ CS_CLEAR) for the residual cloud, shadow
 *               and haze pixels inside the kept scenes
 *   EVI/NDVI  : on reflectance (DN × 1e-4) from B2 / B4 / B8, all 10 m native
 */
const CS_CLEAR = 0.6;
function buildSentinel2(ee, { start, endExcl, region, maxCloud }) {
  const cs = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');
  const prep = (img) => {
    const sr = img.select(['B2', 'B4', 'B8']).multiply(1e-4);
    const N = sr.select('B8'), R = sr.select('B4'), B = sr.select('B2');
    const evi = sr.expression('2.5 * (N - R) / (N + 6 * R - 7.5 * B + 1)', { N, R, B }).rename('EVI');
    const ndvi = N.subtract(R).divide(N.add(R)).rename('NDVI');
    const clear = img.select('cs_cdf').gte(CS_CLEAR);
    return ee.Image(evi.addBands(ndvi).updateMask(clear).copyProperties(img, ['system:time_start']));
  };
  return ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterDate(start, endExcl).filterBounds(region)
    .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', maxCloud))
    .linkCollection(cs, ['cs_cdf'])
    .map(prep);
}

export const VEG_SOURCES = {
  sentinel2: {
    id: 'sentinel2',
    label: 'Sentinel-2 EVI / NDVI — 10–30 m',
    group: 'field',
    weather: 'centroid',
    collection: 'COPERNICUS/S2_SR_HARMONIZED',
    build: buildSentinel2,
    cloudFilter: true,
    bands: { evi: 'EVI', ndvi: 'NDVI' },
    scaleFactor: 1,
    qa: null,                     /* clouds masked in build() */
    scaleM: 30,                   /* default: 30 m keeps the daily stacks small */
    nativeM: 10,
    resolutions: [10, 30],
    soil: 'polaris',
    note: 'EVI or NDVI from Sentinel-2 surface reflectance (2019 on, 5-day revisit) with the Cloud Score+ mask; scenes above the cloud-cover tolerance are skipped whole. 10 m for small fields, 30 m (mean of 10 m pixels) for larger ones, over POLARIS soil.',
  },

  landsatSrEvi: {
    id: 'landsatSrEvi',
    label: 'Landsat 8/9 EVI — 30 m',
    group: 'field',
    weather: 'centroid',
    collection: 'LANDSAT/LC08+LC09/C02/T1_L2',
    build: buildLandsatSrEvi,
    cloudFilter: true,
    bands: { evi: 'EVI' },
    scaleFactor: 1,
    qa: null,                     /* clouds are masked in build(); nothing further to screen */
    scaleM: 30,
    nativeM: 30,
    soil: 'polaris',
    note: 'EVI from Landsat 8 and 9 surface reflectance (2013 on, 8-day revisit) with the QA_PIXEL cloud, shadow and snow mask; scenes above the cloud-cover tolerance are skipped whole. 30 m over POLARIS soil — use for periods before 2019.',
  },

  /* Mesoscale: large watersheds and regions. VIIRS (500 m native) mean-
     aggregates gently to the coarser grids; a 30 m source at this scale
     overflows Earth Engine's memory, so Landsat is field-only. */
  viirs4km: {
    id: 'viirs4km',
    label: 'VIIRS VNP13A1 EVI',
    group: 'meso',
    weather: 'spatial',
    collection: 'NASA/VIIRS/002/VNP13A1',
    bands: { evi: 'EVI' },        /* EVI only, to match the field tool */
    scaleFactor: 1,               /* this asset's EVI is already ~0–1 (NOT ×10⁴) */
    qa: { band: 'pixel_reliability', max: 2 },   /* rank: 0–2 = Excellent/Good/Acceptable */
    scaleM: 4000,
    nativeM: 500,                 /* VIIRS 500 m aggregated (mean) to the 4 km grid */
    soil: 'soilgrids',
    note: 'VIIRS 500 m EVI over SoilGrids soil — pick the grid resolution (500 m–4 km) to match the region size. Large watersheds and regions.',
  },
};

const VEG_LIST = Object.values(VEG_SOURCES);
export const FIELD_SOURCES = VEG_LIST.filter((s) => s.group === 'field');
export const MESO_SOURCES = VEG_LIST.filter((s) => s.group === 'meso');

export function getVegSource(id) {
  return VEG_SOURCES[id] || VEG_SOURCES.sentinel2;
}

/** The index keys a source offers, e.g. ['evi']. */
export function indexOptions(src) {
  return Object.keys(src.bands).map((k) => ({ value: k, label: k.toUpperCase() }));
}
