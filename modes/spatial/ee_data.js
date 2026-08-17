/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * modes/spatial/ee_data.js — Earth Engine acquisition for the spatial grid.
 *
 * The only Earth-Engine-dependent file in the spatial mode. Everything it
 * returns is a plain aligned grid; the maths lives in the pure assemble.js /
 * soil_ptf.js / kcb_grid.js. It samples the sources onto one shared lat/lon
 * grid (sampleRectangle returns the pixels straight as JSON):
 *
 *   Soil (POLARIS / SoilGrids) — sand/clay/organic matter by depth → FC/WP
 *   Vegetation index (Landsat / VIIRS) — clear EVI observations
 *   GRIDMET (~4 km) — one daily series at the AOI centroid, broadcast across
 *     the grid (field scale), or a per-pixel daily grid (mesoscale)
 *
 * The shared grid is a simple EPSG:4326 affine anchored at the box's top-left.
 * Every source is reprojected onto that one grid so pixels coincide. A
 * defensive crop to the common shape guards the rare off-by-one.
 */

import { regionArrayToRows, gridmetToWeather } from '../gee-collector/gee.js';
import { flattenGrid, soilLimitsFromBands, viFromBands } from './assemble.js';

const SENTINEL = -9999;

function addDaysISO(iso, n) {
  return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000)
    .toISOString().slice(0, 10);
}

/**
 * sampleRectangle one image onto the shared lat/lon grid → { band: 2-D array }.
 *
 * `transform` is the EPSG:4326 affine [dLon,0,west, 0,-dLat,north].
 * `reduceProj` (optional) turns nearest sampling into mean aggregation: when
 * the grid is much coarser than the source (mesoscale: 500 m VIIRS or 250 m
 * SoilGrids onto 4 km), reduceResolution(mean) averages every source pixel
 * inside each cell — a representative value, not one arbitrary sub-pixel. The
 * scale is capped (see collectGrid) so the intermediate grid stays under EE's
 * reprojection-output limit. Absent → nearest sampling.
 */
function sampleRect(ee, image, eeRect, transform, reduceProj) {
  let img = image;
  if (reduceProj) {
    img = img.setDefaultProjection(reduceProj)
      .reduceResolution({ reducer: ee.Reducer.mean(), maxPixels: 65536, bestEffort: true });
  }
  return new Promise((resolve, reject) => {
    img.reproject('EPSG:4326', transform).toFloat()
      .sampleRectangle({ region: eeRect, defaultValue: SENTINEL })
      .getInfo((f, err) => (err ? reject(new Error(err)) : resolve(f && f.properties ? f.properties : {})));
  });
}

/** getRegion at a point → rows (the GRIDMET centroid series). */
function getRegion(collection, point, scale) {
  return new Promise((resolve, reject) => {
    collection.getRegion(point, scale).getInfo((data, err) => (err ? reject(new Error(err)) : resolve(data)));
  });
}

/** Crop a 2-D array to the top-left rows×cols block. */
function crop2d(arr, rows, cols) {
  const out = new Array(rows);
  for (let r = 0; r < rows; r++) out[r] = arr[r].slice(0, cols);
  return out;
}

/**
 * Collect the whole grid for one run. Returns everything run_grid.js needs:
 *   { rows, cols, soil, obsDates, viStack, dates, nViDates,
 *     weather }                 — centroid mode: array of engine weather rows
 *     weatherStacks }           — spatial mode: per-pixel Float32 stacks
 *
 * params: { rect:{west,south,east,north}, cols, rows, start, end, index,
 *           soilSource, vegSource, weatherMode, maxViDates, onProgress }
 */
