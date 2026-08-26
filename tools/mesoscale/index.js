/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/mesoscale/index.js — the mesoscale tool.
 *
 * Same engine, map, draw tools and results as Field Scale — the dataset differs
 * (VIIRS EVI over SoilGrids, per-pixel GRIDMET), plus a region picker (county /
 * state / ASD) and a selectable grid resolution (500 m–4 km). Built from the
 * shared spatial factory, so there is no duplicated UI or model code.
 */

import { createSpatialTool } from '../field-scale/index.js';
import { MESO_SOURCES } from '../field-scale/veg_sources.js';
import { DOCS } from './docs.js';

/* Mesoscale offers the region picker (county / state / ASD) and a grid-
   resolution selector. 500 m is VIIRS EVI's native cell (finer would just
   upsample the vegetation index); 1000 m and 4000 m mean-aggregate up, with
   4000 m matching GRIDMET. Pick a resolution that suits the region size — a
   county is fine at 500 m, a whole state at 4000 m. There is no area cap;
   Earth Engine enforces its own limits at run time. */
export default createSpatialTool({
  title: 'Mesoscale', docs: DOCS, sources: MESO_SOURCES,
  resolutions: [500, 1000, 4000],
  boundaryLevels: ['counties', 'asd', 'states'],
});
