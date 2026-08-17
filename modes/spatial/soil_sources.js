/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * modes/spatial/soil_sources.js — the registry of soil datasets.
 *
 * Like veg_sources.js, adding a soil product is a config entry. Each source
 * builds, for a property (sand / clay / organic matter), a TWO-band image whose
 * depth means are computed server-side:
 *   surface — thickness-weighted mean over 0–15 cm (the evaporation layer, Ze)
 *   profile — thickness-weighted mean over 0–100 cm (the root-zone proxy, Zr)
 * Doing the depth averaging in Earth Engine (rather than fetching all six depth
 * layers and averaging on the client) cuts the download and the coarse-grid
 * aggregation to two bands per property — the soil fetch is the slow step, so
 * this is where the time goes. ee_data.js samples the image; assemble.js runs
 * the Saxton-Rawls PTF on each depth mean to get FC/WP.
 *
 * A soil source is paired with a veg source (veg_sources.js `soil` field) so it
 * matches the run's resolution: POLARIS (30 m, CONUS) with the 30 m Landsat
 * field runs, SoilGrids (250 m, global) with the mesoscale runs.
 */

import { SOILGRIDS_CONV, SOILGRIDS_DEPTH } from './assemble.js';

/* Depth layers and their thicknesses (cm). Surface = 0–15 cm; profile = 0–100. */
const SURFACE = [['0_5', 5], ['5_15', 10]];
const PROFILE = [['0_5', 5], ['5_15', 10], ['15_30', 15], ['30_60', 30], ['60_100', 40]];

/** Thickness-weighted mean of a set of depth bands → a single-band image. */
function wmean(band, layers) {
  const total = layers.reduce((a, [, w]) => a + w, 0);
  let sum = band(layers[0][0]).multiply(layers[0][1]);
  for (let i = 1; i < layers.length; i++) sum = sum.add(band(layers[i][0]).multiply(layers[i][1]));
  return sum.divide(total);
}

/** [surface, profile] depth-mean bands for a property, given a per-depth accessor. */
function twoBand(band) {
  return wmean(band, SURFACE).rename('surface').addBands(wmean(band, PROFILE).rename('profile'));
}

/* POLARIS: sand/clay in %, organic matter as log10(%) → 10^v. (CONUS only.) */
const POLARIS_CONV = {
  sand: (v) => v,
  clay: (v) => v,
  om: (v) => Math.pow(10, v),
};

export const SOIL_SOURCES = {
  soilgrids: {
    id: 'soilgrids',
    label: 'SoilGrids (ISRIC, 250 m)',
    nativeM: 250,
    props: { sand: 'sand', clay: 'clay', om: 'soc' },   /* om derives from soc */
    conv: SOILGRIDS_CONV,
    /* One image per property carries a band per depth. */
    propImage(ee, eeProp) {
      const img = ee.Image(`projects/soilgrids-isric/${eeProp}_mean`);
      return twoBand((id) => img.select(`${eeProp}_${SOILGRIDS_DEPTH[id]}_mean`));
    },
  },
  polaris: {
    id: 'polaris',
    label: 'POLARIS (30 m)',
    nativeM: 30,
    props: { sand: 'sand', clay: 'clay', om: 'om' },
    conv: POLARIS_CONV,
    /* POLARIS is an ImageCollection per property, one image per depth. */
    propImage(ee, eeProp) {
      const coll = ee.ImageCollection(`projects/sat-io/open-datasets/polaris/${eeProp}_mean`);
      return twoBand((id) => ee.Image(coll.filter(ee.Filter.stringContains('system:index', id)).first()));
    },
  },
};

export function getSoilSource(id) {
  return SOIL_SOURCES[id] || SOIL_SOURCES.soilgrids;
}
