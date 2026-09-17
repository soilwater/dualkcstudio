/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/field-scale/soil_sources.js — Field Scale's soil registry.
 *
 * Owned by Field Scale alone (Mesoscale has its own copy). POLARIS (30 m, CONUS)
 * is the default; SoilGrids (250 m, global) is offered for fields outside CONUS.
 * Like veg_sources.js, adding a soil product is a config entry. Each source
 * builds, for a property (sand / clay / organic matter), a SINGLE-band image
 * whose value is the thickness-weighted 0–100 cm depth mean, computed
 * server-side. FAO-56 uses one field capacity / wilting point for the whole
 * homogeneous profile, so a single depth-weighted texture is all that's needed;
 * assemble.js runs the Saxton-Rawls PTF on it to get FC/WP.
 */

import { SOILGRIDS_CONV, SOILGRIDS_DEPTH } from '../spatial_shared/assemble.js';

/* Depth layers and their thicknesses (cm) for the 0–100 cm root-zone mean. */
const PROFILE = [['0_5', 5], ['5_15', 10], ['15_30', 15], ['30_60', 30], ['60_100', 40]];

/** Thickness-weighted mean of a set of depth bands → a single-band image. */
function wmean(band, layers) {
  const total = layers.reduce((a, [, w]) => a + w, 0);
  let sum = band(layers[0][0]).multiply(layers[0][1]);
  for (let i = 1; i < layers.length; i++) sum = sum.add(band(layers[i][0]).multiply(layers[i][1]));
  return sum.divide(total);
}

/** The 0–100 cm depth-mean band for a property, given a per-depth accessor. */
function profileBand(band) {
  return wmean(band, PROFILE);
}

/* POLARIS: sand/clay in %, organic matter as log10(%) → 10^v. (CONUS only.) */
const POLARIS_CONV = {
  sand: (v) => v,
  clay: (v) => v,
  om: (v) => Math.pow(10, v),
};

/* Order = dropdown order; the first entry is the default (POLARIS: the CONUS
   default, matching the US-first stack). SoilGrids is the global fallback. */
export const SOIL_SOURCES = {
  polaris: {
    id: 'polaris',
    label: 'POLARIS (30 m, CONUS)',
    region: 'conus',
    nativeM: 30,
    props: { sand: 'sand', clay: 'clay', om: 'om' },
    conv: POLARIS_CONV,
    /* POLARIS is an ImageCollection per property, one image per depth. */
    propImage(ee, eeProp) {
      const coll = ee.ImageCollection(`projects/sat-io/open-datasets/polaris/${eeProp}_mean`);
      return profileBand((id) => ee.Image(coll.filter(ee.Filter.stringContains('system:index', id)).first()));
    },
    note: 'POLARIS 30 m soil texture (sand / clay / organic matter) → field capacity and wilting point via Saxton-Rawls. CONUS only.',
  },
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
      return profileBand((id) => img.select(`${eeProp}_${SOILGRIDS_DEPTH[id]}_mean`));
    },
    note: 'ISRIC SoilGrids 250 m soil texture → field capacity and wilting point via Saxton-Rawls. Global — use for fields outside CONUS.',
  },
};

export const SOIL_SOURCES_LIST = Object.values(SOIL_SOURCES);

export function getSoilSource(id) {
  return SOIL_SOURCES[id] || SOIL_SOURCES.polaris;
}
