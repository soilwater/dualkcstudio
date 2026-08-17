/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * components.js — the control-panel vocabulary, modelled on a lil-gui /
 * three.js-editor sidebar: collapsible uppercase-headed groups, tight
 * label→control rows, compact inputs, square neon checkboxes. Plain DOM +
 * tiny callbacks; no framework.
 */

import { el, svgEl } from './dom.js';
import { fmt, MONTH_NAMES } from './format.js';

const pad2 = (n) => String(n).padStart(2, '0');

/* ── Group (collapsible sidebar section) ───────────────────────────────── */

export function group(title, { open = false, hint = '' } = {}) {
  const hintEl = el('span', { class: 'group__hint' }, hint);
  const body = el('div', { class: 'group__body' });
  const details = el('details', {
    class: 'group', open,
    /* Plotly/SVG measure 0×0 when built inside a collapsed group; re-fit on open. */
    ontoggle: () => { if (details.open) window.dispatchEvent(new Event('resize')); },
  },
    el('summary', {},
      el('span', { class: 'group__title' }, title),
      hintEl,
      el('span', { class: 'group__chev', 'aria-hidden': 'true' }),
    ),
    body,
  );
  return {
    el: details,
    body,
    setHint(text, ok = false) { hintEl.textContent = text; hintEl.classList.toggle('is-ok', ok); },
    open() { details.open = true; },
  };
}

/** A subheader line inside a group/pane (uppercase, muted). */
export function subhead(text) { return el('div', { class: 'subhead' }, text); }

/* ── Rows ──────────────────────────────────────────────────────────────── */

/** label → control row. `control` is a DOM node (from an input factory).
 *  `help` adds a one-sentence muted line beneath the row (use this instead
 *  of cramming explanation into long <option> labels). `stack` puts the
 *  control on its own full-width line below the label (for wide controls
 *  like a 4-option segmented that would otherwise overflow). */
export function ctrl(label, control, { unit = '', title = '', stack = false, help = '' } = {}) {
  const row = el('div', { class: `ctrl${stack ? ' ctrl--stack' : ''}`, title },
    el('div', { class: 'ctrl__label' }, label, unit ? el('span', { class: 'unit' }, unit) : null),
    el('div', { class: 'ctrl__field' }, control),
  );
  if (!help) return row;
  return el('div', { class: 'ctrl-wrap' }, row, el('div', { class: 'ctrl__help' }, help));
}

/** Read-only value row: label left, value+unit right. */
export function readout(label, { unit = '' } = {}) {
  const valEl = el('span', { class: 'readout__value' });
  const row = el('div', { class: 'readout' },
    el('span', { class: 'readout__label' }, label),
    valEl,
  );
  function set(value, u = unit) {
    valEl.textContent = '';
    valEl.append(value == null ? '—' : String(value), u ? el('span', { class: 'unit' }, u) : '');
  }
  return { el: row, set };
}

/* ── Inputs ────────────────────────────────────────────────────────────── */

export function numInput({ value, min, max, step = 'any', onChange, placeholder, wide = false } = {}) {
  const input = el('input', {
    class: `input${wide ? '' : ' input--num'}`, type: 'number', step,
    min: min !== undefined ? String(min) : null,
    max: max !== undefined ? String(max) : null,
    placeholder,
    value: value !== undefined && value !== null ? String(value) : '',
    onchange: () => onChange && onChange(parseFloat(input.value)),
  });
  return {
    el: input,
    get: () => parseFloat(input.value),
    set: (v) => { input.value = (v === undefined || v === null || Number.isNaN(v)) ? '' : String(v); },
  };
}

export function textInput({ value = '', onChange, placeholder, type = 'text' } = {}) {
  const input = el('input', { class: 'input', type, placeholder, value, onchange: () => onChange && onChange(input.value) });
  return { el: input, get: () => input.value, set: (v) => { input.value = v ?? ''; } };
}

export function dateInput({ value = '', min, max, onChange } = {}) {
  const input = el('input', { class: 'input', type: 'date', value, min, max, onchange: () => onChange && onChange(input.value) });
  return {
    el: input,
    get: () => input.value,
    set: (v) => { input.value = v ?? ''; },
    setRange: (lo, hi) => { if (lo) input.min = lo; if (hi) input.max = hi; },
  };
}

