/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/mesoscale/index.js — the mesoscale (4 km) tool.
 *
 * Same engine, map, draw tools and results as Field Scale — only the dataset
 * differs (VIIRS EVI on a 4 km grid over SoilGrids, per-pixel GRIDMET, up to
 * 250,000 km²). Built from the shared spatial factory, so there is no
 * duplicated UI or model code.
 */

import { createSpatialTool } from '../field-scale/index.js';
import { MESO_SOURCES } from '../field-scale/veg_sources.js';
import { DOCS } from './docs.js';

export default createSpatialTool({ title: 'Mesoscale', docs: DOCS, sources: MESO_SOURCES });
