/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * modes/rotation/builder.js — the rotation builder, split into two surfaces:
 *
 *   listPanel  — add/preset controls + the draggable block list (one column).
 *                Lives in the Inputs tab beside the rotation wheel.
 *   editorEl   — the SELECTED block's editor (its Kcb curve inline + an
 *                "Edit values…" modal for the numeric parameters), styled
 *                exactly like the crop panel. Lives in the sidebar.
 *
 * Clicking a block in the list selects it; the sidebar editor follows.
 * onChange fires whenever the rotation definition changes.
 */

import { el, svgEl, clear } from '../../ui/dom.js';
import { fmtInt } from '../../ui/format.js';
import { numInput, textInput, selectInput, ctrl, toggle, btn, openModal } from '../../ui/components.js';
import { createKcbEditor } from '../../ui/curveEditor.js';
import {
  ADDABLE_COMPONENTS, PRESET_ROTATIONS, MAX_ROTATION_DAYS, ALFALFA_MAX_CUTS,
  makeComponent, blockDuration, blockSeries, cycleDays,
} from './blocks.js';

const CROP_CURVE_KEYS = ['Kcb_ini', 'Kcb_mid', 'Kcb_end', 'L_ini', 'L_dev', 'L_mid', 'L_late'];

/* Numeric fields shown in each block type's "Edit values…" modal. */
const FIELDS = {
  crop: [
    { key: 'Kcb_ini', label: 'Kcb ini', step: 0.01, min: 0 },
    { key: 'Kcb_mid', label: 'Kcb mid', step: 0.01, min: 0 },
    { key: 'Kcb_end', label: 'Kcb end', step: 0.01, min: 0 },
    { key: 'L_ini', label: 'L ini', unit: 'd', min: 1 },
    { key: 'L_dev', label: 'L dev', unit: 'd', min: 1 },
    { key: 'L_mid', label: 'L mid', unit: 'd', min: 1 },
    { key: 'L_late', label: 'L late', unit: 'd', min: 1 },
    { key: 'Zr_max', label: 'Root max', unit: 'm', step: 0.1, min: 0.1 },
    { key: 'h_max', label: 'Canopy h', unit: 'm', step: 0.1, min: 0.05 },
    { key: 'p_tab', label: 'Depletion p', step: 0.05, min: 0.1, max: 0.8 },
    { key: 'residue_pct', label: 'Residue', unit: '%', step: 5, min: 0, max: 100 },
    { key: 'CN', label: 'Curve number', min: 30, max: 98 },
  ],
  fallow: [
    { key: 'duration', label: 'Duration', unit: 'd', min: 1 },
    { key: 'Kcb', label: 'Kcb (weeds)', step: 0.01, min: 0, max: 0.5 },
    { key: 'p_tab', label: 'Depletion p', step: 0.05, min: 0.1, max: 0.8 },
    { key: 'residue_pct', label: 'Residue', unit: '%', step: 5, min: 0, max: 100 },
    { key: 'CN', label: 'Curve number', min: 30, max: 98 },
  ],
  alfalfa: [
    { key: 'Kcb_low', label: 'Kcb after cut', step: 0.01, min: 0 },
    { key: 'Kcb_peak', label: 'Kcb at peak', step: 0.01, min: 0 },
    { key: 'iniDays', label: 'Lag after cut', unit: 'd', min: 0 },
    { key: 'intervalDays', label: 'Cut interval', unit: 'd', min: 5 },
    { key: 'numCuts', label: 'Number of cuts', min: 1, max: ALFALFA_MAX_CUTS },
    { key: 'restDays', label: 'Rest after last cut', unit: 'd', min: 0 },
    { key: 'restKcb', label: 'Rest Kcb', step: 0.01, min: 0 },
    { key: 'Zr_max', label: 'Root max', unit: 'm', step: 0.1, min: 0.1 },
    { key: 'h_max', label: 'Canopy h', unit: 'm', step: 0.1, min: 0.05 },
    { key: 'p_tab', label: 'Depletion p', step: 0.05, min: 0.1, max: 0.8 },
    { key: 'residue_pct', label: 'Residue', unit: '%', step: 5, min: 0, max: 100 },
    { key: 'CN', label: 'Curve number', min: 30, max: 98 },
  ],
};

