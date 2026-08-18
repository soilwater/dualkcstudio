/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/single-season/index.js — one crop, one site, one season: the
 * reference implementation of the workbench pattern. Compact control
 * sidebar (grouped) on the left; a tabbed canvas on the right showing the
 * loaded weather (Inputs) and the model results (Outputs).
 */

import { runModel, estimateYield } from '../../core/index.js';
import { sliceWeatherWindow } from '../../core/weather.js';
import { el } from '../../ui/dom.js';
import { fmtInt, fmtDate } from '../../ui/format.js';
import { group, btn, dateInput, ctrl, metricsBar, dataTable, warningsBox } from '../../ui/components.js';
import { downloadCsv, downloadJson, pickFile, readFileText } from '../../ui/download.js';
import { createWorkbench } from '../../ui/workbench.js';
import { createInputCharts } from '../../ui/inputCharts.js';
import { createWeatherPanel } from '../../ui/panels/weather.js';
import { createSoilPanel } from '../../ui/panels/soil.js';
import { createCropPanel } from '../../ui/panels/crop.js';
import { createManagementPanel } from '../../ui/panels/management.js';
import { createOptionsPanel } from '../../ui/panels/options.js';
import { createSeasonCharts } from '../../ui/seasonCharts.js';
import { DOCS } from './docs.js';

const EXPORT_COLS = [
  { key: 'date', label: 'date' }, { key: 'dap', label: 'dap' },
  { key: 'ETo', label: 'ETo', digits: 2 }, { key: 'Kcb', label: 'Kcb', digits: 3 },
  { key: 'Ke', label: 'Ke', digits: 3 }, { key: 'Ks', label: 'Ks', digits: 3 },
  { key: 'Kr', label: 'Kr', digits: 3 }, { key: 'Kc_max', label: 'Kc_max', digits: 3 },
  { key: 'fc', label: 'fc', digits: 3 }, { key: 'h', label: 'h', digits: 2 },
  { key: 'Zr', label: 'Zr', digits: 3 }, { key: 'ETc', label: 'ETc', digits: 2 },
  { key: 'T', label: 'T', digits: 2 }, { key: 'E', label: 'E', digits: 2 },
  { key: 'E_diff', label: 'E_diff', digits: 3 }, { key: 'prcp', label: 'prcp', digits: 1 },
  { key: 'irrig_applied', label: 'irrig', digits: 1 }, { key: 'runoff', label: 'runoff', digits: 2 },
  { key: 'deep_percolation', label: 'deep_perc', digits: 2 }, { key: 'Dr', label: 'Dr', digits: 1 },
  { key: 'De', label: 'De', digits: 1 }, { key: 'TAW', label: 'TAW', digits: 1 },
  { key: 'RAW', label: 'RAW', digits: 1 }, { key: 'TEW', label: 'TEW', digits: 1 },
  { key: 'REW', label: 'REW', digits: 1 }, { key: 'Sr', label: 'Sr', digits: 1 },
  { key: 'Ss', label: 'Ss', digits: 1 }, { key: 'S_profile', label: 'S_profile', digits: 1 },
];

const TABLE_COLS = [
  { key: 'date', label: 'Date', format: (v) => v }, { key: 'dap', label: 'DAP', digits: 0 },
  { key: 'ETo', label: 'ETo', digits: 2 }, { key: 'Kcb', label: 'Kcb', digits: 2 },
  { key: 'Ke', label: 'Ke', digits: 2 }, { key: 'Ks', label: 'Ks', digits: 2 },
  { key: 'ETc', label: 'ETc', digits: 2 }, { key: 'T', label: 'T', digits: 2 },
  { key: 'E', label: 'E', digits: 2 }, { key: 'prcp', label: 'P', digits: 1 },
  { key: 'irrig_applied', label: 'Irr', digits: 1 }, { key: 'Dr', label: 'Dr', digits: 0 },
  { key: 'TAW', label: 'TAW', digits: 0 }, { key: 'Zr', label: 'Zr', digits: 2 },
];

