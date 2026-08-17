/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * cropSettings.js — Crop preset library, shared by every Oz module
 * (single season, probabilistic, rotation, ...).
 *
 * Kept as its own file so it can be edited (add a crop, retune a
 * coefficient) without touching engine or UI code. Each entry is a plain
 * object shaped to drop directly into engine.js's `crop` input:
 *
 *   Kcb_ini, Kcb_mid, Kcb_end   basal crop coefficients (FAO-56 Table 17)
 *   L_ini, L_dev, L_mid, L_late FAO-56 growth stage lengths, days
 *   Zr_ini, Zr_max              root depth range, m
 *   h_max                       maximum crop height, m
 *   p_tab                       FAO-56 Table 22 no-stress depletion fraction
 *   Ky, Ymax                    FAO-33 yield response factor / attainable
 *                               yield (kg/ha). Omitted for crops with no
 *                               established literature value (cover crops,
 *                               fallow) — engine.js's yield estimate
 *                               degrades to 0 gracefully when absent.
 *   CN                          SCS/NRCS Curve Number for runoff, per crop
 *                               (NRCS TR-55 Table 2-2, Hydrologic Soil
 *                               Group C, good hydrologic condition). Used
 *                               directly by the rotation module (each
 *                               stage's own CN); single-season/probabilistic
 *                               modes still take curve number from the
 *                               Management tab, using this only as the
 *                               default shown when a preset is selected.
 *   mode                        'annual' | 'perennial' | 'fallow' — a label
 *                               only engine.js's callers act on (the core
 *                               engine doesn't branch on it); the rotation
 *                               module uses it to decide how to build a
 *                               stage's Kcb/Zr default curves.
 *
 * Where the original Oz single-season library and the rotation-tool
 * library both had an entry for the same crop, Oz's tuned values were
 * kept and the rotation tool's CN was folded in (Oz didn't track CN per
 * crop before). Entries with no Oz precedent (extra cash crops, all cover
 * crops, fallow, perennial alfalfa) are carried over from the rotation
 * tool as-is.
 *
 * label/group/color are UI metadata (dropdown grouping, rotation-wheel
 * fill color); engine.js never reads them.
 */