export function createRotationBuilder({ onChange } = {}) {
  let blocks = [];
  let selectedId = null;
  let dragId = null;

  /* ── Add / preset controls ──────────────────────────────────────────── */

  const addSel = selectInput({
    options: [{ value: '', label: 'Add component…' }, ...ADDABLE_COMPONENTS.map(a => ({ value: a.id, label: a.label, group: a.group }))],
    value: '',
    onChange: (id) => { if (!id) return; const b = makeComponent(id); if (b) { blocks.push(b); selectedId = b.id; changed(); } addSel.set(''); },
  });
  const presetSel = selectInput({
    options: [{ value: '', label: 'Load preset rotation…' }, ...PRESET_ROTATIONS.map(p => ({ value: p.id, label: `${p.label} (${p.years} yr)` }))],
    value: '',
    onChange: (id) => { const p = PRESET_ROTATIONS.find(x => x.id === id); if (p) { blocks = p.cycle(); selectedId = blocks[0]?.id ?? null; changed(); } presetSel.set(''); },
  });
  const clearBtn = btn('Clear', { small: true, onClick: () => { blocks = []; selectedId = null; changed(); } });
  const cycleBadge = el('span', { class: 'badge' });

  /* ── Block list ─────────────────────────────────────────────────────── */

  const listEl = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.3rem' } });

  function renderList() {
    clear(listEl);
    if (!blocks.length) { listEl.append(el('div', { class: 'hint', style: { padding: '0.6rem 0.2rem' } }, 'Empty rotation. Add components or load a preset.')); return; }
    blocks.forEach((b, i) => {
      const row = el('div', {
        class: 'card', draggable: 'true', dataset: { id: b.id },
        style: {
          display: 'flex', alignItems: 'center', gap: '0.55rem', padding: '0.45rem 0.6rem', cursor: 'pointer',
          borderColor: b.id === selectedId ? 'var(--neon)' : '',
          background: b.id === selectedId ? 'var(--neon-wash)' : '',
        },
        onclick: () => { selectedId = b.id; renderList(); renderEditor(); },
        ondragstart: (e) => { dragId = b.id; e.dataTransfer.effectAllowed = 'move'; row.style.opacity = '0.5'; },
        ondragend: () => { dragId = null; row.style.opacity = ''; listEl.querySelectorAll('[data-id]').forEach(r => { r.style.borderTop = ''; r.style.borderBottom = ''; }); },
        ondragover: (e) => {
          if (!dragId || dragId === b.id) return;
          e.preventDefault();
          const rect = row.getBoundingClientRect();
          const before = e.clientY < rect.top + rect.height / 2;
          row.style.borderTop = before ? '2px solid var(--neon)' : '';
          row.style.borderBottom = before ? '' : '2px solid var(--neon)';
        },
        ondragleave: () => { row.style.borderTop = ''; row.style.borderBottom = ''; },
        ondrop: (e) => {
          e.preventDefault();
          if (!dragId || dragId === b.id) return;
          const rect = row.getBoundingClientRect();
          const before = e.clientY < rect.top + rect.height / 2;
          const from = blocks.findIndex(x => x.id === dragId);
          const [moved] = blocks.splice(from, 1);
          let to = blocks.findIndex(x => x.id === b.id);
          if (!before) to += 1;
          blocks.splice(to, 0, moved);
          changed();
        },
      },
        el('span', { class: 'mono', style: { color: 'var(--muted)', fontSize: '0.7rem', width: '1.2rem' } }, String(i + 1)),
        el('span', { style: { width: '0.7rem', height: '0.7rem', borderRadius: '3px', background: b.color, flexShrink: 0 } }),
        el('span', { class: 'grow', style: { fontWeight: 600, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, b.name),
        el('span', { class: 'hint', style: { whiteSpace: 'nowrap' } }, `${b.type} · ${fmtInt(blockDuration(b))} d`),
        el('button', { class: 'btn btn--sm', type: 'button', title: 'Remove', 'aria-label': `Remove ${b.name}`, style: { padding: '0.1rem 0.45rem' }, onclick: (e) => { e.stopPropagation(); blocks = blocks.filter(x => x.id !== b.id); if (selectedId === b.id) selectedId = null; changed(); } }, '×'),
      );
      listEl.append(row);
    });
  }

  /* ── Sidebar editor for the selected block ──────────────────────────── */

  const editorEl = el('div', {});

  function renderEditor() {
    clear(editorEl);
    const b = blocks.find(x => x.id === selectedId);
    if (!b) { editorEl.append(el('div', { class: 'hint', style: { padding: '0.5rem 0' } }, 'Select a component in the Inputs tab to edit it.')); return; }

    const nameIn = textInput({ value: b.name, onChange: (v) => { b.name = v || b.name; changed(); } });
    const head = el('div', { class: 'row', style: { gap: '0.5rem', marginBottom: '0.4rem' } },
      el('span', { style: { width: '0.8rem', height: '0.8rem', borderRadius: '3px', background: b.color, flexShrink: 0 } }),
      el('div', { class: 'grow' }, nameIn.el),
      el('span', { class: 'badge' }, b.type),
    );
    editorEl.append(head);

    let editor = null;
    /** Update the inline curve (crop only) from the current block values. */
    const syncCurve = () => { if (editor) editor.set(pickCurve(b)); };

    if (b.type === 'crop') {
      editor = createKcbEditor({
        values: pickCurve(b),
        onChange: (v, { live }) => { Object.assign(b, v); if (!live) { renderEditor(); changed(); } },
      });
      const termToggle = toggle({
        label: 'Terminate before maturity',
        checked: b.terminate,
        onChange: (v) => { b.terminate = v; if (v && !b.termDay) b.termDay = b.L_ini + b.L_dev + 10; renderEditor(); changed(); },
      });
      editorEl.append(editor.el, el('div', { style: { marginTop: '0.3rem' } }, termToggle.el));
      if (b.terminate) editorEl.append(el('div', { class: 'hint', style: { marginTop: '0.2rem' } }, 'Kcb ramps to zero at the termination day (set in Edit values).'));
      editorEl.append(el('div', { style: { marginTop: '0.5rem' } }, btn('Edit values…', { small: true, block: true, onClick: () => openValues(b, syncCurve) })));
    } else if (b.type === 'fallow') {
      editorEl.append(
        el('div', { class: 'hint', style: { margin: '0.2rem 0 0.5rem' } }, 'No crop — Kcb held at its (usually zero) value; only soil evaporation runs.'),
        btn('Edit values…', { small: true, block: true, onClick: () => openValues(b, syncCurve) }),
      );
    } else if (b.type === 'alfalfa') {
      const estToggle = toggle({ label: 'Establishment year', checked: b.establishment, onChange: (v) => { b.establishment = v; renderEditor(); changed(); } });
      editorEl.append(
        alfalfaPreview(b),
        el('div', { style: { marginTop: '0.3rem' } }, estToggle.el),
        el('div', { style: { marginTop: '0.5rem' } }, btn('Edit values…', { small: true, block: true, onClick: () => openValues(b, syncCurve) })),
      );
    }
  }

  /** The block's numeric parameters, in a modal (like the crop panel). */
  function openValues(b, syncCurve) {
    const fields = FIELDS[b.type] || [];
    const rows = fields.map(f => {
      const input = numInput({
        value: b[f.key], step: f.step ?? 1, min: f.min, max: f.max,
        onChange: (v) => { if (isFinite(v)) { b[f.key] = v; syncCurve(); renderList(); changed(); } },
      });
      return ctrl(f.label, input.el, { unit: f.unit || '' });
    });
    if (b.type === 'crop' && b.terminate) {
      const td = numInput({ value: b.termDay, min: 1, onChange: (v) => { if (isFinite(v)) { b.termDay = v; renderList(); changed(); } } });
      const rd = numInput({ value: b.residueDays, min: 0, onChange: (v) => { if (isFinite(v)) { b.residueDays = v; renderList(); changed(); } } });
      rows.push(ctrl('Termination day', td.el, { unit: 'DAP' }), ctrl('Residue period', rd.el, { unit: 'd' }));
    }
    openModal(`${b.name} — parameters`, el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.15rem 1rem' } }, rows));
  }

  function pickCurve(b) { const o = {}; for (const k of CROP_CURVE_KEYS) o[k] = b[k]; return o; }

  /** Small static SVG of the alfalfa cutting-cycle Kcb series (dark), with a
   *  dashed marker at each cutting (the whole cycle is one season, so these
   *  are the first year's cuts). */
  function alfalfaPreview(b) {
    const s = blockSeries(b);
    const W = 360, H = 120, ML = 28, MR = 8, MT = 8, MB = 20;
    const pw = W - ML - MR, ph = H - MT - MB;
    const n = s.length, ymax = 1.4;
    const x = (i) => ML + (i / Math.max(n - 1, 1)) * pw;
    const y = (k) => MT + (1 - k / ymax) * ph;
    const d = s.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.kcb).toFixed(1)}`).join(' ');
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Alfalfa Kcb through the cutting cycles, with each cutting marked' });
    for (let k = 0; k <= ymax + 1e-9; k += 0.4) {
      svg.append(svgEl('line', { x1: ML, x2: ML + pw, y1: y(k), y2: y(k), stroke: '#2a2f39' }));
      svg.append(svgEl('text', { x: ML - 5, y: y(k) + 4, fill: '#7f8794', 'font-size': 11, 'text-anchor': 'end' }, k.toFixed(1)));
    }
    svg.append(svgEl('path', { d: `${d} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`, fill: 'rgba(134,221,82,0.1)' }));
    svg.append(svgEl('path', { d, fill: 'none', stroke: b.color, 'stroke-width': 2 }));
    /* One marker per cutting: the Kcb peak at the end of each interval, where
       it drops back to the after-cut value. Day is counted from regrowth
       start. */
    for (let c = 1; c <= b.numCuts; c++) {
      const day = c * b.intervalDays;
      const cx = x(Math.min(day, n - 1));
      svg.append(svgEl('line', { x1: cx, x2: cx, y1: MT, y2: MT + ph, stroke: '#9aa2ae', 'stroke-width': 1, 'stroke-dasharray': '3 2', opacity: '0.75' }));
      const anchor = cx > ML + pw - 16 ? 'end' : (cx < ML + 16 ? 'start' : 'middle');
      svg.append(svgEl('text', { x: cx, y: MT + ph + 13, fill: '#9aa2ae', 'font-size': 10, 'text-anchor': anchor }, `d${day}`));
    }
    return el('div', { class: 'widget' }, svg, el('div', { class: 'widget__caption' }, 'Dashed lines mark each cutting (day since regrowth start); Kcb regrows after each.'));
  }

  /* ── List panel (Inputs tab) ────────────────────────────────────────── */

  addSel.el.style.width = 'auto';
  presetSel.el.style.width = 'auto';
  /* Full-height flex column: controls + hint fixed, the block list scrolls
     inside the remaining space so a long rotation never grows the row. */
  const listPanel = el('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' } },
    el('div', { class: 'row row--between row--wrap', style: { marginBottom: '0.55rem', flexShrink: '0' } },
      el('div', { class: 'row' }, el('h3', {}, 'Components'), cycleBadge),
      el('div', { class: 'row row--wrap' }, presetSel.el, addSel.el, clearBtn),
    ),
    el('div', { class: 'hint', style: { marginBottom: '0.35rem', flexShrink: '0' } }, 'Drag to reorder · click to edit in the sidebar'),
    el('div', { style: { flex: '1', overflowY: 'auto', minHeight: '0', paddingRight: '0.2rem' } }, listEl),
  );

  function changed() {
    const days = cycleDays(blocks);
    cycleBadge.textContent = blocks.length ? `${blocks.length} · ${fmtInt(days)} d (${(days / 365.25).toFixed(1)} yr)` : 'empty';
    cycleBadge.className = `badge ${days > MAX_ROTATION_DAYS ? 'badge--warn' : ''}`;
    renderList();
    renderEditor();
    onChange && onChange(blocks);
  }

  changed();

  return {
    listEl: listPanel,
    editorEl,
    getBlocks: () => blocks,
    setBlocks(list) { blocks = list; selectedId = list[0]?.id ?? null; changed(); },
    loadPreset(id) { const p = PRESET_ROTATIONS.find(x => x.id === id); if (p) this.setBlocks(p.cycle()); },
  };
}
