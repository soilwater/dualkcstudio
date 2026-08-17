/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * workbench.js — the shared shell for an analysis mode: a compact control
 * sidebar on the left (scrolling list of groups + a pinned footer for the
 * run bar) and a tabbed canvas on the right (Inputs / Outputs), with a
 * header strip for dataset info. Modes fill in the pieces; the frame,
 * tab-switching, and empty states are handled here.
 *
 * Returns:
 *   el            the whole .view
 *   sidebar       append control group()s here (scrolls)
 *   foot          sidebar footer (put the run bar here)
 *   head          canvas header strip (dataset summary chips)
 *   inputs        Inputs-tab body (weather-data plots)
 *   outputs       Outputs-tab body (results)
 *   showTab(name) 'inputs' | 'outputs'
 *   setOutputsEnabled(bool)
 */

import { el } from './dom.js';

export function createWorkbench({ inputsLabel = 'Inputs', outputsLabel = 'Outputs' } = {}) {
  const sidebar = el('div', { class: 'sidebar__scroll' });
  const foot = el('div', { class: 'sidebar__foot' });

  const head = el('div', { class: 'canvas__head' });
  const inputs = el('div', { class: 'canvas__pane canvas__body' });
  const outputs = el('div', { class: 'canvas__pane canvas__body', hidden: true });

  const tabInputs = el('button', { class: 'canvas__tab is-active', type: 'button', onclick: () => showTab('inputs') }, inputsLabel);
  const tabOutputs = el('button', { class: 'canvas__tab', type: 'button', disabled: true, onclick: () => showTab('outputs') }, outputsLabel);

  function showTab(name) {
    const isOut = name === 'outputs';
    if (isOut && tabOutputs.disabled) return;
    tabInputs.classList.toggle('is-active', !isOut);
    tabOutputs.classList.toggle('is-active', isOut);
    inputs.hidden = isOut;
    outputs.hidden = !isOut;
    /* charts in the newly shown pane were laid out while hidden → re-fit */
    window.dispatchEvent(new Event('resize'));
  }

  function setOutputsEnabled(on) {
    tabOutputs.disabled = !on;
  }

  /* The mode wraps this in the single .view the router toggles; don't add a
     second .view here or the router can't hide it. */
  const el_ = el('div', { class: 'workbench' },
    el('aside', { class: 'sidebar' }, sidebar, foot),
    el('div', { class: 'canvas' },
      el('div', { class: 'canvas__tabs' }, tabInputs, tabOutputs, el('div', { class: 'canvas__tabsp' })),
      head,
      inputs,
      outputs,
    ),
  );

  return { el: el_, sidebar, foot, head, inputs, outputs, showTab, setOutputsEnabled };
}