export const CROPS = {
  // ── Cash crops (Oz values kept where an Oz entry already existed) ──────
  maize: {
    label: 'Corn (Maize)', group: 'Cash crops', color: '#E0A83A', mode: 'annual',
    Kcb_ini: 0.15, Kcb_mid: 1.15, Kcb_end: 0.50,
    L_ini: 30, L_dev: 40, L_mid: 50, L_late: 30,
    Zr_ini: 0.15, Zr_max: 1.7, h_max: 2.0, p_tab: 0.55,
    Ky: 1.25, Ymax: 11000.0, CN: 85, // row crop, good condition
  },
  wheat: {
    label: 'Winter Wheat', group: 'Cash crops', color: '#E6C55B', mode: 'annual',
    Kcb_ini: 0.15, Kcb_mid: 1.10, Kcb_end: 0.25,
    L_ini: 30, L_dev: 140, L_mid: 40, L_late: 30,
    Zr_ini: 0.15, Zr_max: 1.5, h_max: 1.0, p_tab: 0.55,
    Ky: 1.05, Ymax: 6000.0, CN: 83, // small grain, good condition
  },
  soybean: {
    label: 'Soybean', group: 'Cash crops', color: '#5B9A4D', mode: 'annual',
    Kcb_ini: 0.15, Kcb_mid: 1.10, Kcb_end: 0.30,
    L_ini: 20, L_dev: 30, L_mid: 60, L_late: 25,
    Zr_ini: 0.15, Zr_max: 1.3, h_max: 0.8, p_tab: 0.50,
    Ky: 0.85, Ymax: 3500.0, CN: 85, // row crop, good condition
  },
  sorghum: {
    label: 'Grain Sorghum', group: 'Cash crops', color: '#BF6A3A', mode: 'annual',
    Kcb_ini: 0.15, Kcb_mid: 1.05, Kcb_end: 0.40,
    L_ini: 20, L_dev: 35, L_mid: 45, L_late: 30,
    Zr_ini: 0.15, Zr_max: 1.5, h_max: 1.5, p_tab: 0.55,
    Ky: 0.90, Ymax: 6500.0, CN: 85, // row crop, good condition
  },
  sunflower: {
    label: 'Sunflower', group: 'Cash crops', color: '#ED8B1F', mode: 'annual',
    Kcb_ini: 0.15, Kcb_mid: 1.05, Kcb_end: 0.35,
    L_ini: 25, L_dev: 35, L_mid: 45, L_late: 25,
    Zr_ini: 0.15, Zr_max: 1.7, h_max: 2.0, p_tab: 0.45,
    Ky: 0.95, Ymax: 2500.0, CN: 85, // row crop, good condition
  },
  cotton: {
    label: 'Cotton', group: 'Cash crops', color: '#A6B79C', mode: 'annual',
    Kcb_ini: 0.15, Kcb_mid: 1.10, Kcb_end: 0.50,
    L_ini: 30, L_dev: 50, L_mid: 60, L_late: 55,
    Zr_ini: 0.15, Zr_max: 1.7, h_max: 1.5, p_tab: 0.65,
    Ky: 0.85, Ymax: 1600.0, CN: 85, // row crop, good condition
  },

  // ── Cash crops with no prior Oz entry (carried over from the rotation
  //    tool's library as-is) ──────────────────────────────────────────────
  potato: {
    label: 'Potato', group: 'Cash crops', color: '#8B5E3C', mode: 'annual',
    Kcb_ini: 0.15, Kcb_mid: 1.10, Kcb_end: 0.65,
    L_ini: 25, L_dev: 30, L_mid: 45, L_late: 30,
    Zr_ini: 0.10, Zr_max: 0.50, h_max: 0.6, p_tab: 0.35,
    Ky: 1.10, CN: 85, // row crop, good condition
  },
  tomato: {
    label: 'Tomato', group: 'Cash crops', color: '#D64E32', mode: 'annual',
    Kcb_ini: 0.15, Kcb_mid: 1.10, Kcb_end: 0.65,
    L_ini: 30, L_dev: 40, L_mid: 45, L_late: 30,
    Zr_ini: 0.10, Zr_max: 1.00, h_max: 0.6, p_tab: 0.40,
    Ky: 1.05, CN: 85, // row crop, good condition
  },
  rice: {
    label: 'Rice (paddy, approx.)', group: 'Cash crops', color: '#6FB1DE', mode: 'annual',
    Kcb_ini: 1.00, Kcb_mid: 1.15, Kcb_end: 0.80,
    L_ini: 30, L_dev: 30, L_mid: 60, L_late: 30,
    Zr_ini: 0.10, Zr_max: 0.50, h_max: 1.0, p_tab: 0.20,
    Ky: 1.10, CN: 85, // placeholder only — ponded-paddy hydrology isn't
    // modeled by this runoff/deficit-based water balance at all; Kcb_ini
    // reflects standing-water evaporation as a rough approximation.
  },
  sugarbeet: {
    label: 'Sugar beet', group: 'Cash crops', color: '#8E3B4E', mode: 'annual',
    Kcb_ini: 0.15, Kcb_mid: 1.15, Kcb_end: 0.50,
    L_ini: 25, L_dev: 35, L_mid: 50, L_late: 50,
    Zr_ini: 0.10, Zr_max: 1.00, h_max: 0.5, p_tab: 0.55,
    Ky: 1.00, CN: 85, // row crop, good condition
  },
  barley: {
    label: 'Barley', group: 'Cash crops', color: '#C7AD6E', mode: 'annual',
    Kcb_ini: 0.15, Kcb_mid: 1.10, Kcb_end: 0.15,
    L_ini: 15, L_dev: 25, L_mid: 50, L_late: 30,
    Zr_ini: 0.10, Zr_max: 1.30, h_max: 1.0, p_tab: 0.55,
    Ky: 1.00, CN: 83, // small grain, good condition
  },

  // ── Cover crops — typically terminated early rather than run to
  //    Kcb_end; termDayDefault/residueDaysDefault are rotation-module UI
  //    metadata, not engine.js inputs. No Ky/Ymax: yield isn't a
  //    meaningful concept for a crop grown for cover. rye/clover/covermix
  //    are fall-planted, overwintering covers; buckwheat/sorghumSudan/
  //    cowpea are warm-season covers grown within a single season. ────────
  rye: {
    label: 'Cereal rye (cover)', group: 'Cover crops', color: '#6E7F4A', mode: 'annual',
    Kcb_ini: 0.15, Kcb_mid: 0.95, Kcb_end: 0.85,
    L_ini: 20, L_dev: 40, L_mid: 60, L_late: 30,
    Zr_ini: 0.10, Zr_max: 0.60, h_max: 1.0, p_tab: 0.50,
    CN: 83, // small grain, good condition
    terminateDefault: true, termDayDefault: 90, residueDaysDefault: 20,
  },
  clover: {
    label: 'Crimson clover (cover)', group: 'Cover crops', color: '#B15C72', mode: 'annual',
    Kcb_ini: 0.15, Kcb_mid: 0.85, Kcb_end: 0.75,
    L_ini: 20, L_dev: 35, L_mid: 45, L_late: 25,
    Zr_ini: 0.10, Zr_max: 0.50, h_max: 0.3, p_tab: 0.50,
    CN: 81, // close-seeded legume, good condition
    terminateDefault: true, termDayDefault: 80, residueDaysDefault: 20,
  },
  covermix: {
    label: 'Mixed cover crop', group: 'Cover crops', color: '#82946A', mode: 'annual',
    Kcb_ini: 0.15, Kcb_mid: 0.90, Kcb_end: 0.80,
    L_ini: 20, L_dev: 35, L_mid: 55, L_late: 25,
    Zr_ini: 0.10, Zr_max: 0.55, h_max: 0.4, p_tab: 0.50,
    CN: 82, // grass/legume blend — midway between small-grain (83) and legume (81)
    terminateDefault: true, termDayDefault: 85, residueDaysDefault: 20,
  },
  buckwheat: {
    label: 'Buckwheat (summer cover)', group: 'Cover crops', color: '#C9A34A', mode: 'annual',
    Kcb_ini: 0.15, Kcb_mid: 0.95, Kcb_end: 0.85,
    L_ini: 10, L_dev: 20, L_mid: 20, L_late: 10, // fast warm-season broadleaf, terminated before seed set
    Zr_ini: 0.10, Zr_max: 0.40, h_max: 0.6, p_tab: 0.50,
    CN: 82, // broadleaf, dense stand — treated like covermix's grass/legume midpoint
    terminateDefault: true, termDayDefault: 55, residueDaysDefault: 15,
  },
  sorghumSudan: {
    label: 'Sorghum-sudangrass (summer cover)', group: 'Cover crops', color: '#9C6B30', mode: 'annual',
    Kcb_ini: 0.15, Kcb_mid: 1.05, Kcb_end: 0.70,
    L_ini: 15, L_dev: 25, L_mid: 35, L_late: 15, // tall warm-season grass, usually mowed/rolled before frost
    Zr_ini: 0.10, Zr_max: 1.00, h_max: 2.5, p_tab: 0.55,
    CN: 83, // dense warm-season grass, good condition
    terminateDefault: true, termDayDefault: 80, residueDaysDefault: 20,
  },
  cowpea: {
    label: 'Cowpea (summer cover)', group: 'Cover crops', color: '#6F8E4E', mode: 'annual',
    Kcb_ini: 0.15, Kcb_mid: 0.90, Kcb_end: 0.75,
    L_ini: 10, L_dev: 20, L_mid: 25, L_late: 15, // warm-season N-fixing legume, fast establishment
    Zr_ini: 0.10, Zr_max: 0.60, h_max: 0.4, p_tab: 0.50,
    CN: 81, // close-seeded legume, good condition — same row as clover/alfalfa
    terminateDefault: true, termDayDefault: 65, residueDaysDefault: 15,
  },
  oats: {
    label: 'Oats (cover)', group: 'Cover crops', color: '#B7A65C', mode: 'annual',
    Kcb_ini: 0.15, Kcb_mid: 0.95, Kcb_end: 0.90,
    L_ini: 20, L_dev: 35, L_mid: 45, L_late: 25, // fall-planted, overwintering — like rye/clover/covermix
    Zr_ini: 0.10, Zr_max: 0.50, h_max: 0.8, p_tab: 0.50,
    CN: 83, // small grain, good condition
    terminateDefault: true, termDayDefault: 80, residueDaysDefault: 18,
  },
  radish: {
    label: 'Forage radish (cover)', group: 'Cover crops', color: '#9C6B8C', mode: 'annual',
    Kcb_ini: 0.15, Kcb_mid: 0.80, Kcb_end: 0.75,
    L_ini: 15, L_dev: 25, L_mid: 30, L_late: 20, // fall-planted, winterkills readily — residue life is short
    Zr_ini: 0.10, Zr_max: 0.60, h_max: 0.4, p_tab: 0.50,
    CN: 82, // brassica, treated as close-seeded/non-legume broadleaf
    terminateDefault: true, termDayDefault: 60, residueDaysDefault: 10,
  },

  // ── Generic starting point for a user-defined crop ──────────────────────
  custom: {
    label: 'Custom crop\u2026', group: 'Other', color: '#7C5C99', mode: 'annual',
    Kcb_ini: 0.15, Kcb_mid: 1.10, Kcb_end: 0.40,
    L_ini: 25, L_dev: 35, L_mid: 40, L_late: 30,
    Zr_ini: 0.15, Zr_max: 1.2, h_max: 1.0, p_tab: 0.50,
    Ky: 1.00, Ymax: 5000.0, CN: 85, // adjust freely — this is just a starting point
  },
};

