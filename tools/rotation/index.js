/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/rotation/index.js — Crop Rotation on the workbench. Sidebar:
 * weather / simulation window / soil / options. Inputs tab: the rotation
 * builder (the primary editing surface, full width) + the cycle timeline,
 * with the loaded weather below. Outputs tab: the continuous water-balance
 * results. Rainfed by design.
 */

import { el } from '../../ui/dom.js';
import { fmt, fmtInt, fmtDate, addDaysISO } from '../../ui/format.js';
import { group, btn, ctrl, dateInput, numInput, metricsBar, dataTable, warningsBox, subhead } from '../../ui/components.js';
import { downloadCsv, downloadJson, pickFile, readFileText } from '../../ui/download.js';
import { createWorkbench } from '../../ui/workbench.js';
import { createInputCharts } from '../../ui/inputCharts.js';
import { createWeatherPanel } from '../../ui/panels/weather.js';
import { createSoilPanel } from '../../ui/panels/soil.js';
import { createOptionsPanel } from '../../ui/panels/options.js';
import { createSeasonCharts } from '../../ui/seasonCharts.js';
import { toUtcTimestamp } from '../../core/index.js';
import { runRotation, cycleDays, zrFloorFor, cloneBlock, MAX_ROTATION_DAYS } from './blocks.js';
import { createRotationBuilder } from './builder.js';
import { createTimeline, createWheel } from './charts.js';
import { DOCS } from './docs.js';

const EXPORT_COLS = [
  { key: 'date', label: 'date' }, { key: 'day', label: 'day' }, { key: 'block', label: 'block' },
  { key: 'ETo', label: 'ETo', digits: 2 }, { key: 'Kcb', label: 'Kcb', digits: 3 },
  { key: 'Ke', label: 'Ke', digits: 3 }, { key: 'Ks', label: 'Ks', digits: 3 },
  { key: 'Kc_max', label: 'Kc_max', digits: 3 }, { key: 'fc', label: 'fc', digits: 3 },
  { key: 'Zr', label: 'Zr', digits: 3 }, { key: 'ETc', label: 'ETc', digits: 2 },
  { key: 'T', label: 'T', digits: 2 }, { key: 'E', label: 'E', digits: 2 },
  { key: 'prcp', label: 'prcp', digits: 1 }, { key: 'runoff', label: 'runoff', digits: 2 },
  { key: 'deep_percolation', label: 'deep_perc', digits: 2 }, { key: 'Dr', label: 'Dr', digits: 1 },
  { key: 'De', label: 'De', digits: 1 }, { key: 'TAW', label: 'TAW', digits: 1 },
  { key: 'RAW', label: 'RAW', digits: 1 }, { key: 'Sr', label: 'Sr', digits: 1 },
  { key: 'Ss', label: 'Ss', digits: 1 }, { key: 'S_profile', label: 'S_profile', digits: 1 },
];

const TABLE_COLS = [
  { key: 'date', label: 'Date', format: (v) => v }, { key: 'day', label: 'Day', digits: 0 },
  { key: 'block', label: 'Block', format: (v) => v }, { key: 'ETo', label: 'ETo', digits: 2 },
  { key: 'Kcb', label: 'Kcb', digits: 2 }, { key: 'Ke', label: 'Ke', digits: 2 },
  { key: 'Ks', label: 'Ks', digits: 2 }, { key: 'ETc', label: 'ETc', digits: 2 },
  { key: 'T', label: 'T', digits: 2 }, { key: 'E', label: 'E', digits: 2 },
  { key: 'prcp', label: 'P', digits: 1 }, { key: 'Dr', label: 'Dr', digits: 0 },
  { key: 'TAW', label: 'TAW', digits: 0 }, { key: 'Zr', label: 'Zr', digits: 2 },
];

