/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/soil-limits/index.js — a lookup: pick a texture class and a source,
 * see the wilting point and field capacity, with a note on how they were
 * derived. All values are pre-computed in limits.json; this file just looks
 * them up.
 */

import { el } from '../../ui/dom.js';
import { selectInput, metricsBar, callout } from '../../ui/components.js';
import { DOCS } from './docs.js';

/* The note under the cards: how field capacity is defined for the chosen
   source. Retention-curve sources (Scott, Parker, Rosetta) use −10 kPa. */
const FC_NOTE = {
  fao56: 'Class-mean values from Table 19 of the FAO-56 manual (Allen et al., 1998).',
  saxton: 'Field capacity estimated as the water retained at −33 kPa.',
  unit1: 'Field capacity taken as the water content where drainage falls to about 1 mm/day.',
};
const FC_NOTE_RETENTION = 'Field capacity estimated as the water retained at −10 kPa — recent evidence supports this as a better proxy for field capacity than the traditional −33 kPa (Krueger & Ochsner, 2024).';

function create() {
  let DB = null;

  const classSel = selectInput({ options: [], onChange: render });
  const sourceSel = selectInput({ options: [], onChange: render });
  const metrics = metricsBar([]);
  const naEl = el('div', {});
  const noteEl = el('div', { class: 'hint', style: { marginTop: '0.9rem', lineHeight: '1.45', maxWidth: '40rem' } });

  const root = el('div', { class: 'view view--doc' },
    el('div', { class: 'doc-inner', style: { maxWidth: '44rem' } },
      el('h1', {}, 'Soil water limits'),
      el('p', { style: { color: 'var(--ink-2)', marginTop: '0.5rem' } },
        'Wilting point (lower limit) and field capacity (upper limit) for a USDA texture class, from a chosen source. These two values set the plant-available water the balance runs on.'),
      el('div', { class: 'row row--wrap', style: { gap: '1.6rem', margin: '1.3rem 0 1.1rem' } },
        el('label', { class: 'row', style: { gap: '0.5rem' } }, el('span', { class: 'hint' }, 'Texture class'), classSel.el),
        el('label', { class: 'row', style: { gap: '0.5rem' } }, el('span', { class: 'hint' }, 'Source'), sourceSel.el),
      ),
      metrics.el, naEl, noteEl,
    ),
  );

  function render() {
    if (!DB) return;
    const cls = classSel.get(), src = sourceSel.get();
    const rec = DB.data[src] && DB.data[src][cls];
    const srcMeta = DB.sources.find(s => s.id === src);
    const clsLabel = (DB.classes.find(c => c.id === cls) || {}).label || cls;
    noteEl.textContent = FC_NOTE[src] || FC_NOTE_RETENTION;
    naEl.innerHTML = '';
    if (!rec) {
      metrics.update([]);
      naEl.append(callout('warn', `${srcMeta.label} has no value for ${clsLabel} — that texture class wasn’t sampled by this source. Try another source (Rosetta covers all 12 classes).`));
      return;
    }
    /* One wilting point, one field capacity, and their difference — the same
       three numbers for every source. Retention-curve sources (Scott, Parker,
       Rosetta) use −10 kPa (a better FC proxy; see the note); others use their
       native field capacity. */
    const fc = rec.fc10 != null ? rec.fc10 : rec.fc;
    metrics.update([
      { label: 'Wilting point', value: rec.wp, digits: 3, unit: 'm³/m³' },
      { label: 'Field capacity', value: fc, digits: 3, unit: 'm³/m³' },
      { label: 'Available water capacity', accent: true, value: Math.max(0, fc - rec.wp), digits: 3, unit: 'm³/m³', title: 'Field capacity − wilting point' },
    ]);
  }

  fetch(new URL('./limits.json', import.meta.url))
    .then(r => r.json())
    .then(d => {
      DB = d;
      classSel.setOptions(d.classes.map(c => ({ value: c.id, label: c.label })), 'loam');
      sourceSel.setOptions(d.sources.map(s => ({ value: s.id, label: s.label })), 'rosetta');
      render();
    })
    .catch(() => { naEl.append(callout('error', 'Could not load the soil-limits table.')); });

  return root;
}

export default { title: 'Soil Water Limits', docs: DOCS, create };