// Convenience list form, e.g. for populating a dropdown.
export const CROP_LIST = Object.keys(CROPS).map((id) => Object.assign({ id }, CROPS[id]));

/** Look up a crop by id. Returns undefined if not found. */
export function getCrop(id) {
  return CROPS[id];
}

// ---------------------------------------------------------------------------
// Perennial, multi-cut crop (alfalfa) — doesn't fit the annual
// ini/dev/mid/late stage shape, so the rotation module models it as
// repeated short cutting cycles (each a normal engine.js stage, chained by
// stitching Kcb/Zr arrays the same way any other stage sequence is). Use
// mode: 'perennial' for every cycle, establishment and every regrowth cut
// alike — no mode-switching needed. Roots only grow when a cycle's Zr_ini
// is below Zr_max:
//   - the establishment cycle sets Zr_ini low (e.g. 0.10) and L_ini/L_dev
//     to the real ramp-up period — Zr grows to Zr_max once.
//   - every cycle after that sets Zr_ini to Zr_max (the depth already
//     reached) — the ramp collapses to zero length and Zr just stays flat,
//     matching the fact that cutting doesn't touch the roots.
// For single-season/probabilistic use, CROPS has a separate, simpler
// "alfalfa" entry below shaped like any other annual crop (a single-season
// approximation); this preset is specifically for the rotation module's
// multi-cut modeling.
// ---------------------------------------------------------------------------

