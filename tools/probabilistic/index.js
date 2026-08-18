/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/probabilistic/index.js — Probabilistic & Scenario mode on the
 * workbench: compact control sidebar (adds an Analysis group), a tabbed
 * canvas showing the loaded weather (Inputs) and the ensemble (Outputs).
 */

import { MIN_YEARS_FOR_SCENARIO } from '../../core/weather.js';
import { ANALOG_METHODS, ANALOG_VARS } from '../../core/appConstants.js';
import { el } from '../../ui/dom.js';
import { fmtInt, fmtDate, median, percentile, MONTH_NAMES } from '../../ui/format.js';
import { group, btn, ctrl, dateInput, monthDayInput, numInput, selectInput, segmented, subhead, metricsBar, dataTable, warningsBox, callout } from '../../ui/components.js';
import { downloadCsv, downloadJson, pickFile, readFileText } from '../../ui/download.js';
import { createWorkbench } from '../../ui/workbench.js';
import { createInputCharts } from '../../ui/inputCharts.js';
import { createWeatherPanel } from '../../ui/panels/weather.js';
import { createSoilPanel } from '../../ui/panels/soil.js';
import { createCropPanel } from '../../ui/panels/crop.js';
import { createManagementPanel } from '../../ui/panels/management.js';
import { createOptionsPanel } from '../../ui/panels/options.js';
import { runProbabilistic, runScenario } from './orchestration.js';
import { createEnsembleCharts } from './charts.js';
import { DOCS } from './docs.js';

const CSV_COLS = [
  { key: 'year', label: 'year' }, { key: 'dap', label: 'dap' }, { key: 'date', label: 'date' },
  { key: 'ETo', label: 'ETo', digits: 2 }, { key: 'ETc', label: 'ETc', digits: 2 },
  { key: 'T', label: 'T', digits: 2 }, { key: 'E', label: 'E', digits: 2 },
  { key: 'prcp', label: 'prcp', digits: 1 }, { key: 'irrig', label: 'irrig', digits: 1 },
  { key: 'Dr', label: 'Dr', digits: 1 }, { key: 'Ks', label: 'Ks', digits: 3 },
];

const RANK_COLS = [
  { key: 'rank', label: 'Rank', digits: 0 }, { key: 'year', label: 'Year', format: (v) => String(v) },
  { key: 'score', label: 'Score', digits: 3 }, { key: 'used', label: 'Member', format: (v) => v },
];

const pad2 = (n) => String(n).padStart(2, '0');

/** 'MM-DD' → 'May 1' (falls back to the raw string). */
function mdLabel(mmdd) {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(mmdd || ''));
  return m ? `${MONTH_NAMES[+m[1] - 1]} ${+m[2]}` : String(mmdd || '');
}

