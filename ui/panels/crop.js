/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * panels/crop.js — shared crop panel, sidebar edition. The draggable Kcb
 * curve sits inline in the sidebar as the primary control; a preset select
 * is above it and an "Edit values…" modal holds the full numeric parameter
 * set for precise entry. Curve and fields stay in two-way sync.
 */

import { CROPS, CROP_LIST } from '../../core/cropSettings.js';
import { el } from '../dom.js';
import { numInput, selectInput, ctrl, readout, btn, openModal } from '../components.js';
import { createKcbEditor } from '../curveEditor.js';

const CURVE_KEYS = ['Kcb_ini', 'Kcb_mid', 'Kcb_end', 'L_ini', 'L_dev', 'L_mid', 'L_late'];

const NUM_FIELDS = [
  { key: 'Kcb_ini', label: 'Kcb ini', step: 0.01, min: 0 },
  { key: 'Kcb_mid', label: 'Kcb mid', step: 0.01, min: 0 },
  { key: 'Kcb_end', label: 'Kcb end', step: 0.01, min: 0 },
  { key: 'L_ini', label: 'L ini', unit: 'd', step: 1, min: 1 },
  { key: 'L_dev', label: 'L dev', unit: 'd', step: 1, min: 1 },
  { key: 'L_mid', label: 'L mid', unit: 'd', step: 1, min: 1 },
  { key: 'L_late', label: 'L late', unit: 'd', step: 1, min: 1 },
  { key: 'Zr_ini', label: 'Root ini', unit: 'm', step: 0.05, min: 0 },
  { key: 'Zr_max', label: 'Root max', unit: 'm', step: 0.1, min: 0.05 },
  { key: 'h_max', label: 'Canopy h', unit: 'm', step: 0.1, min: 0.05 },
  { key: 'p_tab', label: 'Depletion p', unit: '–', step: 0.05, min: 0.1, max: 0.8 },
  { key: 'fc_max', label: 'Max cover', unit: '–', step: 0.01, min: 0.1, max: 0.99 },
  { key: 'Ky', label: 'Yield Ky', unit: '–', step: 0.05, min: 0 },
  { key: 'Ymax', label: 'Yield max', unit: 'kg/ha', step: 100, min: 0 },
];

const PRESETS = CROP_LIST.filter(c => c.mode !== 'fallow');

export function createCropPanel({ onChange, onPresetChange } = {}) {
  const inputs = {};
  let updating = false;

  const preset = selectInput({
    options: PRESETS.map(c => ({ value: c.id, label: c.label, group: c.group })),
    value: 'maize',
    onChange: (id) => { applyPreset(id); onPresetChange && onPresetChange(CROPS[id]); changed(); },
  });

  const editor = createKcbEditor({
    values: pickCurve(CROPS.maize),
    onChange: (val, { live }) => {
      updating = true;
      for (const k of CURVE_KEYS) if (inputs[k]) inputs[k].set(val[k]);
      updating = false;
      seasonRO.set(seasonLength(), 'd');
      if (!live) { preset.set(findMatchingPreset() || preset.get()); changed(); }
    },
  });

  /* Build the numeric fields once; they live in the modal (created on demand). */
  for (const f of NUM_FIELDS) {
    inputs[f.key] = numInput({
      step: f.step, min: f.min, max: f.max,
      onChange: () => { if (updating) return; preset.set(findMatchingPreset() || 'custom'); editor.set(pickCurve(get())); changed(); },
    });
  }

  const seasonRO = readout('Season length', { unit: 'd' });

  const root = el('div', {},
    ctrl('Crop', preset.el),
    editor.el,
    el('div', { style: { marginTop: '0.3rem' } }, seasonRO.el),
    el('div', { style: { marginTop: '0.5rem' } }, btn('Edit values…', { small: true, block: true, onClick: openValues })),
  );

  function pickCurve(src) { const o = {}; for (const k of CURVE_KEYS) o[k] = src[k]; return o; }

  function applyPreset(id) {
    const c = CROPS[id];
    if (!c) return;
    updating = true;
    for (const f of NUM_FIELDS) inputs[f.key].set(c[f.key] !== undefined ? c[f.key] : (f.key === 'fc_max' ? 0.99 : undefined));
    updating = false;
    editor.set(pickCurve(c));
    seasonRO.set(seasonLength(), 'd');
  }

  function findMatchingPreset() {
    const id = preset.get();
    const c = CROPS[id];
    if (!c) return null;
    return CURVE_KEYS.every(k => Math.abs(inputs[k].get() - c[k]) < 1e-9) ? id : null;
  }

  function seasonLength() { return ['L_ini', 'L_dev', 'L_mid', 'L_late'].reduce((s, k) => s + (inputs[k].get() || 0), 0); }

  function get() {
    const c = {};
    for (const f of NUM_FIELDS) { const val = inputs[f.key].get(); if (isFinite(val)) c[f.key] = val; }
    const p = CROPS[preset.get()];
    c.label = p ? p.label : 'Custom crop';
    return c;
  }

  function openValues() {
    const grid = el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.15rem 1rem' } },
      NUM_FIELDS.map(f => ctrl(f.label, inputs[f.key].el, { unit: f.unit || '' })));
    openModal('Crop parameters', grid);
  }

  function changed() { seasonRO.set(seasonLength(), 'd'); onChange && onChange(); }

  applyPreset('maize');

  return {
    el: root,
    get,
    seasonLength,
    getPresetId: () => preset.get(),
    set(crop, presetId) {
      updating = true;
      for (const f of NUM_FIELDS) if (crop[f.key] !== undefined) inputs[f.key].set(crop[f.key]);
      updating = false;
      if (presetId) preset.set(presetId);
      editor.set(pickCurve({ ...CROPS[preset.get()], ...crop }));
      seasonRO.set(seasonLength(), 'd');
    },
    hint() { const p = CROPS[preset.get()]; return `${p ? p.label.replace(/\s*\(.*\)/, '') : 'custom'} · ${seasonLength()}d`; },
    setRefLines(lines) { editor.setRefLines(lines); },
  };
}
