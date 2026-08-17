/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * panels/management.js — shared management panel, sidebar edition: surface
 * condition (residue, curve number) and irrigation strategy as compact
 * rows. Emits an engine-shaped management object; the scheduled-mode day
 * list is synthesized from the interval at run time.
 */

import { IRRIG_METHODS, IRRIG_METHOD_NAMES } from '../../core/appConstants.js';
import { el } from '../dom.js';
import { numInput, selectInput, segmented, ctrl, subhead } from '../components.js';

const IRRIG_MODES = [
  { value: 'rainfed', label: 'Rainfed' },
  { value: 'manual', label: 'Data' },
  { value: 'auto', label: 'Auto' },
  { value: 'scheduled', label: 'Interval' },
];

export function createManagementPanel({ onChange, irrigation = true } = {}) {
  const residueIn = numInput({ value: 0, min: 0, max: 100, step: 5, onChange: changed });
  const cnIn = numInput({ value: 85, min: 30, max: 98, step: 1, onChange: changed });
  const madIn = numInput({ value: 50, min: 5, max: 95, step: 5, onChange: changed });
  const amountIn = numInput({ value: 25, min: 1, step: 1, onChange: changed });
  const delayIn = numInput({ value: 3, min: 0, step: 1, onChange: changed });
  const intervalIn = numInput({ value: 7, min: 1, step: 1, onChange: changed });
  const allocIn = numInput({ min: 0, step: 10, placeholder: '∞', onChange: changed });
  const effIn = numInput({ value: 0.9, min: 0.1, max: 1, step: 0.05, onChange: changed });
  const methodSel = selectInput({
    options: IRRIG_METHOD_NAMES.map(n => ({ value: n, label: n.replace(/\s*\(.*\)/, '') })),
    value: IRRIG_METHOD_NAMES[0], onChange: changed,
  });

  const modeSeg = segmented({ options: IRRIG_MODES, value: 'rainfed', full: true, onChange: () => { syncVisibility(); changed(); } });

  const autoRows = el('div', {}, ctrl('MAD trigger', madIn.el, { unit: '%' }), ctrl('Min. spacing', delayIn.el, { unit: 'd' }));
  const schedRows = el('div', {}, ctrl('Every', intervalIn.el, { unit: 'd' }));
  const commonRows = el('div', {},
    ctrl('Amount / event', amountIn.el, { unit: 'mm' }),
    ctrl('Efficiency', effIn.el, { unit: '0–1' }),
    ctrl('Allocation', allocIn.el, { unit: 'mm' }),
    ctrl('Method', methodSel.el, { help: 'Sets the wetted soil fraction fw: sprinkler 1.00, furrow 0.70, drip 0.35.' }),
  );
  const manualNote = el('div', { class: 'hint' }, 'Uses the irrig column from the CSV as-is.');

  const irrigBlock = el('div', {},
    subhead('Irrigation'),
    ctrl('Mode', modeSeg.el, { stack: true }),
    manualNote, autoRows, schedRows, commonRows,
  );

  const root = el('div', {},
    ctrl('Residue cover', residueIn.el, { unit: '%', title: 'Fraction of soil surface covered by residue' }),
    ctrl('Curve number', cnIn.el, { unit: 'CN', title: 'SCS/NRCS runoff curve number' }),
    irrigation ? irrigBlock : null,
  );

  function syncVisibility() {
    const m = modeSeg.get();
    manualNote.hidden = m !== 'manual';
    autoRows.hidden = m !== 'auto';
    schedRows.hidden = m !== 'scheduled';
    commonRows.hidden = m === 'rainfed' || m === 'manual';
  }

  function changed() { onChange && onChange(); }

  function getManagement(numDays) {
    const mode = irrigation ? modeSeg.get() : 'rainfed';
    const mgmt = { residue_cover: (residueIn.get() || 0) / 100, curve_number: cnIn.get(), irrigation_mode: mode };
    if (mode === 'auto' || mode === 'scheduled') {
      mgmt.fw = IRRIG_METHODS[methodSel.get()];
      mgmt.irrig_efficiency = effIn.get();
      const alloc = allocIn.get();
      if (isFinite(alloc) && alloc > 0) mgmt.irrig_allocation = alloc;
    }
    if (mode === 'auto') { mgmt.mad = (madIn.get() || 50) / 100; mgmt.irrig_amount = amountIn.get(); mgmt.irrig_delay = delayIn.get() || 0; }
    if (mode === 'scheduled') {
      const every = Math.max(1, Math.round(intervalIn.get() || 7));
      mgmt.irrig_amount = amountIn.get();
      mgmt.irrig_schedule = [];
      for (let d = every; d < (numDays || 0); d += every) mgmt.irrig_schedule.push(d);
    }
    return mgmt;
  }

  function setCurveNumber(cn) { if (isFinite(cn)) cnIn.set(cn); }

  syncVisibility();

  return {
    el: root,
    getManagement, setCurveNumber,
    hint() {
      const m = irrigation ? modeSeg.get() : 'rainfed';
      return { rainfed: 'rainfed', manual: 'irrig: data', auto: 'auto irrig', scheduled: 'interval' }[m];
    },
    getRaw: () => ({ residue_pct: residueIn.get(), curve_number: cnIn.get(), mode: modeSeg.get(), mad_pct: madIn.get(), amount: amountIn.get(), delay: delayIn.get(), interval: intervalIn.get(), allocation: allocIn.get(), efficiency: effIn.get(), method: methodSel.get() }),
    setRaw(r) {
      if (!r) return;
      if (isFinite(r.residue_pct)) residueIn.set(r.residue_pct);
      if (isFinite(r.curve_number)) cnIn.set(r.curve_number);
      if (r.mode) modeSeg.set(r.mode);
      if (isFinite(r.mad_pct)) madIn.set(r.mad_pct);
      if (isFinite(r.amount)) amountIn.set(r.amount);
      if (isFinite(r.delay)) delayIn.set(r.delay);
      if (isFinite(r.interval)) intervalIn.set(r.interval);
      if (isFinite(r.allocation)) allocIn.set(r.allocation);
      if (isFinite(r.efficiency)) effIn.set(r.efficiency);
      if (r.method) methodSel.set(r.method);
      syncVisibility();
    },
  };
}