function create() {
  let lastRun = null;
  const wb = createWorkbench();

  const inputCharts = createInputCharts();
  const weather = createWeatherPanel({ onChange: () => syncHints(), onData: (rows) => { inputCharts.render(rows); wb.showTab('inputs'); } });
  const soil = createSoilPanel({ onChange: () => syncHints() });
  const crop = createCropPanel({ onChange: () => syncHints(), onPresetChange: (p) => { if (p && isFinite(p.CN)) mgmt.setCurveNumber(p.CN); } });
  const mgmt = createManagementPanel({ onChange: () => syncHints() });
  const options = createOptionsPanel({ onChange: () => syncHints() });

  /* ── Analysis controls ──────────────────────────────────────────────── */

  const modeSeg = segmented({ options: [{ value: 'probabilistic', label: 'Probabilistic' }, { value: 'scenario', label: 'Scenario' }], value: 'probabilistic', onChange: () => { syncAnalysisVisibility(); syncHints(); } });
  const plantMD = monthDayInput({ value: '05-01', onChange: () => syncHints() });
  const probGroup = el('div', {},
    ctrl('Planting date', plantMD.el),
    el('div', { class: 'hint' }, 'Month-day only. Planted on this date in every year of the record; each complete year is one member.'),
  );
  const yearsWarn = el('div', { style: { marginTop: '0.4rem' }, hidden: true });

  const planting = dateInput({ onChange: () => syncHints() });
  const cutoff = dateInput({ onChange: () => syncHints() });
  const scenSeg = segmented({ options: [{ value: 'all_years', label: 'All years' }, { value: 'analog', label: 'Analog' }], value: 'all_years', onChange: () => { syncAnalysisVisibility(); syncHints(); } });
  const nAnalogsIn = numInput({ value: 5, min: 1, max: 30, step: 1, onChange: () => syncHints() });
  const methodSel = selectInput({ options: Object.entries(ANALOG_METHODS).map(([value, label]) => ({ value, label })), value: 'nse', onChange: () => syncHints() });
  const varSel = selectInput({ options: Object.entries(ANALOG_VARS).map(([value, label]) => ({ value, label })), value: 'prcp', onChange: () => syncHints() });
  const analogGroup = el('div', { hidden: true }, ctrl('Analog years N', nAnalogsIn.el), ctrl('Method', methodSel.el), ctrl('Variable', varSel.el));
  const scenGroup = el('div', { hidden: true },
    ctrl('Planting date', planting.el),
    ctrl('Observed until', cutoff.el, { title: 'Weather up to this date is observed; each candidate year supplies the rest' }),
    subhead('Continuation'),
    ctrl('Donors', scenSeg.el),
    analogGroup,
  );

  /* ── Sidebar groups ─────────────────────────────────────────────────── */

  const gWeather = group('Weather & site', { open: true });
  gWeather.body.append(weather.el);
  const gAnalysis = group('Analysis', { open: true });
  gAnalysis.body.append(ctrl('Type', modeSeg.el), probGroup, scenGroup, yearsWarn);
  const gSoil = group('Soil');
  gSoil.body.append(soil.el);
  const gCrop = group('Crop', { open: true });
  gCrop.body.append(crop.el);
  const gMgmt = group('Management');
  gMgmt.body.append(mgmt.el);
  const gOptions = group('Model options');
  gOptions.body.append(options.el);
  wb.sidebar.append(gWeather.el, gAnalysis.el, gSoil.el, gCrop.el, gMgmt.el, gOptions.el);

  const runBtn = btn('Run ensemble', { kind: 'primary', block: true, onClick: run });
  const status = el('div', { class: 'runbar__status' });
  wb.foot.append(el('div', { class: 'runbar' }, runBtn, status,
    el('div', { class: 'row' }, btn('Export', { small: true, onClick: exportSettings }), btn('Import', { small: true, onClick: importSettings }))));

  /* ── Canvas ─────────────────────────────────────────────────────────── */

  const inputsEmpty = el('div', { class: 'empty' }, el('h3', {}, 'No weather loaded'), el('p', {}, 'Drop a weather CSV in the sidebar, or load the NW Kansas example.'));
  wb.inputs.append(inputsEmpty, inputCharts.el);
  inputCharts.el.hidden = true;

  const metrics = metricsBar([]);
  const warnBox = warningsBox();
  const charts = createEnsembleCharts();
  const rankTable = dataTable(RANK_COLS, { maxHeight: '22rem' });
  const rankHint = el('div', { class: 'hint', style: { margin: '0.4rem 0' } });
  const gRank = group('Analog ranking');
  gRank.body.append(rankHint, rankTable.el);
  wb.outputs.append(el('div', { class: 'stack' },
    metrics.el, warnBox.el,
    el('div', {}, btn('Download ensemble CSV', { small: true, kind: 'neon', onClick: downloadEnsemble })),
    charts.el, gRank.el));

  const root = el('div', { class: 'view' }, wb.el);

  /* ── Behaviour ──────────────────────────────────────────────────────── */

  function syncAnalysisVisibility() {
    const m = modeSeg.get();
    probGroup.hidden = m !== 'probabilistic';
    scenGroup.hidden = m !== 'scenario';
    analogGroup.hidden = scenSeg.get() !== 'analog';
  }

  function updateHead() {
    const s = weather.getSummary();
    wb.head.innerHTML = '';
    if (!s) { wb.head.append(el('span', { class: 'hint' }, 'No dataset loaded')); return; }
    wb.head.append(
      el('span', {}, `${fmtInt(s.n_days)} days · ${s.n_years} yr`),
      el('span', { style: { color: 'var(--muted)' } }, `${fmtDate(s.date_min)} → ${fmtDate(s.date_max)}`),
    );
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
      planting.setRange(s.date_min, s.date_max); cutoff.setRange(s.date_min, s.date_max);
      if (!planting.get()) { const guess = `${s.years[s.years.length - 1]}-04-15`; planting.set(guess <= s.date_max && guess >= s.date_min ? guess : s.date_min); }
      if (!cutoff.get()) cutoff.set(s.date_max);
      inputsEmpty.hidden = true; inputCharts.el.hidden = false;
    }
    yearsWarn.hidden = !(s && s.n_years < MIN_YEARS_FOR_SCENARIO);
    if (!yearsWarn.hidden) { yearsWarn.innerHTML = ''; yearsWarn.append(callout('warn', `Only ${s.n_years} year(s); ≥${MIN_YEARS_FOR_SCENARIO} recommended.`)); }

    if (modeSeg.get() === 'probabilistic') gAnalysis.setHint(mdLabel(plantMD.get()), true);
    else if (planting.get() && cutoff.get()) gAnalysis.setHint(scenSeg.get() === 'analog' ? `${fmtInt(nAnalogsIn.get())} analogs` : 'all years', true);
    else gAnalysis.setHint(!planting.get() ? 'pick planting date' : 'pick cutoff date');
    updateHead();
  }

  function setStatus(msg, kind = '') { status.textContent = msg; status.className = `runbar__status${kind ? ` is-${kind}` : ''}`; }

  function run() {
    try {
      setStatus('Running ensemble…');
      const t0 = performance.now();
      const { df } = weather.getWeather();
      const cropObj = crop.get();
      const seasonLen = crop.seasonLength();
      if (!(seasonLen > 0)) throw new Error('Crop stage lengths must be positive.');
      const common = { df, seasonLen, soil: soil.get(), crop: cropObj, management: mgmt.getManagement(seasonLen), options: options.get() };
      const kind = modeSeg.get();
      if (kind === 'probabilistic') {
        const out = runProbabilistic({ ...common, plantMonthDay: plantMD.get() });
        if (!out.members.length) throw new Error('No year fits a complete season from that planting date.');
        lastRun = { kind, ...out, nObs: 0, ranking: null, nAnalogs: 0 };
      } else {
        const plantDate = planting.get(), cutDate = cutoff.get();
        if (!plantDate || !cutDate) throw new Error('Pick a planting date and a cutoff date.');
        if (cutDate < plantDate) throw new Error('The cutoff must be on or after the planting date.');
        const nAnalogs = Math.max(1, Math.round(nAnalogsIn.get() || 5));
        const out = runScenario({ ...common, plantingDate: plantDate, cutoffDate: cutDate, scenarioType: scenSeg.get(), nAnalogs, analogMethod: methodSel.get(), analogVar: varSel.get() });
        if (!out.members.length) throw new Error('No candidate year could supply a complete continuation.');
        lastRun = { kind, ...out, nAnalogs };
      }
      renderResults();
      wb.setOutputsEnabled(true);
      wb.showTab('outputs');
      setStatus(`Done in ${Math.round(performance.now() - t0)} ms — ${lastRun.members.length} members.`, 'ok');
    } catch (err) { console.error(err); setStatus(err.message, 'error'); }
  }

  function renderResults() {
    const { kind, members, skippedYears, nObs, ranking, nAnalogs } = lastRun;
    const medOf = (f) => median(members.map(f));
    const yields = members.map(m => m.yieldEst).filter(y => y !== null && isFinite(y));
    const tiles = [{ label: 'Members', value: members.length, digits: 0 }];
    if (yields.length) tiles.push(
      { label: 'Yield med.', accent: true, value: fmtInt(median(yields)), unit: 'kg/ha', title: 'FAO-33 water-limited yield, median across members' },
      { label: 'Yield IQR', value: `${fmtInt(percentile(yields, 25))}–${fmtInt(percentile(yields, 75))}`, unit: 'kg/ha', title: 'P25–P75 across members' },
    );
    tiles.push(
      { label: 'Median ETc', value: medOf(m => m.balance.transpiration + m.balance.evaporation + m.balance.diffusive_loss), unit: 'mm' },
      { label: 'Median T', value: medOf(m => m.balance.transpiration), unit: 'mm' },
      { label: 'Median precip', value: medOf(m => m.balance.precipitation), unit: 'mm' },
      { label: 'Median irrig', value: medOf(m => m.balance.irrigation_gross), unit: 'mm' },
    );
    metrics.update(tiles);

    const counts = new Map();
    for (const m of members) for (const w of m.warnings) counts.set(w, (counts.get(w) || 0) + 1);
    const warnings = Array.from(counts, ([w, n]) => n === members.length ? w : `${w} (${n} of ${members.length})`);
    if (skippedYears.length) warnings.push(`Skipped ${skippedYears.length} year(s) with incomplete windows: ${skippedYears.join(', ')}.`);
    if (kind === 'probabilistic' && members.length < MIN_YEARS_FOR_SCENARIO) warnings.push(`Only ${members.length} member(s) — bands will be noisy.`);
    warnBox.update(warnings);

    charts.render(members, { mode: kind === 'scenario' ? 'scenario' : 'probabilistic', nObs });
    gRank.el.hidden = !ranking;
    if (ranking) {
      rankHint.textContent = `Similarity of each year's cumulative ${varSel.get() === 'eto' ? 'ETo' : 'precipitation'} over the ${nObs} observed day(s). Top ${fmtInt(nAnalogs)} are the members.`;
      rankTable.update(ranking.map((a, i) => ({ rank: i + 1, year: a.year, score: a.score, used: i < nAnalogs ? '✓' : '' })));
    }
  }

  function downloadEnsemble() {
    if (!lastRun) return;
    const rows = [];
    for (const m of lastRun.members) for (const r of m.rows) rows.push({ year: m.year, dap: r.dap, date: r.date, ETo: r.ETo, ETc: r.ETc, T: r.T, E: r.E, prcp: r.prcp, irrig: r.irrig_applied, Dr: r.Dr, Ks: r.Ks });
    downloadCsv('ensemble_results.csv', CSV_COLS, rows);
  }

  function exportSettings() {
    downloadJson('probabilistic_settings.json', {
      version: 1, mode: 'probabilistic',
      analysis: { type: modeSeg.get(), plant_md: plantMD.get(), planting_date: planting.get(), cutoff_date: cutoff.get(), scenario_type: scenSeg.get(), n_analogs: nAnalogsIn.get(), analog_method: methodSel.get(), analog_var: varSel.get() },
      location: weather.getLocation(), soil_preset: soil.getPresetId(), soil: soil.get(), crop_preset: crop.getPresetId(), crop: crop.get(), management: mgmt.getRaw(), options: options.get(),
    });
  }

  async function importSettings() {
    const file = await pickFile('.json');
    if (!file) return;
    try {
      const s = JSON.parse(await readFileText(file));
      const a = s.analysis || {};
      if (a.type) modeSeg.set(a.type);
      if (a.plant_md) plantMD.set(a.plant_md);
      else if (isFinite(a.plant_month) && isFinite(a.plant_day)) plantMD.set(`${pad2(a.plant_month)}-${pad2(a.plant_day)}`);
      if (a.planting_date) planting.set(a.planting_date);
      if (a.cutoff_date) cutoff.set(a.cutoff_date);
      if (a.scenario_type) scenSeg.set(a.scenario_type);
      if (isFinite(a.n_analogs)) nAnalogsIn.set(a.n_analogs);
      if (a.analog_method) methodSel.set(a.analog_method);
      if (a.analog_var) varSel.set(a.analog_var);
      if (s.location) weather.setLocation(s.location);
      if (s.soil) soil.set(s.soil, s.soil_preset);
      if (s.crop) crop.set(s.crop, s.crop_preset);
      if (s.management) mgmt.setRaw(s.management);
      if (s.options) options.set(s.options);
      syncAnalysisVisibility(); syncHints();
      setStatus(`Imported ${file.name}.`, 'ok');
    } catch (err) { setStatus(`Import failed: ${err.message}`, 'error'); }
  }

  syncAnalysisVisibility();
  syncHints();
  return root;
}

export default { title: 'Probabilistic & Scenario', docs: DOCS, create };
