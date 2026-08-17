/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * panels/weather.js — the shared weather panel for the water-balance tools,
 * sidebar edition. These tools run on an ETo-complete file: the required
 * columns are date, prcp and eto. Reference ET is NOT computed here — that is
 * the ETo Calculator's job — which keeps the model tools modular and lets a
 * user bring ETo from any source (a station, a gridded product, the ETo
 * Calculator). Wind and minimum RH are optional (they drive the FAO-56 Eq. 72
 * Kc_max term and the Eq. 70 climate adjustment); when absent the loader
 * falls back to the FAO-56 standard climate and those corrections go quiet.
 *
 * onData(df) fires whenever a fresh record loads so the mode can (re)draw the
 * Inputs-tab charts. getWeather() hands out the engine-ready daily array.
 */

import { el } from '../dom.js';
import { fmtInt, fmtDate } from '../format.js';
import { readout, dropzone, btn, callout } from '../components.js';
import { checkColumns, showColumnModal } from '../weatherSchema.js';
import { loadModelWeather, MODEL_REQUIRED } from '../csv.js';

const EXAMPLE = { url: 'kansas_north_west_eto.csv', label: 'Load example (NW Kansas)' };

export function createWeatherPanel({ onChange, onData } = {}) {
  const state = { df: null, summary: null, fileName: null, hasWspd: false, hasRmin: false };

  const statusEl = el('div', {});
  const roFile = readout('File');
  const roRecords = readout('Records');
  const roRange = readout('Range');
  const roCorr = readout('Corrections');
  const summaryBlock = el('div', { hidden: true, style: { marginTop: '0.55rem' } }, roFile.el, roRecords.el, roRange.el, roCorr.el);

  const zone = dropzone({
    title: 'Drop weather CSV',
    sub: 'needs date, prcp, eto',
    onFile: (f) => f.text().then(text => loadCsv(text, f.name)).catch(err => showError(err.message)),
  });

  const exampleBtn = btn(EXAMPLE.label, { kind: 'neon', small: true, block: true, onClick: async () => {
    try {
      exampleBtn.disabled = true;
      const res = await fetch(EXAMPLE.url);
      if (!res.ok) throw new Error(`Could not fetch the example dataset (HTTP ${res.status}).`);
      loadCsv(await res.text(), EXAMPLE.url);
    } catch (err) { showError(err.message); } finally { exampleBtn.disabled = false; }
  } });

  const root = el('div', {},
    zone,
    el('div', { style: { marginTop: '0.4rem' } }, exampleBtn),
    statusEl,
    summaryBlock,
    el('div', { class: 'hint', style: { marginTop: '0.6rem' } },
      'Files need a computed eto column. Have only raw weather? Compute ETo in the ',
      el('a', { href: '#/eto-calculator' }, 'ETo Calculator'),
      ' first, then upload the result here.'),
  );

  function showError(msg) { statusEl.innerHTML = ''; statusEl.append(el('div', { style: { marginTop: '0.4rem' } }, callout('error', msg))); }

  function loadCsv(text, name) {
    /* Enforce the model column contract (date, prcp, eto): a missing required
       column shows the shared modal and aborts; an unrecognised extra just
       warns. */
    const check = checkColumns(text, MODEL_REQUIRED);
    if (!check.ok) { showColumnModal(check, MODEL_REQUIRED); if (check.missing.length) return; }

    let loaded;
    try { loaded = loadModelWeather(text); } catch (err) { showError(err.message); return; }
    statusEl.innerHTML = '';
    state.df = loaded.df; state.summary = loaded.summary; state.fileName = name;
    state.hasWspd = loaded.hasWspd; state.hasRmin = loaded.hasRmin;

    renderSummary();
    if (onData) { try { onData(state.df); } catch { /* charts optional */ } }
    changed();
  }

  function renderSummary() {
    const s = state.summary;
    if (!s) { summaryBlock.hidden = true; return; }
    summaryBlock.hidden = false;
    roFile.set(state.fileName);
    roRecords.set(`${fmtInt(s.n_days)} d · ${s.n_years} yr`);
    roRange.set(`${fmtDate(s.date_min)} → ${fmtDate(s.date_max)}`);
    roCorr.set(state.hasWspd && state.hasRmin ? 'wind & RHmin' : (state.hasWspd || state.hasRmin ? 'partial' : 'standard climate'));
  }

  function changed() { onChange && onChange(); }

  function isReady() { return !!state.df; }
  function hint() { return state.df ? `${state.summary.n_years} yr loaded` : 'no data'; }

  return {
    el: root,
    isReady, hint,
    getWeather() {
      if (!state.df) throw new Error('Load a weather CSV (with an eto column) first.');
      return { df: state.df, summary: state.summary, location: {} };
    },
    getSummary: () => state.summary,
    /* Site is no longer used by the model tools (ETo is supplied, not
       computed). Kept as no-ops so settings import/export stay unchanged. */
    getLocation: () => ({}),
    setLocation() {},
    /* Whether the FAO-56 wind/RHmin corrections have real data to work with. */
    hasCorrections: () => state.hasWspd && state.hasRmin,
  };
}