export async function collectGrid(ee, params) {
  const { rect, cols: targetCols, rows: targetRows, start, end, index, maxViDates = 40, onProgress } = params;
  const soilSrc = params.soilSource;
  const say = (m) => onProgress && onProgress(m);
  const eeRect = ee.Geometry.Rectangle([rect.west, rect.south, rect.east, rect.north], null, false);
  const endExcl = addDaysISO(end, 1);

  /* One shared lat/lon grid for every source: the box's own degree extent
     divided by the requested pixel count, anchored at the top-left. */
  const centroid = { lat: 0.5 * (rect.south + rect.north), lon: 0.5 * (rect.west + rect.east) };
  const transform = [(rect.east - rect.west) / targetCols, 0, rect.west, 0, -(rect.north - rect.south) / targetRows, rect.north];
  /* Coarse grids (≥ ~1 km, mesoscale) mean-aggregate so each cell is
     representative; fine grids sample nearest. The aggregation input is capped
     at ~1/20 of a cell (≤ ~400 source pixels per cell) so the intermediate grid
     never exceeds EE's reprojection-output limit over a large area. */
  const cellM = (rect.north - rect.south) / targetRows * 111320;
  const coarse = cellM >= 1000;
  const aggProj = (nativeM) => ee.Projection('EPSG:4326').atScale(Math.max(nativeM || cellM, cellM / 20));

  /* ── Soil: sand / clay / organic matter as 0–15 cm (surface) and 0–100 cm
     (profile) depth means, all six bands in ONE image and ONE request (depth
     averaging is server-side; the soil fetch is the slow step). ─────────── */
  say(`Sampling ${soilSrc.label} soil texture…`);
  /* A projection built explicitly by scale is robust even when the source
     image reports no usable default projection. */
  const soilProj = coarse ? aggProj(soilSrc.nativeM || 250) : null;
  const keys = ['sand', 'clay', 'om'];
  const soilImg = ee.Image.cat(keys.map((k) =>
    soilSrc.propImage(ee, soilSrc.props[k]).rename([`${k}_surface`, `${k}_profile`])));
  const sp = await sampleRect(ee, soilImg, eeRect, transform, soilProj);

  /* Common shape (defensive crop) across the six returned bands. */
  let rows = Infinity, cols = Infinity;
  for (const k of keys) {
    for (const d of ['surface', 'profile']) {
      const a = sp[`${k}_${d}`];
      if (!a || !a.length) throw new Error(`${soilSrc.label} ${k} returned no pixels for this area.`);
      rows = Math.min(rows, a.length); cols = Math.min(cols, a[0].length);
    }
  }
  const band = (k, d) => flattenGrid(crop2d(sp[`${k}_${d}`], rows, cols)).data;
  const two = (k) => ({ surface: band(k, 'surface'), profile: band(k, 'profile') });
  const soil = soilLimitsFromBands(two('sand'), two('clay'), two('om'), soilSrc.conv);

  /* ── Vegetation index: clear observations, aligned to the soil grid ──────
     Driven by the veg source (veg_sources.js): collection, band name for the
     requested index, scale factor, optional QA band. The VI band is renamed
     'VI' (and QA 'QA') so this loop is source-agnostic. */
  const src = params.vegSource;
  const viBandName = src.bands[index] || src.bands.evi;
  say(`Finding ${src.label} observation dates…`);
  const selBands = src.qa ? [viBandName, src.qa.band] : [viBandName];
  const selNames = src.qa ? ['VI', 'QA'] : ['VI'];
  const coll = ee.ImageCollection(src.collection).filterDate(start, endExcl).filterBounds(eeRect).select(selBands, selNames);
  const viProj = coarse ? aggProj(src.nativeM || src.scaleM) : null;

  const stamps = await new Promise((res, rej) =>
    coll.aggregate_array('system:time_start').getInfo((d, e) => (e ? rej(new Error(e)) : res(d || []))));
  let datesAll = [...new Set(stamps.map((t) => new Date(t).toISOString().slice(0, 10)))].sort();
  if (datesAll.length > maxViDates) {
    const step = datesAll.length / maxViDates;
    datesAll = Array.from({ length: maxViDates }, (_, i) => datesAll[Math.floor(i * step)]);
  }

  const obsDates = [];
  const viStack = [];
  for (let i = 0; i < datesAll.length; i++) {
    const d = datesAll[i];
    say(`Sampling ${index.toUpperCase()} ${d} (${i + 1}/${datesAll.length})…`);
    const day = coll.filterDate(d, addDaysISO(d, 1)).mosaic();
    const props = await sampleRect(ee, day, eeRect, transform, viProj);
    if (!props.VI) continue;
    const viG = flattenGrid(crop2d(props.VI, rows, cols)).data;
    const qaG = src.qa ? flattenGrid(crop2d(props.QA, rows, cols)).data : null;
    const vi = viFromBands(viG, qaG, src.qa ? src.qa.max : 1, src.scaleFactor);
    if (vi.some((v) => Number.isFinite(v))) { obsDates.push(d); viStack.push(vi); }
  }
  if (!obsDates.length) throw new Error(`No clear ${src.label} observations in this area/period. Widen the dates.`);

  /* ── Weather: GRIDMET, either one centroid series (field scale, uniform) or
     a full per-pixel daily grid (mesoscale, where weather varies across the
     region). GRIDMET is ~4 km native, so a 4 km grid is a natural match. ───── */
  const gm = ee.ImageCollection('IDAHO_EPSCOR/GRIDMET').filterDate(start, endExcl).filterBounds(eeRect).select(['pr', 'eto', 'rmin', 'vs']);

  if (params.weatherMode === 'spatial') {
    const w = await collectWeatherSpatial(ee, gm, eeRect, transform, rows, cols, say);
    return { rows, cols, soil, obsDates, viStack, dates: w.dates, weatherStacks: w.stacks, nViDates: obsDates.length };
  }

  say('Requesting GRIDMET weather…');
  const gmArr = await getRegion(gm, ee.Geometry.Point([centroid.lon, centroid.lat]), 4000);
  const wx = gridmetToWeather(regionArrayToRows(gmArr));   /* {date, prcp, eto, rmin, wspd} */
  if (!wx.length) throw new Error('No GRIDMET weather for this area/period.');

  /* Engine rows; the season axis is the weather dates (GRIDMET is complete
     over CONUS). */
  const dates = wx.map((r) => r.date);
  const weather = wx.map((r) => ({ ETo: r.eto, prcp: r.prcp, wspd: r.wspd, rmin: r.rmin, irrig: 0 }));

  return { rows, cols, soil, obsDates, viStack, dates, weather, nViDates: obsDates.length };
}

