/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * soilSettings.js — Soil texture preset library, shared by every Oz module.
 *
 * Kept as its own file so it can be edited (retune a texture, add one)
 * without touching engine or UI code. Each entry is shaped to drop
 * directly into engine.js's `soil` input:
 *
 *   fc          field capacity, m³/m³ — a single value for the whole
 *               homogeneous profile (evaporation layer, root zone, subsoil)
 *   wp          wilting point, m³/m³ — likewise a single value
 *   ini         initial water content, m³/m³ (wp ≤ ini ≤ fc)
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
 * FAO-56 treats the soil as a single homogeneous layer with one fc/wp. Where
 * a real profile is stratified, enter a depth-weighted value over the root
 * zone (this is what pyfao56 and the manual do).
 */

export const SOILS = {
  clay: {
    label: 'Clay',
    fc: 0.42, wp: 0.22, ini: 0.35,
    Ze: 0.10, REW_frac: 0.45, Zr_profile: 1.8,
  },
  siltyClayLoam: {
    label: 'Silty Clay Loam',
    fc: 0.38, wp: 0.19, ini: 0.30,
    Ze: 0.10, REW_frac: 0.50, Zr_profile: 1.8,
  },
  siltLoam: {
    label: 'Silt Loam',
    fc: 0.33, wp: 0.13, ini: 0.26,
    Ze: 0.12, REW_frac: 0.55, Zr_profile: 1.8,
  },
  clayLoam: {
    label: 'Clay Loam',
    fc: 0.36, wp: 0.18, ini: 0.29,
    Ze: 0.10, REW_frac: 0.48, Zr_profile: 1.8,
  },
  loam: {
    label: 'Loam',
    fc: 0.31, wp: 0.12, ini: 0.25,
    Ze: 0.12, REW_frac: 0.55, Zr_profile: 1.8,
  },
  sandyLoam: {
    label: 'Sandy Loam',
    fc: 0.22, wp: 0.08, ini: 0.18,
    Ze: 0.15, REW_frac: 0.60, Zr_profile: 1.8,
  },
  sand: {
    label: 'Sand',
    fc: 0.12, wp: 0.04, ini: 0.10,
    Ze: 0.15, REW_frac: 0.65, Zr_profile: 1.8,
  },
  custom: {
    label: 'Custom',
    fc: 0.31, wp: 0.12, ini: 0.25,
    Ze: 0.12, REW_frac: 0.55, Zr_profile: 1.8,
  },
};

// Convenience list form, e.g. for populating a dropdown.
export const SOIL_LIST = Object.keys(SOILS).map((id) => Object.assign({ id }, SOILS[id]));

/** Look up a soil texture by id. Returns undefined if not found. */
export function getSoil(id) {
  return SOILS[id];
}
