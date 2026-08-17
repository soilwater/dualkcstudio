/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * index.js — Public API for /core/model. Tools should import from here and
 * not reach into individual files.
 */

export { runModel } from './engine.js';

export { STRICT_OPTIONS, ENHANCED_OPTIONS, resolveOptions } from './presets.js';

// Series builders. Whatever runModel can generate internally, a caller can
// generate with these and pass in as crop.Kcb / crop.Zr / crop.h / crop.fc —
// which is how a rotation is assembled without a second code path.
export {
  kcbFlat,
  kcbRampFromZero,
  resolveKcbFn,
  kcbArray,
  rootDepthArray,
  canopyHeightArray,
  fcFromKcb,
  kcMax,
  adjustKcbForClimate,
  adjustCropForClimate,
  estimateYield,
} from './curves.js';

export { makeSoilProfile, rootWater } from './rootZone.js';

export { penmanMonteithDaily, ensureEToComputed } from './eto.js';
export { getDayOfYear, parseUtcParts, toUtcTimestamp } from './dateUtils.js';
