/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * panels/soil.js — shared soil panel, sidebar edition. A single multi-point
 * slider carries θ_wp ≤ θ_ini ≤ θ_fc on a fixed 0–0.6 m³/m³ track with the
 * plant-available band shaded. FAO-56 treats the soil as one homogeneous layer,
 * so there is a single field capacity / wilting point for the whole profile
 * (evaporation layer, root zone and subsoil alike); for a stratified profile,
 * enter a depth-weighted value over the root zone. The few remaining scalars
 * (Ze, REW fraction, profile depth) stay as small inputs.
 */

import { SOIL_LIST, getSoil } from '../../core/soilSettings.js';
import { el } from '../dom.js';
import { numInput, selectInput, ctrl, subhead } from '../components.js';
import { createMultiSlider } from '../multiSlider.js';

const THETA_MAX = 0.6;

const SCALARS = [
  { key: 'Ze', label: 'Evap. depth Ze', unit: 'm', step: 0.01 },
  { key: 'REW_frac', label: 'REW / TEW', unit: '0–1', step: 0.05, min: 0, max: 1, title: 'Readily-evaporable fraction of total evaporable water' },
  { key: 'Zr_profile', label: 'Profile depth', unit: 'm', step: 0.1 },
];

export function createSoilPanel({ onChange } = {}) {
  /* Seed the live soil object BEFORE building the slider — its markers read
     v.* on first refresh, so v must already hold finite values. */
  const v = { ...getSoil('siltLoam') };
  const scalarInputs = {};

  const preset = selectInput({
    options: SOIL_LIST.map(s => ({ value: s.id, label: s.label })),
    value: 'siltLoam',
    onChange: (id) => { applyPreset(id); changed(); refreshAll(); },
  });

  /* One slider for the whole profile: wp, ini, fc. */
  const thetaSlider = createMultiSlider({
    min: 0, max: THETA_MAX, onChange: () => { preset.set('custom'); changed(); },
    markers: [
      { id: 'wp', band: true, get: () => v.wp, set: (x) => { v.wp = x; } },
      { id: 'ini', get: () => v.ini, set: (x) => { v.ini = x; } },
      { id: 'fc', band: true, get: () => v.fc, set: (x) => { v.fc = x; } },
    ],
  });

  const scalarRows = SCALARS.map(f => {
    scalarInputs[f.key] = numInput({ step: f.step, min: 0, onChange: () => { preset.set('custom'); v[f.key] = scalarInputs[f.key].get(); changed(); } });
    return ctrl(f.label, scalarInputs[f.key].el, { unit: f.unit });
  });

  const root = el('div', {},
    ctrl('Texture', preset.el),
    subhead('Soil water  ·  θwp / θini / θfc  (m³/m³)'),
    thetaSlider.el,
    el('div', { class: 'hint', style: { marginTop: '0.3rem', lineHeight: '1.4' } },
      'A single field capacity and wilting point for the whole profile (FAO-56). For a layered soil, enter a depth-weighted value over the root zone.'),
    subhead('Layers & profile'),
    ...scalarRows,
  );

  function applyPreset(id) {
    const s = getSoil(id);
    if (!s) return;
    Object.assign(v, s);
    for (const f of SCALARS) scalarInputs[f.key].set(v[f.key]);
  }

  function refreshAll() { thetaSlider.refresh(); }

  function changed() { onChange && onChange(); }

  applyPreset('siltLoam');
  refreshAll();

  return {
    el: root,
    get() { return { ...v }; },
    set(soil, presetId) {
      /* Copy only the soil fields the model uses (retention θ + scalars); any
         other keys are ignored, so the live object always holds exactly the
         engine's soil shape. */
      for (const k of ['fc', 'wp', 'ini']) if (Number.isFinite(soil[k])) v[k] = soil[k];
      for (const f of SCALARS) if (Number.isFinite(soil[f.key])) { v[f.key] = soil[f.key]; scalarInputs[f.key].set(soil[f.key]); }
      preset.set(presetId || 'custom');
      refreshAll();
    },
    getPresetId: () => preset.get(),
    hint() { const s = getSoil(preset.get()); return s ? s.label : 'custom'; },
  };
}