/**
 * Month + day picker — a single control (two inline dropdowns) that captures
 * a calendar month-day with NO year, get/set as an 'MM-DD' string. Use this
 * for any date whose year is meaningless (historical stochastic replays,
 * where only the month/day is matched across every year of the record). The
 * day list is trimmed to the selected month's length; Feb allows 29 so a
 * leap-day still matches (in leap years only).
 */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function monthDayInput({ value = '01-01', onChange } = {}) {
  let month = 1, day = 1;
  function parse(mmdd) {
    const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(mmdd || ''));
    if (!m) return;
    month = Math.min(Math.max(+m[1], 1), 12);
    day = Math.min(Math.max(+m[2], 1), DAYS_IN_MONTH[month - 1]);
  }
  parse(value);

  const monthSel = el('select', { class: 'select select--month', onchange: () => { month = +monthSel.value; syncDays(); emit(); } },
    MONTH_NAMES.map((name, i) => el('option', { value: String(i + 1) }, name)));
  const daySel = el('select', { class: 'select select--day', onchange: () => { day = +daySel.value; emit(); } });

  function syncDays() {
    const max = DAYS_IN_MONTH[month - 1];
    if (day > max) day = max;
    daySel.innerHTML = '';
    for (let d = 1; d <= max; d++) daySel.append(el('option', { value: String(d) }, String(d)));
    daySel.value = String(day);
  }
  function emit() { onChange && onChange(get()); }
  function get() { return `${pad2(month)}-${pad2(day)}`; }

  monthSel.value = String(month);
  syncDays();

  return {
    el: el('div', { class: 'monthday' }, monthSel, daySel),
    get,
    set(mmdd) { parse(mmdd); monthSel.value = String(month); syncDays(); },
  };
}

export function selectInput({ options, value, onChange } = {}) {
  const sel = el('select', { class: 'select', onchange: () => onChange && onChange(sel.value) });
  const build = (opts) => {
    sel.innerHTML = '';
    let currentGroup = null, groupEl = null;
    for (const o of opts) {
      const opt = el('option', { value: o.value }, o.label);
      if (o.group) {
        if (o.group !== currentGroup) { groupEl = el('optgroup', { label: o.group }); sel.append(groupEl); currentGroup = o.group; }
        groupEl.append(opt);
      } else { sel.append(opt); currentGroup = null; }
    }
  };
  build(options);
  if (value !== undefined) sel.value = value;
  return {
    el: sel,
    get: () => sel.value,
    set: (v) => { sel.value = v; },
    setOptions: (opts, v) => { build(opts); if (v !== undefined) sel.value = v; },
  };
}

/* ── Checkbox (square, neon check) ─────────────────────────────────────── */

export function checkbox({ label, sub, checked = false, onChange } = {}) {
  const input = el('input', { type: 'checkbox', checked, onchange: () => onChange && onChange(input.checked) });
  const check = svgEl('svg', { viewBox: '0 0 24 24' }, svgEl('polyline', { points: '20 6 9 17 4 12' }));
  const root = el('label', { class: 'check' },
    input,
    el('span', { class: 'check__box', 'aria-hidden': 'true' }, check),
    el('span', { class: 'check__text' }, label, sub ? el('small', {}, sub) : null),
  );
  return { el: root, get: () => input.checked, set: (v) => { input.checked = !!v; } };
}

/* ── Toggle switch ─────────────────────────────────────────────────────── */

export function toggle({ label, checked = false, onChange } = {}) {
  const input = el('input', { type: 'checkbox', checked, onchange: () => onChange && onChange(input.checked) });
  const root = el('label', { class: 'toggle' },
    input, el('span', { class: 'toggle__track', 'aria-hidden': 'true' }),
    label ? el('span', { class: 'toggle__text' }, label) : null,
  );
  return { el: root, get: () => input.checked, set: (v) => { input.checked = !!v; } };
}

/* ── Segmented control ─────────────────────────────────────────────────── */

export function segmented({ options, value, onChange, full = false } = {}) {
  let current = value ?? options[0].value;
  const buttons = new Map();
  const root = el('div', { class: `seg${full ? ' seg--full' : ''}`, role: 'group' },
    options.map(o => {
      const b = el('button', { class: 'seg__opt', type: 'button', onclick: () => { setValue(o.value); onChange && onChange(o.value); } }, o.label);
      buttons.set(o.value, b);
      return b;
    }),
  );
  function setValue(v) { current = v; for (const [val, b] of buttons) b.classList.toggle('is-active', val === v); }
  setValue(current);
  return { el: root, get: () => current, set: setValue };
}

