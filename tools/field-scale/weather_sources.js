/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/field-scale/weather_sources.js — Field Scale's weather (atmosphere)
 * registry: the third data layer alongside veg_sources.js (Plant) and
 * soil_sources.js (Soil). Owned by Field Scale alone (Mesoscale has its own
 * copy), so adding a global weather option here cannot reach Mesoscale.
 *
 * ee_data.js dispatches on the selected source; a source declares HOW it is
 * fetched and how its columns map to the engine's, not the sampling mechanics.
 *
 * Fields
 *   region   — 'conus' (CONUS-only, e.g. GRIDMET) or 'global'
 *   modes    — the run modes it supports: 'centroid' (one point series, broadcast
 *              across the field) and/or 'spatial' (per-pixel daily grid). A field
 *              run is 'centroid'; a mesoscale run is 'spatial'. OpenMeteo is a
 *              single point, so it is centroid-only.
 *   kind     — 'ee' (Earth Engine ImageCollection) or 'fetch' (a plain REST call,
 *              no Earth Engine)
 *
 *   kind 'ee':
 *     collection      — Earth Engine ImageCollection id
 *     bands           — bands to select for the centroid getRegion series
 *     scale           — getRegion sampling scale (m), ~the source's native cell
 *     toRows(arr)     — getRegion().getInfo() array → engine rows
 *                       [{ date, eto, prcp, wspd, rmin }] (wind already at 2 m)
 *     spatialBandMap  — engine key → source band, for the per-pixel stacks
 *     windTo2m        — true to convert 10 m wind → 2 m in the spatial stacks
 *
 *   kind 'fetch':
 *     fetchCentroid({ lat, lon, start, end }) → the same engine rows, resolved
 *       from a REST API at the field centroid (no Earth Engine).
 */

import { regionArrayToRows, gridmetToWeather } from '../gee-collector/gee.js';

/* Open-Meteo archive: FAO-56 reference ET comes straight from the API, so no
   Penman-Monteith is computed here. Same variables and 10 m→2 m wind factor as
   the standalone Open-Meteo tool (tools/open-meteo). One request per run. */
const OPEN_METEO_URL = 'https://archive-api.open-meteo.com/v1/archive';
const OPEN_METEO_DAILY = [
  'precipitation_sum',
  'et0_fao_evapotranspiration',
  'wind_speed_10m_mean',
  'relative_humidity_2m_min',
];
const WIND_10M_TO_2M = 0.748;   /* FAO-56 Eq. 47 */
const num = (v) => (v == null || !isFinite(+v) ? NaN : +v);

async function fetchOpenMeteoDaily({ lat, lon, start, end }) {
  const url = `${OPEN_METEO_URL}?latitude=${lat}&longitude=${lon}`
    + `&start_date=${start}&end_date=${end}`
    + `&daily=${OPEN_METEO_DAILY.join(',')}&wind_speed_unit=ms&timezone=UTC`;
  const res = await fetch(url);
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.reason || `HTTP ${res.status}`); }
  const d = (await res.json()).daily;
  if (!d || !d.time) return [];
  return d.time.map((date, i) => {
    const w = num(d.wind_speed_10m_mean?.[i]);
    return {
      date,
      eto: num(d.et0_fao_evapotranspiration?.[i]),
      prcp: num(d.precipitation_sum?.[i]),
      wspd: isFinite(w) ? +(w * WIND_10M_TO_2M).toFixed(2) : NaN,
      rmin: num(d.relative_humidity_2m_min?.[i]),
    };
  });
}

export const WEATHER_SOURCES = {
  gridmet: {
    id: 'gridmet',
    label: 'GRIDMET (CONUS only)',
    region: 'conus',
    modes: ['centroid', 'spatial'],
    kind: 'ee',
    collection: 'IDAHO_EPSCOR/GRIDMET',
    bands: ['pr', 'eto', 'rmin', 'vs'],
    scale: 4000,
    toRows: (arr) => gridmetToWeather(regionArrayToRows(arr)),
    spatialBandMap: { eto: 'eto', prcp: 'pr', rmin: 'rmin', wspd: 'vs' },
    windTo2m: true,
    note: 'GRIDMET ~4 km daily grass reference ET and precipitation. CONUS only. The field uses one series at the centroid.',
  },
  openmeteo: {
    id: 'openmeteo',
    label: 'OpenMeteo (Global)',
    region: 'global',
    modes: ['centroid'],
    kind: 'fetch',
    fetchCentroid: fetchOpenMeteoDaily,
    note: 'Open-Meteo daily FAO-56 reference ET and precipitation at the field centroid, anywhere on Earth (one point series, assumed uniform over the field). Use outside CONUS.',
  },
};

export const WEATHER_SOURCES_LIST = Object.values(WEATHER_SOURCES);

export function getWeatherSource(id) {
  return WEATHER_SOURCES[id] || WEATHER_SOURCES.gridmet;
}
