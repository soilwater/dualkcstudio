/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * panels/options.js — shared model-options panel, sidebar edition. Strict
 * FAO-56 is the baseline; each switch here is one of the documented optional
 * departures in core/presets.js, shown as checkbox rows.
 */

import { STRICT_OPTIONS, ENHANCED_OPTIONS } from '../../core/index.js';
import { el } from '../dom.js';
import { numInput, selectInput, ctrl, checkbox, btn, subhead } from '../components.js';

export function createOptionsPanel({ onChange } = {}) {
  const fcModelSel = selectInput({
    options: [
      { value: 'height', label: 'Canopy height' },
      { value: 'kcb', label: 'Linear in Kcb' },
    ],
    value: STRICT_OPTIONS.fcModel, onChange: changed,
  });
  const FC_HELP = {
    height: 'Strict FAO-56 Eq. 76 (fc from canopy height).',
    kcb: 'fc scales linearly with Kcb — better for row crops (Trout & DeJonge 2018).',
  };
  const fcHelp = el('div', { class: 'ctrl__help' }, FC_HELP[STRICT_OPTIONS.fcModel]);
  const coeffIn = numInput({ value: STRICT_OPTIONS.deepDiffusiveCoeff, min: 0, max: 0.2, step: 0.005, onChange: changed });
  const coeffRow = ctrl('Diffusive coeff.', coeffIn.el, { unit: '–' });
  coeffRow.hidden = true;

  const checks = {
    kcbStartsAtZero: checkbox({ label: 'Kcb ramps from zero at planting', onChange: changed }),
    climateAdjustKcb: checkbox({ label: 'Climate-adjust tabulated Kcb', onChange: changed }),
    surfaceTranspiration: checkbox({ label: 'Transpiration from evap. layer', onChange: changed }),
    deepDiffusiveLoss: checkbox({ label: 'Deep diffusive / vapour loss', onChange: (val) => { coeffRow.hidden = !val; changed(); } }),
  };

  /* The climate adjustment (FAO-56 Eq. 70) needs real wind & RHmin; without
     them the loader falls back to the standard climate and the adjustment is
     a no-op, so the mode disables this box and explains why. */
  const climateNote = el('div', { class: 'ctrl__help is-warn', hidden: true }, 'Needs wind & RHmin columns — using standard climate.');

  const root = el('div', {},
    el('div', { class: 'row', style: { gap: '0.4rem', marginBottom: '0.4rem' } },
      btn('Strict FAO-56', { kind: 'neon', small: true, onClick: () => setOptions(STRICT_OPTIONS) }),
      btn('All on', { small: true, onClick: () => setOptions(ENHANCED_OPTIONS) }),
    ),
    el('div', { class: 'ctrl-wrap' }, ctrl('Canopy cover fc', fcModelSel.el), fcHelp),
    subhead('Optional departures'),
    checks.kcbStartsAtZero.el,
    el('div', {}, checks.climateAdjustKcb.el, climateNote),
    checks.surfaceTranspiration.el,
    checks.deepDiffusiveLoss.el,
    coeffRow,
  );

  function setClimateAdjustAvailable(on) {
    climateNote.hidden = on;
    const input = checks.climateAdjustKcb.el.querySelector('input');
    if (input) input.disabled = !on;
    checks.climateAdjustKcb.el.style.opacity = on ? '' : '0.55';
    if (!on && checks.climateAdjustKcb.get()) { checks.climateAdjustKcb.set(false); changed(); }
  }

  function setOptions(opts) {
    fcModelSel.set(opts.fcModel);
    for (const [k, c] of Object.entries(checks)) c.set(!!opts[k]);
    coeffIn.set(opts.deepDiffusiveCoeff ?? STRICT_OPTIONS.deepDiffusiveCoeff);
    coeffRow.hidden = !opts.deepDiffusiveLoss;
    changed();
  }

  function get() {
    const o = { fcModel: fcModelSel.get(), deepDiffusiveCoeff: isFinite(coeffIn.get()) ? coeffIn.get() : STRICT_OPTIONS.deepDiffusiveCoeff };
    for (const [k, c] of Object.entries(checks)) o[k] = c.get();
    return o;
  }

  function isStrict() { const o = get(); return Object.keys(STRICT_OPTIONS).every(k => o[k] === STRICT_OPTIONS[k]); }
  function changed() { fcHelp.textContent = FC_HELP[fcModelSel.get()]; onChange && onChange(); }

  return { el: root, get, set: setOptions, setClimateAdjustAvailable, hint: () => (isStrict() ? 'strict FAO-56' : 'extended') };
}
