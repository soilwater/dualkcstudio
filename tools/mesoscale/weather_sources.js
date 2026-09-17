/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/mesoscale/weather_sources.js — Mesoscale's weather (atmosphere) registry.
 *
 * Owned by Mesoscale alone (Field Scale has its own copy). Mesoscale runs the
 * per-pixel 'spatial' mode, so its weather source must be spatial-capable — a
 * single point source (e.g. Open-Meteo) does not belong here. Adding a coarse
 * gridded weather product is a config entry; ee_data.js reads it generically.
 *
 * See tools/field-scale/weather_sources.js for the full field reference.
 */

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
    spatialBandMap: { eto: 'eto', prcp: 'pr', rmin: 'rmin', wspd: 'vs' },
    windTo2m: true,
    note: 'GRIDMET ~4 km daily grass reference ET and precipitation, sampled per pixel across the region. CONUS only.',
  },
};

export const WEATHER_SOURCES_LIST = Object.values(WEATHER_SOURCES);

export function getWeatherSource(id) {
  return WEATHER_SOURCES[id] || WEATHER_SOURCES.gridmet;
}
