/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/cover-crop-termination/index.js — Cover Crop Termination Timing on
 * the workbench. Sidebar: weather / cover crop / scenarios to compare /
 * fallow after termination / soil / options. Inputs tab: the loaded
 * weather. Outputs tab: the comparison dashboard.
 */

import { CROPS } from '../../core/cropSettings.js';
import { toUtcTimestamp } from '../../core/index.js';
import { el, clear } from '../../ui/dom.js';
import { MONTH_NAMES } from '../../ui/format.js';
import { group, btn, ctrl, monthDayInput, numInput, selectInput, checkbox, subhead } from '../../ui/components.js';
import { downloadJson, pickFile, readFileText } from '../../ui/download.js';
import { createWorkbench } from '../../ui/workbench.js';
import { createInputCharts } from '../../ui/inputCharts.js';
import { createWeatherPanel } from '../../ui/panels/weather.js';
import { createSoilPanel } from '../../ui/panels/soil.js';
import { createCropPanel } from '../../ui/panels/crop.js';
import { createOptionsPanel } from '../../ui/panels/options.js';
import { VIZ } from '../../ui/plotly.js';
import { runComparisonSimulation, nextOccurrence } from './logic.js';
import { createDashboard } from './charts.js';
import { DOCS } from './docs.js';

const MAX_SCENARIOS = 3;
const THRESHOLD_OPTIONS = [50, 60, 70, 80, 90].map(v => ({ value: String(v), label: `${v}%` }));
/* Reference year used only to turn an 'MM-DD' termination into a
   days-after-planting offset for the Kcb curve marker. Any fixed year
   works — the real run replays every historical year. Non-leap so the
   offset is the common case. */
const REF_YEAR = 2001;

const pad2 = (n) => String(n).padStart(2, '0');
const daysBetween = (aIso, bIso) => Math.round((toUtcTimestamp(bIso) - toUtcTimestamp(aIso)) / 86400000);

/** 'MM-DD' → { month (1–12), day }. */
function parseMD(mmdd) {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(mmdd || ''));
  return m ? { month: +m[1], day: +m[2] } : { month: 1, day: 1 };
}

/** 'MM-DD' → 'Mar 15'. */
function mdLabel(mmdd) {
  const { month, day } = parseMD(mmdd);
  return `${MONTH_NAMES[month - 1]} ${day}`;
}

