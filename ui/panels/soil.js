/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * panels/soil.js — shared soil panel, sidebar edition. One multi-point
 * slider per layer (surface, root zone, subsoil) carries θ_wp ≤ θ_ini ≤
 * θ_fc on a fixed 0–0.6 m³/m³ track with the plant-available band shaded,
 * replacing a stack of numeric boxes. The few remaining scalars (Ze, REW
 * fraction, profile depth) stay as small inputs.
 */

import { SOIL_LIST, getSoil } from '../../core/soilSettings.js';
import { el } from '../dom.js';
import { numInput, selectInput, ctrl, subhead } from '../components.js';
import { createMultiSlider } from '../multiSlider.js';

const THETA_MAX = 0.6;

const SCALARS = [
  { key: 'Ze', label: 'Evap. depth Ze', unit: 'm', step: 0.01 },
  { key: 'REW_frac', label: 'REW / TEW', unit: '–', step: 0.05 },
  { key: 'Zr_profile', label: 'Profile depth', unit: 'm', step: 0.1 },
];

export function createSoilPanel({ onChange } = {}) {
  /* Seed the live soil object BEFORE building the sliders — their markers
     read v.* on first refresh, so v must already hold finite values. */
  const v = { ...getSoil('siltLoam') };
  const scalarInputs = {};

  const preset = selectInput({
    options: SOIL_LIST.map(s => ({ value: s.id, label: s.label })),
    value: 'siltLoam',
    onChange: (id) => { applyPreset(id); changed(); refreshAll(); },
  });

  /* Surface layer: wp, ini, fc */
  const surfaceSlider = createMultiSlider({
    min: 0, max: THETA_MAX, onChange: () => { preset.set('custom'); changed(); },
    markers: [
      { id: 'surface_wp', band: true, get: () => v.surface_wp, set: (x) => { v.surface_wp = x; } },
      { id: 'surface_ini', get: () => v.surface_ini, set: (x) => { v.surface_ini = x; } },
      { id: 'surface_fc', band: true, get: () => v.surface_fc, set: (x) => { v.surface_fc = x; } },
    ],
  });
  /* Root zone layer: wp, ini, fc */
  const rootSlider = createMultiSlider({
    min: 0, max: THETA_MAX, onChange: () => { preset.set('custom'); changed(); refreshSubsoil(); },
    markers: [
      { id: 'rootzone_wp', band: true, get: () => v.rootzone_wp, set: (x) => { v.rootzone_wp = x; } },
      { id: 'rootzone_ini', get: () => v.rootzone_ini, set: (x) => { v.rootzone_ini = x; } },
      { id: 'rootzone_fc', band: true, get: () => v.rootzone_fc, set: (x) => { v.rootzone_fc = x; } },
    ],
  });
  /* Subsoil: only θ_ini, bounded by the root-zone wp..fc it shares. */
  const subsoilSlider = createMultiSlider({
    min: 0, max: THETA_MAX, onChange: () => { preset.set('custom'); changed(); },
    markers: [
      { id: 'subsoil_ini', get: () => v.subsoil_ini, set: (x) => { v.subsoil_ini = x; },
        loFn: () => v.rootzone_wp, hiFn: () => v.rootzone_fc },
    ],
  });

  const scalarRows = SCALARS.map(f => {
    scalarInputs[f.key] = numInput({ step: f.step, min: 0, onChange: () => { preset.set('custom'); v[f.key] = scalarInputs[f.key].get(); changed(); } });
    return ctrl(f.label, scalarInputs[f.key].el, { unit: f.unit });
  });

  const root = el('div', {},
    ctrl('Texture', preset.el),
    subhead('Surface layer  ·  θwp / θini / θfc'),
    surfaceSlider.el,
    subhead('Root zone  ·  θwp / θini / θfc'),
    rootSlider.el,
    subhead('Subsoil  ·  θini'),
    subsoilSlider.el,
    subhead('Layers & profile'),
    ...scalarRows,
  );

  function applyPreset(id) {
    const s = getSoil(id);
    if (!s) return;
    Object.assign(v, s);
    for (const f of SCALARS) scalarInputs[f.key].set(v[f.key]);
  }

  function refreshSubsoil() {
    /* keep subsoil_ini within the root zone's (possibly moved) wp..fc */
    v.subsoil_ini = Math.min(Math.max(v.subsoil_ini, v.rootzone_wp), v.rootzone_fc);
    subsoilSlider.refresh();
  }
  function refreshAll() { surfaceSlider.refresh(); rootSlider.refresh(); subsoilSlider.refresh(); }

  function changed() { onChange && onChange(); }

  applyPreset('siltLoam');
  refreshAll();

  return {
    el: root,
    get() { return { ...v }; },
    set(soil, presetId) {
      Object.assign(v, soil);
      for (const f of SCALARS) if (soil[f.key] !== undefined) scalarInputs[f.key].set(soil[f.key]);
      preset.set(presetId || 'custom');
      refreshAll();
    },
    getPresetId: () => preset.get(),
    hint() { const s = getSoil(preset.get()); return s ? s.label : 'custom'; },
  };
}
