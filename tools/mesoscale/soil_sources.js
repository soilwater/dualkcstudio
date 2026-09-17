/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/mesoscale/soil_sources.js — Mesoscale's soil registry.
 *
 * Owned by Mesoscale alone (Field Scale has its own copy). SoilGrids (ISRIC,
 * 250 m, global) is the mesoscale soil source — it mean-aggregates gently onto
 * the coarse grids. Each source builds, for a property (sand / clay / organic
 * matter), a TWO-band image whose depth means are computed server-side:
 *   surface — thickness-weighted mean over 0–15 cm (the evaporation layer, Ze)
 *   profile — thickness-weighted mean over 0–100 cm (the root-zone proxy, Zr)
 * Doing the depth averaging in Earth Engine (rather than fetching all six depth
 * layers and averaging on the client) cuts the download and the coarse-grid
 * aggregation to two bands per property — the soil fetch is the slow step, so
 * this is where the time goes. ee_data.js samples the image; assemble.js runs
 * the Saxton-Rawls PTF on each depth mean to get FC/WP.
 */

import { SOILGRIDS_CONV, SOILGRIDS_DEPTH } from '../spatial_shared/assemble.js';

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

export const SOIL_SOURCES = {
  soilgrids: {
    id: 'soilgrids',
    label: 'SoilGrids (250 m, global)',
    region: 'global',
    nativeM: 250,
    props: { sand: 'sand', clay: 'clay', om: 'soc' },   /* om derives from soc */
    conv: SOILGRIDS_CONV,
    /* One image per property carries a band per depth. */
    propImage(ee, eeProp) {
      const img = ee.Image(`projects/soilgrids-isric/${eeProp}_mean`);
      return twoBand((id) => img.select(`${eeProp}_${SOILGRIDS_DEPTH[id]}_mean`));
    },
    note: 'ISRIC SoilGrids 250 m soil texture → field capacity and wilting point via Saxton-Rawls, sampled per pixel across the region.',
  },
};

export const SOIL_SOURCES_LIST = Object.values(SOIL_SOURCES);

export function getSoilSource(id) {
  return SOIL_SOURCES[id] || SOIL_SOURCES.soilgrids;
}
