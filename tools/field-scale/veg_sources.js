/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/field-scale/veg_sources.js — Field Scale's vegetation-index registry.
 *
 * Owned by Field Scale alone (Mesoscale has its own copy), so adding or changing
 * a field VI product here cannot affect Mesoscale. Adding a satellite VI product
 * is a config entry, not a code change: ee_data.js reads these fields
 * generically. The chosen source also SETS THE GRID RESOLUTION for the whole
 * run — soil and weather are resampled to it.
 *
 * Fields
 *   weather      — 'centroid' (one weather series, broadcast) or 'spatial'
 *                  (per-pixel weather grid)
 *   collection   — Earth Engine ImageCollection id (or a label, when build is set)
 *   build        — optional (ee, { start, endExcl, region, maxCloud }) → an
 *                  ImageCollection that already carries the index band(s) named
 *                  in 'bands', with clouds MASKED (masked pixels sample as
 *                  no-data; the per-pixel Kcb interpolation simply skips that
 *                  date for that pixel). Used for scene collections where the
 *                  index is computed here.
 *   cloudFilter  — true to expose the scene cloud-cover tolerance (%) in the UI;
 *                  passed to build() as maxCloud
 *   bands        — { evi: bandName } — ONE index per source (the index is part
 *                  of the source's identity; a second index is a second entry)
 *   scaleFactor  — band value → index units (1 for a float composite)
 *   qa           — { band, max } to mask by a reliability band, or null when
 *                  build() already masks clouds (mask no-data only)
 *   scaleM       — grid resolution in meters (one per source; a grid coarser
 *                  than nativeM is a MEAN of the source pixels)
 *   nativeM      — source resolution, for mean aggregation onto a coarser grid
 *
 * Soil and weather are chosen independently (soil_sources.js / weather_sources.js),
 * not paired to the VI source, so a global VI can run over global soil/weather.
 */

/* EVI's denominator (NIR + 6 RED − 7.5 BLUE + 1) can approach zero over water,
   deep shadow and cloud edges, throwing values like −90 or +17. EVI is defined
   on [−1, 1]; anything outside is a numerical artifact, not vegetation, and is
   masked like a cloud. */
const inRange = (evi) => evi.gte(-1).and(evi.lte(1));

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
    return ee.Image(evi.updateMask(clear.and(inRange(evi))).copyProperties(img, ['system:time_start']));
  };
  const one = (id) => ee.ImageCollection(id)
    .filterDate(start, endExcl).filterBounds(region)
    .filter(ee.Filter.lte('CLOUD_COVER', maxCloud));
  return one('LANDSAT/LC08/C02/T1_L2').merge(one('LANDSAT/LC09/C02/T1_L2')).map(prep);
}

/**
 * Sentinel-2 L2A surface reflectance (harmonized) → EVI, cloud-masked.
 *   scenes    : COPERNICUS/S2_SR_HARMONIZED, CLOUDY_PIXEL_PERCENTAGE ≤ maxCloud
 *               (the scene-level filter: a scene is in or out as a whole)
 *   mask      : Cloud Score+ (cs_cdf ≥ CS_CLEAR) for the residual cloud, shadow
 *               and haze pixels inside the kept scenes
 *   EVI       : on reflectance (DN × 1e-4) from B2 / B4 / B8, all 10 m native
 */
const CS_CLEAR = 0.6;
function buildSentinel2(ee, { start, endExcl, region, maxCloud }) {
  const cs = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');
  const prep = (img) => {
    const sr = img.select(['B2', 'B4', 'B8']).multiply(1e-4);
    const N = sr.select('B8'), R = sr.select('B4'), B = sr.select('B2');
    const evi = sr.expression('2.5 * (N - R) / (N + 6 * R - 7.5 * B + 1)', { N, R, B }).rename('EVI');
    const clear = img.select('cs_cdf').gte(CS_CLEAR).and(inRange(evi));
    return ee.Image(evi.updateMask(clear).copyProperties(img, ['system:time_start']));
  };
  return ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterDate(start, endExcl).filterBounds(region)
    .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', maxCloud))
    .linkCollection(cs, ['cs_cdf'])
    .map(prep);
}

/* Order = dropdown order; the first entry is the default (30 m: safe for most
   fields). */
export const VEG_SOURCES = {
  sentinel2Evi30: {
    id: 'sentinel2Evi30',
    label: 'Sentinel-2 EVI — 30 m',
    weather: 'centroid',
    collection: 'COPERNICUS/S2_SR_HARMONIZED',
    build: buildSentinel2,
    cloudFilter: true,
    bands: { evi: 'EVI' },
    scaleFactor: 1,
    qa: null,                     /* clouds masked in build() */
    scaleM: 30,                   /* mean of the 10 m pixels: nine times fewer pixels */
    nativeM: 10,
    note: 'EVI from Sentinel-2 surface reflectance (2019 on, 5-day revisit) with the Cloud Score+ mask; scenes above the cloud-cover tolerance are skipped whole. Each 30 m pixel is the mean of the 10 m pixels. Global.',
  },

  sentinel2Evi10: {
    id: 'sentinel2Evi10',
    label: 'Sentinel-2 EVI — 10 m',
    weather: 'centroid',
    collection: 'COPERNICUS/S2_SR_HARMONIZED',
    build: buildSentinel2,
    cloudFilter: true,
    bands: { evi: 'EVI' },
    scaleFactor: 1,
    qa: null,                     /* clouds masked in build() */
    scaleM: 10,
    nativeM: 10,
    note: 'EVI from Sentinel-2 surface reflectance (2019 on, 5-day revisit) with the Cloud Score+ mask; scenes above the cloud-cover tolerance are skipped whole. Native 10 m: small fields only — a large grid may exceed Earth Engine memory. Global.',
  },

  landsatSrEvi: {
    id: 'landsatSrEvi',
    label: 'Landsat 8/9 EVI — 30 m',
    weather: 'centroid',
    collection: 'LANDSAT/LC08+LC09/C02/T1_L2',
    build: buildLandsatSrEvi,
    cloudFilter: true,
    bands: { evi: 'EVI' },
    scaleFactor: 1,
    qa: null,                     /* clouds are masked in build(); nothing further to screen */
    scaleM: 30,
    nativeM: 30,
    note: 'EVI from Landsat 8 and 9 surface reflectance (2013 on, 8-day revisit) with the QA_PIXEL cloud, shadow and snow mask; scenes above the cloud-cover tolerance are skipped whole. 30 m, global — use for periods before 2019.',
  },
};

export const FIELD_SOURCES = Object.values(VEG_SOURCES);

export function getVegSource(id) {
  return VEG_SOURCES[id] || VEG_SOURCES.sentinel2Evi30;
}