function create() {
  let lastResult = null;
  const wb = createWorkbench();

  /* ── Panels ─────────────────────────────────────────────────────────── */

  const inputCharts = createInputCharts();
  const weather = createWeatherPanel({ onChange: () => syncHints(), onData: (rows) => { inputCharts.render(rows); wb.showTab('inputs'); } });
  const soil = createSoilPanel({ onChange: () => syncHints() });
  const crop = createCropPanel({ onChange: () => syncHints(), onPresetChange: (p) => { if (p && isFinite(p.CN)) mgmt.setCurveNumber(p.CN); } });
  const mgmt = createManagementPanel({ onChange: () => syncHints() });
  const options = createOptionsPanel({ onChange: () => syncHints() });
  const planting = dateInput({ onChange: () => syncHints() });

  /* ── Sidebar groups ─────────────────────────────────────────────────── */

  const gWeather = group('Weather & site', { open: true });
  gWeather.body.append(weather.el);
  const gSeason = group('Season', { open: true });
  gSeason.body.append(ctrl('Planting date', planting.el));
  const gSoil = group('Soil');
  gSoil.body.append(soil.el);
  const gCrop = group('Crop', { open: true });
  gCrop.body.append(crop.el);
  const gMgmt = group('Management');
  gMgmt.body.append(mgmt.el);
  const gOptions = group('Model options');
  gOptions.body.append(options.el);
  wb.sidebar.append(gWeather.el, gSeason.el, gSoil.el, gCrop.el, gMgmt.el, gOptions.el);

  /* ── Run bar (sidebar footer) ───────────────────────────────────────── */

  const runBtn = btn('Run simulation', { kind: 'primary', block: true, onClick: run });
  const status = el('div', { class: 'runbar__status' });
  wb.foot.append(el('div', { class: 'runbar' },
    runBtn, status,
    el('div', { class: 'row' },
      btn('Export', { small: true, onClick: exportSettings }),
      btn('Import', { small: true, onClick: importSettings }),
    ),
  ));

  /* ── Canvas: Inputs ─────────────────────────────────────────────────── */

  const inputsEmpty = el('div', { class: 'empty' },
    el('h3', {}, 'No weather loaded'),
    el('p', {}, 'Drop a weather CSV in the sidebar, or load the NW Kansas example. The daily series and monthly normals will plot here.'),
  );
  wb.inputs.append(inputsEmpty, inputCharts.el);
  inputCharts.el.hidden = true;

  /* ── Canvas: Outputs ────────────────────────────────────────────────── */

  const metrics = metricsBar([]);
  const warnBox = warningsBox();
  const charts = createSeasonCharts();
  const table = dataTable(TABLE_COLS);
  const gTable = group('Daily results table');
  gTable.body.append(
    el('div', { style: { margin: '0.4rem 0' } }, btn('Download CSV', { small: true, kind: 'neon', onClick: () => { if (lastResult) downloadCsv('season_results.csv', EXPORT_COLS, lastResult.df); } })),
    table.el,
  );
  wb.outputs.append(el('div', { class: 'stack' }, metrics.el, warnBox.el, charts.el, gTable.el));

  /* ── Frame ──────────────────────────────────────────────────────────── */

  const root = el('div', { class: 'view' }, wb.el);

  /* ── Behaviour ──────────────────────────────────────────────────────── */

  function updateHead() {
    const s = weather.getSummary();
    wb.head.innerHTML = '';
    if (!s) { wb.head.append(el('span', { class: 'hint' }, 'No dataset loaded')); return; }
    const loc = weather.getLocation();
    wb.head.append(
      el('span', {}, `${fmtInt(s.n_days)} days · ${s.n_years} yr`),
      el('span', { style: { color: 'var(--muted)' } }, `${fmtDate(s.date_min)} → ${fmtDate(s.date_max)}`),
    );
    if (isFinite(loc.lat)) {
      wb.head.append(el('span', { style: { color: 'var(--muted)' } }, `${loc.lat.toFixed(2)}°, ${isFinite(loc.lon) ? loc.lon.toFixed(2) : '—'}°`));
    }
  }

  function syncHints() {
    gWeather.setHint(weather.hint(), weather.isReady());
    gSoil.setHint(soil.hint());
    gCrop.setHint(crop.hint());
    gMgmt.setHint(mgmt.hint());
    gOptions.setHint(options.hint());
    options.setClimateAdjustAvailable(weather.hasCorrections());

    const s = weather.getSummary();
    if (s) {
      planting.setRange(s.date_min, s.date_max);
      if (!planting.get()) {
        const lastYear = Math.max(s.years[0], s.years[s.years.length - 1] - 1);
        planting.set(`${lastYear}-05-01`);
      }
      inputsEmpty.hidden = true;
      inputCharts.el.hidden = false;
    }
    const N = crop.seasonLength();
    gSeason.setHint(planting.get() && N > 0 ? `${fmtDate(planting.get())} · ${N}d` : (!planting.get() ? 'pick a date' : 'stage lengths > 0'), planting.get() && N > 0);
    updateHead();
  }

  function setStatus(msg, kind = '') { status.textContent = msg; status.className = `runbar__status${kind ? ` is-${kind}` : ''}`; }

  function run() {
    try {
      setStatus('Running…');
      const t0 = performance.now();
      const { df } = weather.getWeather();
      const plantDate = planting.get();
      if (!plantDate) throw new Error('Pick a planting date.');
      const cropObj = crop.get();
      const N = crop.seasonLength();
      if (!(N > 0)) throw new Error('Crop stage lengths must be positive.');
      const windowDf = sliceWeatherWindow(df, plantDate, N);
      const result = runModel(soil.get(), cropObj, mgmt.getManagement(N), windowDf, options.get());
      const yieldEst = estimateYield(result.df, cropObj);
      result.df.forEach((r, i) => { r.dap = i + 1; });
      lastResult = { ...result, yieldEst };
      renderResults();
      wb.setOutputsEnabled(true);
      wb.showTab('outputs');
      setStatus(`Done in ${Math.round(performance.now() - t0)} ms — ${N} days.`, 'ok');
    } catch (err) {
      console.error(err);
      setStatus(err.message, 'error');
    }
  }

  function renderResults() {
    const { df, balance, warnings, yieldEst } = lastResult;
    const stressDays = df.filter(r => r.Ks < 0.999).length;
    metrics.update([
      { label: 'Precip', value: balance.precipitation, unit: 'mm' },
      { label: 'Irrigation', value: balance.irrigation_gross, unit: 'mm' },
      { label: 'Crop ET', value: balance.transpiration + balance.evaporation + balance.diffusive_loss, unit: 'mm' },
      { label: 'Transpiration', value: balance.transpiration, unit: 'mm' },
      { label: 'Evaporation', value: balance.evaporation, unit: 'mm' },
      { label: 'Runoff', value: balance.runoff, unit: 'mm' },
      { label: 'Deep perc.', value: balance.deep_percolation, unit: 'mm' },
      { label: 'Δ storage', value: balance.storage_change, unit: 'mm' },
      { label: 'Stress days', value: stressDays, unit: 'd' },
      { label: 'Yield est.', accent: true, value: yieldEst === null ? '—' : fmtInt(yieldEst), unit: yieldEst === null ? '' : 'kg/ha', title: 'FAO-33 water-limited yield from the seasonal T/Tx ratio' },
    ]);
    warnBox.update(warnings);
    charts.render(df);
    table.update(df);
  }

  /* ── Settings persistence ───────────────────────────────────────────── */

  function exportSettings() {
    downloadJson('season_settings.json', {
      version: 1, mode: 'single-season', planting_date: planting.get(),
      location: weather.getLocation(), soil_preset: soil.getPresetId(), soil: soil.get(),
      crop_preset: crop.getPresetId(), crop: crop.get(), management: mgmt.getRaw(), options: options.get(),
    });
  }

  async function importSettings() {
    const file = await pickFile('.json');
    if (!file) return;
    try {
      const s = JSON.parse(await readFileText(file));
      if (s.planting_date) planting.set(s.planting_date);
      if (s.location) weather.setLocation(s.location);
      if (s.soil) soil.set(s.soil, s.soil_preset);
      if (s.crop) crop.set(s.crop, s.crop_preset);
      if (s.management) mgmt.setRaw(s.management);
      if (s.options) options.set(s.options);
      syncHints();
      setStatus(`Imported ${file.name}.`, 'ok');
    } catch (err) { setStatus(`Import failed: ${err.message}`, 'error'); }
  }

  syncHints();
  return root;
}

export default { title: 'Single Season', docs: DOCS, create };
