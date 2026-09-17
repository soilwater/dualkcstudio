/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/mesoscale/index.js — the Mesoscale tool.
 *
 * Same shared factory, map, draw tools and results as Field Scale — but with
 * Mesoscale's OWN vegetation/soil registries and Earth Engine acquisition
 * (VIIRS EVI over SoilGrids, per-pixel GRIDMET), plus a region picker (county /
 * state / ASD) and a selectable grid resolution (500 m–4 km). All of this layer
 * lives under this directory, so a change to Field Scale's data sources cannot
 * reach Mesoscale.
 */

import { createSpatialTool } from '../spatial_shared/spatial_tool.js';
import { MESO_SOURCES, getVegSource } from './veg_sources.js';
import { SOIL_SOURCES_LIST, getSoilSource } from './soil_sources.js';
import { WEATHER_SOURCES_LIST, getWeatherSource } from './weather_sources.js';
import { collectGrid } from './ee_data.js';
import { DOCS } from './docs.js';

/* Mesoscale offers the region picker (county / state / ASD) and a grid-
   resolution selector. 500 m is VIIRS EVI's native cell (finer would just
   upsample the vegetation index); 1000 m and 4000 m mean-aggregate up, with
   4000 m matching GRIDMET. Pick a resolution that suits the region size — a
   county is fine at 500 m, a whole state at 4000 m. There is no area cap;
   Earth Engine enforces its own limits at run time. */
export default createSpatialTool({
  title: 'Mesoscale',
  docs: DOCS,
  sources: MESO_SOURCES,
  getVegSource,
  soilSources: SOIL_SOURCES_LIST,
  getSoilSource,
  weatherSources: WEATHER_SOURCES_LIST,
  getWeatherSource,
  collectGrid,
  resolutions: [500, 1000, 4000],
  boundaryLevels: ['counties', 'asd', 'states'],
});
