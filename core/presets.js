/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * presets.js — The options object, and the one place that says what is
 * FAO-56 and what is not.
 *
 * engine.js runs the manual's soil water balance. STRICT_OPTIONS is that
 * balance with nothing added, so a UI's "reset to strict FAO-56" button is
 * `options = { ...STRICT_OPTIONS }`.
 *
 * Three things are always on and are NOT switchable, because they are
 * bookkeeping rather than physics choices:
 *
 *   - The three-compartment profile (rootZone.js). FAO-56 leaves the water
 *     content below the root zone undefined; every implementation has to
 *     assume something. Assuming field capacity, or the root zone's own
 *     water content, both make Ks invariant to root growth. Tracking the
 *     subsoil explicitly is the only assumption that lets a crop find water
 *     by rooting deeper, and it costs one state variable.
 *   - Charging the root zone with the full ETc = (Kcb + Ke) ETo, per
 *     Eq. 85. Soil evaporation depletes the profile. This is the manual.
 *   - Residue cover reducing TEW by 5% per 10% of soil surface covered,
 *     REW capped at TEW. This is the manual's own guidance (p. 208, in the
 *     discussion of Eq. 73), not a departure from it.
 *
 * Two things are always on and ARE departures from the manual, flagged
 * here so nobody has to read engine.js to find out:
 *
 *   - SCS Curve Number runoff. FAO-56 Ch. 8 treats runoff as a caller-
 *     supplied input and does not specify a method. CN is a defensible
 *     choice; it is not the manual's.
 *   - Canopy height derived from Kcb when `crop.h` is not supplied. The
 *     manual takes h as a measured input (see curves.js). Supply `crop.h`
 *     and this departure disappears.
 */

export const STRICT_OPTIONS = Object.freeze({
  // ── Canopy cover, fc (FAO-56 Eq. 76) ────────────────────────────────────
  // 'height' — the manual's exponent 1 + 0.5h. Kept as the default: it's the
  //            literal equation, and the case against it (below) is from a
  //            single crop/site.
  // 'kcb'    — exponent fixed at 1: fc is a straight rescaling of Kcb
  //            between bare soil and full cover, no height needed. Six
  //            seasons of maize (Trout & DeJonge 2018) fit this shape with
  //            R^2 = 0.91, better than 'height's convex curve at maize
  //            height — worth choosing explicitly for row crops. See
  //            curves.js's fcFromKcb.
  fcModel: 'height',

  // ── Kcb curve shape (FAO-56 Fig. 36) ────────────────────────────────────
  // false = flat at Kcb_ini through the initial stage (the manual).
  // true  = linear from 0 at planting to Kcb_ini (closer to transpiration).
  // Ignored, with a warning, when crop.Kcb is supplied as an array.
  kcbStartsAtZero: false,

  // ── Climate adjustment of tabulated Kcb_mid/Kcb_end (Eq. 70) ────────────
  // In the manual, but only meaningful for TABULATED values, so it is off
  // by default and ignored, with a warning, when crop.Kcb is an array.
  // Rotation callers should use curves.js's adjustKcbForClimate per stage.
  climateAdjustKcb: false,

  // ── Transpiration from the evaporating layer, Tew (FAO-56 Eq. 77) ───────
  // The manual names this term and then sets it to zero: "Except for
  // shallow rooted crops (... maximum rooting depth < 0.5-0.6 m), the
  // amount of transpiration from the evaporating soil layer is small and
  // can be ignored." Off by default for that reason.
  //
  // It moves a Ze/Zr share of T from the root-zone book into the surface
  // book. Because Eq. 85 charges the root zone with the full ETc either
  // way, this cannot change how much water leaves the profile — it only
  // dries the surface faster, which lowers Kr and suppresses E. That
  // feedback is the entire effect.
  surfaceTranspiration: false,

  // ── Deep diffusive/vapour loss from below Ze ────────────────────────────
  // Not in the manual. Once the surface layer is exhausted FAO-56 has no
  // mechanism left to dry the profile, yet a rainless multi-month fallow
  // keeps drying as the vapour-pressure gradient pulls moisture up from
  // depth. This adds that flux.
  //
  // The coefficient is a lumped surrogate for vapour transport, NOT a
  // capillary rise (CR) term. 0.01 comes from Lollato et al. (2016,
  // Agron. J. 108:745-757) for southern Great Plains summer fallow — but
  // it was fitted inside a model where soil evaporation already depleted
  // the profile, so re-fit it against your own data before trusting the
  // default anywhere else.
  deepDiffusiveLoss: false,
  deepDiffusiveCoeff: 0.01,
});

/** Every extension switched on. Convenience only; not a recommendation. */
export const ENHANCED_OPTIONS = Object.freeze({
  ...STRICT_OPTIONS,
  kcbStartsAtZero: true,
  surfaceTranspiration: true,
  deepDiffusiveLoss: true,
});

const VALID_FC_MODELS = ['height', 'kcb'];

/** Merges user options onto the strict baseline and rejects unknown keys. */
export function resolveOptions(userOptions) {
  let opts = { ...STRICT_OPTIONS, ...(userOptions || {}) };

  let keys = Object.keys(opts);
  let unknown = [];
  for (let i = 0; i < keys.length; i++) {
    if (!(keys[i] in STRICT_OPTIONS)) unknown.push(keys[i]);
  }
  if (unknown.length) {
    throw new Error(`Unknown option(s): ${unknown.join(', ')}. Valid options: ${Object.keys(STRICT_OPTIONS).join(', ')}.`);
  }
  if (!VALID_FC_MODELS.includes(opts.fcModel)) {
    throw new Error(`options.fcModel must be one of ${VALID_FC_MODELS.join(' | ')}, got "${opts.fcModel}".`);
  }
  return opts;
}
