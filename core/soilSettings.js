/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * soilSettings.js — Soil texture preset library, shared by every Oz module.
 *
 * Kept as its own file so it can be edited (retune a texture, add one)
 * without touching engine or UI code. Each entry is shaped to drop
 * directly into engine.js's `soil` input:
 *
 *   surface_fc, surface_wp, surface_ini   surface (evaporation) layer
 *   rootzone_fc, rootzone_wp, rootzone_ini root-zone layer
 *   subsoil_ini                           subsoil layer initial water
 *                                          content — engine.js's soil
 *                                          water balance always tracks a
 *                                          three-layer profile now
 *   Ze          evaporation layer depth, m
 *   REW_frac    readily evaporable water as a fraction of totally
 *               evaporable water (REW / TEW); engine.js derives REW/TEW
 *               itself from fc/wp/Ze/REW_frac and residue cover
 *   Zr_profile  total soil profile depth, m — sizes the subsoil
 *               compartment (Zr_profile − Zr). A sensible general default
 *               is included per texture but should be set explicitly for
 *               a real site, especially for rotations, since it's a fixed
 *               physical property of the field, not of whichever crop
 *               happens to be growing.
 *
 * Surface and root-zone layers are set independently — real profiles are
 * rarely uniform with depth (e.g. a looser surface horizon over a denser
 * subsoil). These presets fill both with the same fc/wp as a reasonable
 * default for a broadly uniform soil; edit layer-specific values directly
 * where site data supports it (Soil tab help has more on this).
 */

export const SOILS = {
  clay: {
    label: 'Clay',
    surface_fc: 0.42, surface_wp: 0.22, surface_ini: 0.35,
    rootzone_fc: 0.42, rootzone_wp: 0.22, rootzone_ini: 0.35, subsoil_ini: 0.35,
    Ze: 0.10, REW_frac: 0.45, Zr_profile: 1.8,
  },
  siltyClayLoam: {
    label: 'Silty Clay Loam',
    surface_fc: 0.38, surface_wp: 0.19, surface_ini: 0.30,
    rootzone_fc: 0.38, rootzone_wp: 0.19, rootzone_ini: 0.30, subsoil_ini: 0.30,
    Ze: 0.10, REW_frac: 0.50, Zr_profile: 1.8,
  },
  siltLoam: {
    label: 'Silt Loam',
    surface_fc: 0.33, surface_wp: 0.13, surface_ini: 0.26,
    rootzone_fc: 0.33, rootzone_wp: 0.13, rootzone_ini: 0.26, subsoil_ini: 0.26,
    Ze: 0.12, REW_frac: 0.55, Zr_profile: 1.8,
  },
  clayLoam: {
    label: 'Clay Loam',
    surface_fc: 0.36, surface_wp: 0.18, surface_ini: 0.29,
    rootzone_fc: 0.36, rootzone_wp: 0.18, rootzone_ini: 0.29, subsoil_ini: 0.29,
    Ze: 0.10, REW_frac: 0.48, Zr_profile: 1.8,
  },
  loam: {
    label: 'Loam',
    surface_fc: 0.31, surface_wp: 0.12, surface_ini: 0.25,
    rootzone_fc: 0.31, rootzone_wp: 0.12, rootzone_ini: 0.25, subsoil_ini: 0.25,
    Ze: 0.12, REW_frac: 0.55, Zr_profile: 1.8,
  },
  sandyLoam: {
    label: 'Sandy Loam',
    surface_fc: 0.22, surface_wp: 0.08, surface_ini: 0.18,
    rootzone_fc: 0.22, rootzone_wp: 0.08, rootzone_ini: 0.18, subsoil_ini: 0.18,
    Ze: 0.15, REW_frac: 0.60, Zr_profile: 1.8,
  },
  sand: {
    label: 'Sand',
    surface_fc: 0.12, surface_wp: 0.04, surface_ini: 0.10,
    rootzone_fc: 0.12, rootzone_wp: 0.04, rootzone_ini: 0.10, subsoil_ini: 0.10,
    Ze: 0.15, REW_frac: 0.65, Zr_profile: 1.8,
  },
  custom: {
    label: 'Custom',
    surface_fc: 0.31, surface_wp: 0.12, surface_ini: 0.25,
    rootzone_fc: 0.31, rootzone_wp: 0.12, rootzone_ini: 0.25, subsoil_ini: 0.25,
    Ze: 0.12, REW_frac: 0.55, Zr_profile: 1.8,
  },
};

// Convenience list form, e.g. for populating a dropdown.
export const SOIL_LIST = Object.keys(SOILS).map((id) => Object.assign({ id }, SOILS[id]));

/** Look up a soil texture by id. Returns undefined if not found. */
export function getSoil(id) {
  return SOILS[id];
}