CROPS.alfalfa = {
  label: 'Alfalfa', group: 'Cash crops', color: '#3F7A4C', mode: 'annual',
  Kcb_ini: 0.30, Kcb_mid: 1.10, Kcb_end: 1.05,
  L_ini: 10, L_dev: 30, L_mid: 100, L_late: 10,
  Zr_ini: 0.15, Zr_max: 2.0, h_max: 0.7, p_tab: 0.55,
  Ky: 1.10, Ymax: 16000.0, CN: 81, // close-seeded legume/forage, good condition
};

export const ALFALFA_PRESET = {
  label: 'Alfalfa (perennial, multi-cut)', color: '#3F7A4C',
  mode: 'perennial',
  Kcb_ini: 0.15,                 // establishment cycle's starting point only
  Kcb_low: 0.15, Kcb_peak: 1.05, // regrowth ramp, used every cycle
  iniDays: 5, intervalDays: 30, numCuts: 5,
  Zr_ini: 0.10, Zr_max: 1.40,
  h_max: 0.7, p_tab: 0.55, Ky: 1.10,
  CN: 81, // close-seeded legume/forage, good condition
};
export const ALFALFA_MAX_CUTS = 6; // typical upper bound for one season

// ---------------------------------------------------------------------------
// Fallow (bare soil, no crop)
// ---------------------------------------------------------------------------

/**
 * A fallow stage: Kcb/fc are flat zero, h_max is 0 (no canopy to apply the
 * wind/humidity correction to). Included here as explicit, readable zeros
 * for the rotation module to build a stage from; engine.js has no special
 * 'fallow' handling of its own — the rotation module just supplies flat
 * Kcb=0/fc=0/Zr=Ze arrays like it would for any other stage.
 */
export const FALLOW_PRESET = {
  label: 'Fallow', color: '#C9A876', mode: 'fallow',
  Kcb_ini: 0.0, Kcb_mid: 0.0, Kcb_end: 0.0,
  Zr_ini: 0.0, Zr_max: 0.0,
  h_max: 0.0, p_tab: 0.5,
  CN: 91, // bare soil, good condition — matches this preset's 0%-residue-cover default
  duration: 60, // default fallow length, days — purely a UI default
};