/* FAO-56 Eq. 47: GRIDMET wind (10 m) → 2 m. */
const U10_TO_U2 = 4.87 / Math.log(67.8 * 10 - 5.42);

/**
 * Per-pixel daily GRIDMET on the shared grid. For each variable the season's
 * daily images are stacked into one multi-band image (toBands) and sampled in
 * a single request, so it's four requests total (pr / eto / rmin / vs) rather
 * than one per day. Bands are matched to dates by their YYYYMMDD id. Returns
 * { dates, stacks } where each stack is a Float32Array[day*nPixels + pixel].
 */
async function collectWeatherSpatial(ee, gm, eeRect, transform, rows, cols, say) {
  const stamps = await new Promise((res, rej) =>
    gm.aggregate_array('system:time_start').getInfo((d, e) => (e ? rej(new Error(e)) : res(d || []))));
  const dates = [...new Set(stamps.map((t) => new Date(t).toISOString().slice(0, 10)))].sort();
  if (!dates.length) throw new Error('No GRIDMET weather for this area/period.');
  const T = dates.length, nPixels = rows * cols;
  const ymds = dates.map((d) => d.replace(/-/g, ''));

  const bandMap = { eto: 'eto', prcp: 'pr', rmin: 'rmin', wspd: 'vs' };
  const stacks = {};
  for (const key of Object.keys(bandMap)) stacks[key] = new Float32Array(T * nPixels).fill(NaN);

  for (const [key, gmBand] of Object.entries(bandMap)) {
    say(`Sampling GRIDMET ${gmBand.toUpperCase()} (${T} days)…`);
    const stacked = gm.select(gmBand).toBands();          /* one band per day */
    const props = await sampleRect(ee, stacked, eeRect, transform);
    const keys = Object.keys(props);
    for (let t = 0; t < T; t++) {
      const bandKey = keys.find((k) => k.includes(ymds[t]));
      if (!bandKey || !props[bandKey]) continue;
      const grid = flattenGrid(crop2d(props[bandKey], rows, cols)).data;
      const base = t * nPixels;
      for (let p = 0; p < nPixels; p++) {
        const v = grid[p];
        if (!Number.isFinite(v) || v <= -9998) continue;   /* masked → NaN */
        stacks[key][base + p] = key === 'wspd' ? v * U10_TO_U2 : v;
      }
    }
  }
  return { dates, stacks };
}