/* ── Buttons ───────────────────────────────────────────────────────────── */

export function btn(label, { kind = 'default', small = false, block = false, onClick, title } = {}) {
  const cls = ['btn'];
  if (kind !== 'default') cls.push(`btn--${kind}`);
  if (small) cls.push('btn--sm');
  if (block) cls.push('btn--block');
  return el('button', { class: cls.join(' '), type: 'button', title, onclick: onClick }, label);
}

/* ── Metric tiles ──────────────────────────────────────────────────────── */

export function metricsBar(defs = []) {
  const root = el('div', { class: 'metrics' });
  function update(items) {
    root.innerHTML = '';
    for (const m of items) {
      root.append(el('div', { class: `metric${m.accent ? ' metric--accent' : ''}`, title: m.title || '' },
        el('div', { class: 'metric__label' }, m.label),
        el('div', { class: 'metric__value' },
          typeof m.value === 'number' ? fmt(m.value, m.digits ?? 0) : (m.value ?? '—'),
          m.unit ? el('span', { class: 'unit' }, m.unit) : null,
        ),
      ));
    }
  }
  update(defs);
  return { el: root, update };
}

/* ── Data table ────────────────────────────────────────────────────────── */

export function dataTable(cols, { maxHeight = '32rem' } = {}) {
  const tbody = el('tbody');
  const wrap = el('div', { class: 'tablewrap', style: { maxHeight } },
    el('table', { class: 'table' },
      el('thead', {}, el('tr', {}, cols.map(c => el('th', {}, c.label)))),
      tbody,
    ),
  );
  function update(rows) {
    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const r of rows) {
      frag.append(el('tr', {}, cols.map(c => {
        const v = r[c.key];
        const text = c.format ? c.format(v, r) : (typeof v === 'number' ? fmt(v, c.digits ?? 1) : (v ?? '—'));
        return el('td', {}, text);
      })));
    }
    tbody.append(frag);
  }
  return { el: wrap, update };
}

/* ── Dropzone ──────────────────────────────────────────────────────────── */

export function dropzone({ title, sub, accept = '.csv', onFile } = {}) {
  const input = el('input', { type: 'file', accept, class: 'sr-only', onchange: () => { if (input.files[0]) onFile(input.files[0]); input.value = ''; } });
  const zone = el('div', {
    class: 'dropzone', tabindex: '0', role: 'button',
    onclick: () => input.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
    ondragover: (e) => { e.preventDefault(); zone.classList.add('is-over'); },
    ondragleave: () => zone.classList.remove('is-over'),
    ondrop: (e) => { e.preventDefault(); zone.classList.remove('is-over'); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) onFile(f); },
  },
    el('div', { class: 'dropzone__title' }, title),
    sub ? el('div', { class: 'hint' }, sub) : null,
    input,
  );
  return zone;
}

/* ── Callouts ──────────────────────────────────────────────────────────── */

export function callout(kind, content) {
  const root = el('div', { class: `callout callout--${kind}` });
  if (Array.isArray(content)) root.append(el('ul', {}, content.map(w => el('li', {}, w))));
  else root.append(content);
  return root;
}

export function warningsBox() {
  const root = el('div', { hidden: true });
  return {
    el: root,
    update(warnings) {
      root.innerHTML = '';
      if (warnings && warnings.length) { root.hidden = false; root.append(callout('warn', warnings)); }
      else root.hidden = true;
    },
  };
}

/* ── Lightweight modal (manual value entry, etc.) ──────────────────────── */

let closeOpenModal = null;

export function openModal(title, contentEl) {
  if (closeOpenModal) closeOpenModal();
  const body = el('div', { class: 'modal__body' }, contentEl);
  const backdrop = el('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } },
    el('div', { class: 'modal', role: 'dialog', 'aria-label': title },
      el('div', { class: 'modal__head' }, el('h2', {}, title), btn('Close', { small: true, onClick: () => close() })),
      body,
    ),
  );
  function onKey(e) { if (e.key === 'Escape') close(); }
  function close() { document.removeEventListener('keydown', onKey); backdrop.remove(); if (closeOpenModal === close) closeOpenModal = null; }
  document.body.append(backdrop);
  document.addEventListener('keydown', onKey);
  closeOpenModal = close;
  window.dispatchEvent(new Event('resize'));
  return { close };
}
