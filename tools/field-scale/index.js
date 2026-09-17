/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/field-scale/index.js — the Field Scale tool.
 *
 * Draw or upload a real field (30 m or 10 m), pick a period and crop/management
 * settings, and run the FAO-56 dual-Kc balance per pixel. No region picker or
 * grid-resolution steps — a county is a Mesoscale object (see tools/mesoscale).
 *
 * Built from the shared spatial factory (tools/spatial_shared/spatial_tool.js),
 * but with Field Scale's OWN vegetation/soil registries and Earth Engine
 * acquisition injected here. Those files live under this directory, so changing
 * a Field Scale data source cannot reach Mesoscale.
 */

import { createSpatialTool } from '../spatial_shared/spatial_tool.js';
import { FIELD_SOURCES, getVegSource } from './veg_sources.js';
import { SOIL_SOURCES_LIST, getSoilSource } from './soil_sources.js';
import { WEATHER_SOURCES_LIST, getWeatherSource } from './weather_sources.js';
import { collectGrid } from './ee_data.js';
import { DOCS } from './docs.js';

export default createSpatialTool({
  title: 'Field Scale',
  docs: DOCS,
  sources: FIELD_SOURCES,
  getVegSource,
  soilSources: SOIL_SOURCES_LIST,
  getSoilSource,
  soilAdjust: true,          /* FC/WP calibration offsets in the Soil group */
  weatherSources: WEATHER_SOURCES_LIST,
  getWeatherSource,
  collectGrid,
});