function create() {
  let lastResult = null;
  let ready = false;
  const wb = createWorkbench();

  const timeline = createTimeline();
  const wheel = createWheel();
  const builder = createRotationBuilder({
    onChange: () => { if (!ready) return; redrawStructure(); syncHints(); },
  });

  const inputCharts = createInputCharts();
  const weather = createWeatherPanel({ onChange: () => syncHints(), onData: (rows) => { inputCharts.render(rows); refit(); } });
  const soil = createSoilPanel({ onChange: () => { syncHints(); redrawStructure(); } });
  const options = createOptionsPanel({ onChange: () => syncHints() });
  const startIn = dateInput({ onChange: () => syncHints() });
  let prevAnchor = null;   /* redraw the wheel only when the start date changes */
  const cyclesIn = numInput({ value: 1, min: 1, max: 20, step: 1, onChange: () => syncHints() });
  const windowInfo = el('div', { class: 'hint', style: { marginTop: '0.3rem' } });

  /* Timeline + wheel show the rotation STRUCTURE (one cycle), redrawn live
     from the builder / soil / start-date — no run needed. A rAF resize
     after each redraw makes Plotly re-fit to its container so the timeline
     never keeps a stale width that overlaps the charts below it. */
  function redrawStructure() {
    const blocks = builder.getBlocks();
    timeline.render(blocks, { zrFloor: zrFloorFor(soil.get()) });
    wheel.render(blocks, startIn.get());
    refit();
  }
  function refit() { requestAnimationFrame(() => window.dispatchEvent(new Event('resize'))); }

  /* ── Sidebar ────────────────────────────────────────────────────────── */

  const gWeather = group('Weather & site', { open: true });
  gWeather.body.append(weather.el);
  const gSim = group('Simulation window', { open: true });
  gSim.body.append(ctrl('Start date', startIn.el), ctrl('Cycles', cyclesIn.el), windowInfo);
  const gBlock = group('Selected block', { open: true });
  gBlock.body.append(builder.editorEl);
  const gSoil = group('Soil');
  gSoil.body.append(soil.el);
  const gOptions = group('Model options');
  gOptions.body.append(options.el);
  wb.sidebar.append(gWeather.el, gSim.el, gBlock.el, gSoil.el, gOptions.el);

  const runBtn = btn('Run rotation', { kind: 'primary', block: true, onClick: run });
  const status = el('div', { class: 'runbar__status' });
  wb.foot.append(el('div', { class: 'runbar' }, runBtn, status,
    el('div', { class: 'row' }, btn('Export', { small: true, onClick: exportSettings }), btn('Import', { small: true, onClick: importSettings }))));

  /* ── Inputs tab: block list + wheel side by side, timeline below ─────── */

  wb.inputs.append(el('div', { class: 'stack' },
    el('div', { class: 'rot-top' },
      el('div', { class: 'card', style: { padding: '0.85rem' } }, builder.listEl),
      wheel.el,
    ),
    timeline.el,
    subhead('Loaded weather'),
    inputCharts.el,
  ));

  /* ── Outputs tab ────────────────────────────────────────────────────── */

  const metrics = metricsBar([]);
  const warnBox = warningsBox();
  const charts = createSeasonCharts();
  const table = dataTable(TABLE_COLS);
  const gTable = group('Daily results table');
  gTable.body.append(el('div', { style: { margin: '0.4rem 0' } }, btn('Download CSV', { small: true, kind: 'neon', onClick: () => { if (lastResult) downloadCsv('rotation_results.csv', EXPORT_COLS, lastResult.rows); } })), table.el);
  wb.outputs.append(el('div', { class: 'stack' }, metrics.el, warnBox.el, charts.el, gTable.el));

  const root = el('div', { class: 'view' }, wb.el);

  /* ── Behaviour ──────────────────────────────────────────────────────── */

  function updateHead() {
    const s = weather.getSummary();
    wb.head.innerHTML = '';
    const blocks = builder.getBlocks();
    const per = cycleDays(blocks);
    wb.head.append(
      el('span', {}, `${blocks.length} components · ${fmtInt(per)} d/cycle`),
      s ? el('span', { style: { color: 'var(--muted)' } }, `${fmtInt(s.n_days)} weather days`) : el('span', { class: 'hint' }, 'no weather loaded'),
    );
  }

  function syncHints() {
    gWeather.setHint(weather.hint(), weather.isReady());
    gSoil.setHint(soil.hint());
    gOptions.setHint(options.hint());
    options.setClimateAdjustAvailable(weather.hasCorrections());
    const s = weather.getSummary();
    if (s) {
      startIn.setRange(s.date_min, s.date_max);
      if (!startIn.get()) {
        const guess = `${s.years[0] + 1}-09-15`;
        startIn.set(guess <= s.date_max ? guess : s.date_min);
      }
    }
    const blocks = builder.getBlocks();
    const per = cycleDays(blocks);
    const cycles = Math.max(1, Math.round(cyclesIn.get() || 1));
    if (s && startIn.get() && per > 0) {
      const avail = Math.floor((toUtcTimestamp(s.date_max) - toUtcTimestamp(startIn.get())) / 86400000) + 1;
      const maxCycles = Math.max(1, Math.floor(avail / per));
      const total = per * cycles;
      const end = addDaysISO(startIn.get(), Math.min(total, avail) - 1);
      const over = total > avail;
      windowInfo.textContent = `${fmtDate(startIn.get())} → ${fmtDate(end)} · ${fmtInt(Math.min(total, avail))} days` + (over ? ` — record ends first; ${maxCycles} cycle(s) fit.` : ` (${maxCycles} fit).`);
      gSim.setHint(`${cycles} × ${fmtInt(per)}d`, !over);
    } else {
      windowInfo.textContent = 'Pick a start date within the weather record.';
      let why = 'build a rotation first';
      if (!s) why = 'load weather first';
      else if (!startIn.get()) why = 'pick a start date';
      gSim.setHint(why);
    }
    if (per > MAX_ROTATION_DAYS) gSim.setHint(`cycle > ${MAX_ROTATION_DAYS} d`, false);
    if (ready && startIn.get() !== prevAnchor) { prevAnchor = startIn.get(); redrawStructure(); }
    updateHead();
  }

  function setStatus(msg, kind = '') { status.textContent = msg; status.className = `runbar__status${kind ? ` is-${kind}` : ''}`; }

  function run() {
    try {
      setStatus('Running…');
      const t0 = performance.now();
      const { df } = weather.getWeather();
      const result = runRotation({ weatherDf: df, startDate: startIn.get(), blocks: builder.getBlocks(), numCycles: cyclesIn.get(), soil: soil.get(), options: options.get() });
      lastResult = result;
      renderResults();
      wb.setOutputsEnabled(true);
      wb.showTab('outputs');
      setStatus(`Done in ${Math.round(performance.now() - t0)} ms — ${fmtInt(result.days)} days${result.truncated ? ' (truncated)' : ''}.`, 'ok');
    } catch (err) { console.error(err); setStatus(err.message, 'error'); }
  }

  function renderResults() {
    const { rows, warnings, summary, truncated } = lastResult;
    const s = summary;
    metrics.update([
      { label: 'Days', value: s.days, unit: 'd' },
      { label: 'Precip', value: s.precipitation, unit: 'mm' },
      { label: 'Crop ET', value: s.etc, unit: 'mm' },
      { label: 'Transpiration', value: s.transpiration, unit: 'mm' },
      { label: 'Evaporation', value: s.evaporation, unit: 'mm' },
      { label: 'Runoff', value: s.runoff, unit: 'mm' },
      { label: 'Deep perc.', value: s.deep_percolation, unit: 'mm' },
      { label: 'Stress days', value: s.stress_days, unit: 'd', title: 'Days with a crop present and Ks < 1' },
      { label: 'SPSI', accent: true, value: s.SPSI === null ? '—' : fmt(s.SPSI, 2), title: 'Fallow storage efficiency: 1 − (fallow ET / fallow precip). Farahani 1998 Eq. 1' },
      { label: 'SPUI', accent: true, value: s.SPUI === null ? '—' : fmt(s.SPUI, 2), title: 'System precip use index: 1 − (fallow ET / total precip). Farahani 1998 Eq. 2' },
      { label: 'PPUE', accent: true, value: s.PPUE === null ? '—' : fmt(s.PPUE, 2), title: 'Productive precip use: transpiration / total precip' },
      { label: 'E / P', value: s.E_over_P === null ? '—' : fmt(s.E_over_P, 2), title: 'Soil evaporation / total precip' },
    ]);
    const w = [...warnings];
    if (truncated) w.push('The weather record ended before the requested cycles completed; the run was truncated.');
    warnBox.update(w);
    charts.render(rows);
    table.update(rows);
  }

  function exportSettings() {
    downloadJson('rotation_settings.json', {
      version: 1, mode: 'rotation', start_date: startIn.get(), cycles: cyclesIn.get(),
      blocks: builder.getBlocks().map(({ id, ...b }) => b),
      location: weather.getLocation(), soil_preset: soil.getPresetId(), soil: soil.get(), options: options.get(),
    });
  }

  async function importSettings() {
    const file = await pickFile('.json');
    if (!file) return;
    try {
      const s = JSON.parse(await readFileText(file));
      if (Array.isArray(s.blocks)) builder.setBlocks(s.blocks.map(b => cloneBlock(b)));
      if (s.start_date) startIn.set(s.start_date);
      if (isFinite(s.cycles)) cyclesIn.set(s.cycles);
      if (s.location) weather.setLocation(s.location);
      if (s.soil) soil.set(s.soil, s.soil_preset);
      if (s.options) options.set(s.options);
      syncHints();
      setStatus(`Imported ${file.name}.`, 'ok');
    } catch (err) { setStatus(`Import failed: ${err.message}`, 'error'); }
  }

  ready = true;
  builder.loadPreset('wsf');
  syncHints();
  return root;
}

export default { title: 'Crop Rotation', docs: DOCS, create };