function create() {
  let lastResult = null;
  const wb = createWorkbench();

  /* ── Panels ─────────────────────────────────────────────────────────── */

  const inputCharts = createInputCharts();
  const weather = createWeatherPanel({ onChange: () => syncHints(), onData: (rows) => { inputCharts.render(rows); wb.showTab('inputs'); } });
  const soil = createSoilPanel({ onChange: () => syncHints() });
  const crop = createCropPanel({ onChange: () => syncHints() });
  crop.set(CROPS.rye, 'rye');
  const options = createOptionsPanel({ onChange: () => syncHints() });

  /* Month-day only — the year is meaningless in a historical replay, so the
     pickers don't carry one. Ordering is resolved relationally at run time
     (see the note in the Scenarios group): cover-crop planting is the
     anchor, and termination / cash planting are the next occurrence after
     it, so a fall cover crop terminated in spring rolls into the next year
     on its own. Defaults: rye planted late Sept, terminated Mar/Apr,
     cash crop planted early May. */
  const coverIn = monthDayInput({ value: '09-25', onChange: () => syncHints() });
  const cashIn = monthDayInput({ value: '05-05', onChange: () => syncHints() });
  const baselineCheck = checkbox({ label: 'Include "no cover crop" baseline', checked: true, onChange: () => syncHints() });
  const residueIn = numInput({ value: 50, min: 0, max: 100, step: 5, onChange: () => syncHints() });
  const cnIn = numInput({ value: 91, min: 30, max: 98, step: 1, onChange: () => syncHints() });

  let scenarioDates = ['03-15', '04-15'];
  const scenarioListEl = el('div', {});
  const addScenarioBtn = btn('+ Add termination date', { small: true, block: true, onClick: () => {
    if (scenarioDates.length >= MAX_SCENARIOS) return;
    scenarioDates.push(scenarioDates.length ? scenarioDates[scenarioDates.length - 1] : '04-01');
    renderScenarios();
    syncHints();
  } });

  function renderScenarios() {
    clear(scenarioListEl);
    if (!scenarioDates.length) {
      scenarioListEl.append(el('div', { class: 'hint', style: { padding: '0.3rem 0' } }, 'Add at least one termination date.'));
    }
    scenarioDates.forEach((d, i) => {
      const dIn = monthDayInput({ value: d, onChange: (v) => { scenarioDates[i] = v; syncHints(); } });
      scenarioListEl.append(el('div', { class: 'row', style: { gap: '0.4rem', marginBottom: '0.3rem' } },
        el('div', { class: 'grow' }, dIn.el),
        el('button', { class: 'btn btn--sm', type: 'button', title: 'Remove', 'aria-label': 'Remove termination date', onclick: () => { scenarioDates.splice(i, 1); renderScenarios(); syncHints(); } }, '×'),
      ));
    });
    addScenarioBtn.disabled = scenarioDates.length >= MAX_SCENARIOS;
  }

  const thresholdSel = selectInput({ options: THRESHOLD_OPTIONS, value: '50', onChange: () => { if (lastResult) renderResults(); } });
  const inspectSel = selectInput({ options: [{ value: '', label: '—' }], value: '', onChange: () => { if (lastResult) renderResults(); } });

  /* ── Sidebar groups ─────────────────────────────────────────────────── */

  const gWeather = group('Weather & site', { open: true });
  gWeather.body.append(weather.el);
  const gCrop = group('Cover crop', { open: true });
  gCrop.body.append(
    crop.el,
    el('div', { style: { marginTop: '0.3rem' } }, ctrl('Cover crop planting', coverIn.el)),
    el('div', { class: 'hint', style: { marginTop: '0.35rem' } },
      'On the curve, the cover crop holds at its end Kcb until each termination line; after termination Kcb falls to zero and the soil is fallow until cash planting (gray line).'),
  );
  const gScenarios = group('Scenarios to compare', { open: true });
  gScenarios.body.append(
    subhead('Termination dates'),
    scenarioListEl,
    el('div', { style: { marginTop: '0.2rem' } }, addScenarioBtn),
    el('div', { style: { marginTop: '0.5rem' } }, baselineCheck.el),
    el('div', { style: { marginTop: '0.5rem' } }, ctrl('Cash crop planting', cashIn.el)),
    el('div', { class: 'hint', style: { marginTop: '0.4rem' } },
      'Dates are month-day only. Termination, then cash planting, are read as the next occurrence after the cover crop is planted — a fall cover crop terminated in spring rolls into the next year automatically.'),
  );
  const gFallow = group('Fallow after termination');
  gFallow.body.append(ctrl('Residue cover', residueIn.el, { unit: '%' }), ctrl('Curve number', cnIn.el, { unit: 'CN', title: 'SCS/NRCS runoff curve number (30–98)' }));
  const gSoil = group('Soil');
  gSoil.body.append(soil.el);
  const gOptions = group('Model options');
  gOptions.body.append(options.el);
  wb.sidebar.append(gWeather.el, gCrop.el, gScenarios.el, gFallow.el, gSoil.el, gOptions.el);

  /* ── Run bar ────────────────────────────────────────────────────────── */

  const runBtn = btn('Run comparison', { kind: 'primary', block: true, onClick: run });
  const status = el('div', { class: 'runbar__status' });
  wb.foot.append(el('div', { class: 'runbar' }, runBtn, status,
    el('div', { class: 'row' }, btn('Export', { small: true, onClick: exportSettings }), btn('Import', { small: true, onClick: importSettings }))));

  /* ── Canvas: Inputs ─────────────────────────────────────────────────── */

  const inputsEmpty = el('div', { class: 'empty' },
    el('h3', {}, 'No weather loaded'),
    el('p', {}, 'Drop a weather CSV in the sidebar, or load the NW Kansas example. The daily series will plot here.'),
  );
  wb.inputs.append(inputsEmpty, inputCharts.el);
  inputCharts.el.hidden = true;

  /* ── Canvas: Outputs ────────────────────────────────────────────────── */

  const dashboard = createDashboard();
  const outputControls = el('div', { class: 'row row--wrap', style: { gap: '1.5rem', marginBottom: '0.7rem' } },
    el('label', { class: 'row', style: { gap: '0.5rem' } }, el('span', { class: 'hint' }, 'Threshold'), thresholdSel.el),
    el('label', { class: 'row', style: { gap: '0.5rem' } }, el('span', { class: 'hint' }, 'Inspect option'), inspectSel.el),
  );
  wb.outputs.append(el('div', { class: 'stack' }, outputControls, dashboard.el));

  /* ── Frame ──────────────────────────────────────────────────────────── */

  const root = el('div', { class: 'view' }, wb.el);

  /* ── Behaviour ──────────────────────────────────────────────────────── */

  function updateHead() {
    const s = weather.getSummary();
    wb.head.innerHTML = '';
    if (!s) { wb.head.append(el('span', { class: 'hint' }, 'No dataset loaded')); return; }
    wb.head.append(
      el('span', {}, `${scenarioDates.length} scenario${scenarioDates.length === 1 ? '' : 's'}${baselineCheck.get() ? ' + baseline' : ''}`),
      el('span', { style: { color: 'var(--muted)' } }, `${s.n_years} yr weather loaded`),
    );
  }

  /* Marks up the cover crop's Kcb curve so the whole window is legible at a
     glance: one colored dashed line per termination date (matching its
     series color in the Outputs dashboard) with a faint hold plateau the
     editor draws from the curve's end out to the last termination (the crop
     holds at its end-Kcb until cut, it is NOT fallow yet), plus a single
     gray dashed line for cash-crop planting. The gap between a termination
     line and the cash-planting line is the fallow period. Days are measured
     from cover-crop planting, using a fixed reference year (the real run
     replays every historical year). */
  function updateCurveRefs() {
    const cover = parseMD(coverIn.get());
    const coverDate = `${REF_YEAR}-${pad2(cover.month)}-${pad2(cover.day)}`;
    const lines = scenarioDates.map((d, i) => {
      if (!d) return null;
      const p = parseMD(d);
      const day = daysBetween(coverDate, nextOccurrence(coverDate, p.month, p.day));
      return { day, color: VIZ.series[i % VIZ.series.length], label: mdLabel(d), kind: 'hold' };
    }).filter(l => l && isFinite(l.day) && l.day >= 0);

    /* Cash planting sits after the LATEST termination (that's the order the
       run resolves), so its marker always lands to the right of every
       termination line — bounding the fallow gap. */
    if (lines.length) {
      let latestTerm = coverDate;
      for (const d of scenarioDates) {
        const p = parseMD(d);
        const t = nextOccurrence(coverDate, p.month, p.day);
        if (toUtcTimestamp(t) > toUtcTimestamp(latestTerm)) latestTerm = t;
      }
      const cash = parseMD(cashIn.get());
      const cashDay = daysBetween(coverDate, nextOccurrence(latestTerm, cash.month, cash.day));
      if (isFinite(cashDay) && cashDay > 0) lines.push({ day: cashDay, color: VIZ.muted, label: 'Cash planting', kind: 'plain', dash: '1 3' });
    }
    crop.setRefLines(lines);
  }

  function syncHints() {
    gWeather.setHint(weather.hint(), weather.isReady());
    gCrop.setHint(crop.hint());
    gScenarios.setHint(`${scenarioDates.length} date${scenarioDates.length === 1 ? '' : 's'}`, scenarioDates.length > 0);
    gSoil.setHint(soil.hint());
    gOptions.setHint(options.hint());
    options.setClimateAdjustAvailable(weather.hasCorrections());
    const s = weather.getSummary();
    if (s) { inputsEmpty.hidden = true; inputCharts.el.hidden = false; }
    updateCurveRefs();
    updateHead();
  }

  function setStatus(msg, kind = '') { status.textContent = msg; status.className = `runbar__status${kind ? ` is-${kind}` : ''}`; }

  function run() {
    try {
      setStatus('Running…');
      const t0 = performance.now();
      if (!weather.isReady()) throw new Error('Load weather data first.');
      if (!scenarioDates.length) throw new Error('Add at least one termination date to compare.');
      const { df } = weather.getWeather();
      const cover = parseMD(coverIn.get());
      const cash = parseMD(cashIn.get());
      const scenarios = scenarioDates.map(d => { const p = parseMD(d); return { termMonth: p.month, termDay: p.day }; });

      const result = runComparisonSimulation({
        weatherDf: df,
        scenarios,
        includeBaseline: baselineCheck.get(),
        cropPreset: crop.getPresetId(),
        cropOverrides: crop.get(),
        soil: soil.get(),
        coverMonth: cover.month, coverDay: cover.day,
        cashMonth: cash.month, cashDay: cash.day,
        fallowResiduePct: residueIn.get(),
        fallowCN: cnIn.get(),
        options: options.get(),
      });
      if (!result.some(o => o.runs.length)) throw new Error('No option produced a usable year — check the planting/termination dates against the weather record.');

      lastResult = result;
      inspectSel.setOptions(result.map(o => ({ value: o.id, label: o.label })), result[0].id);
      renderResults();
      wb.setOutputsEnabled(true);
      wb.showTab('outputs');
      setStatus(`Done in ${Math.round(performance.now() - t0)} ms — ${result.length} option(s).`, 'ok');
    } catch (err) { console.error(err); setStatus(err.message, 'error'); }
  }

  function renderResults() {
    dashboard.render(lastResult, { thresholdPct: +thresholdSel.get(), inspectId: inspectSel.get() });
  }

  /* ── Settings persistence ──────────────────────────────────────────── */

  function exportSettings() {
    downloadJson('cover_crop_termination_settings.json', {
      version: 1, mode: 'cover-crop-termination',
      cover_planting_md: coverIn.get(), cash_planting_md: cashIn.get(),
      termination_mds: scenarioDates, include_baseline: baselineCheck.get(),
      fallow_residue_pct: residueIn.get(), fallow_cn: cnIn.get(),
      location: weather.getLocation(), soil_preset: soil.getPresetId(), soil: soil.get(),
      crop_preset: crop.getPresetId(), crop: crop.get(), options: options.get(),
    });
  }

  async function importSettings() {
    const file = await pickFile('.json');
    if (!file) return;
    try {
      const s = JSON.parse(await readFileText(file));
      if (s.cover_planting_md) coverIn.set(s.cover_planting_md);
      if (s.cash_planting_md) cashIn.set(s.cash_planting_md);
      if (Array.isArray(s.termination_mds)) { scenarioDates = s.termination_mds.slice(0, MAX_SCENARIOS); renderScenarios(); }
      if (s.include_baseline !== undefined) baselineCheck.set(s.include_baseline);
      if (s.fallow_residue_pct !== undefined) residueIn.set(s.fallow_residue_pct);
      if (s.fallow_cn !== undefined) cnIn.set(s.fallow_cn);
      if (s.location) weather.setLocation(s.location);
      if (s.soil) soil.set(s.soil, s.soil_preset);
      if (s.crop) crop.set(s.crop, s.crop_preset);
      if (s.options) options.set(s.options);
      syncHints();
      setStatus(`Imported ${file.name}.`, 'ok');
    } catch (err) { setStatus(`Import failed: ${err.message}`, 'error'); }
  }

  renderScenarios();
  syncHints();
  return root;
}

export default { title: 'Cover Crop Termination', docs: DOCS, create };
