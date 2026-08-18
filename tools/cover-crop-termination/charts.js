/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/cover-crop-termination/charts.js — the comparison dashboard: a
 * headline, a probability-by-threshold bar chart, a full risk (exceedance)
 * curve overlay, a per-option year inspector (every year faint, dry/
 * typical/wet years highlighted), and the scenario table with CSV export.
 * Only the threshold reference line is dashed — every actual series is solid,
 * per the app's line-style convention.
 */

import { el } from '../../ui/dom.js';
import { fmtInt, fmtDate, percentile, MONTH_NAMES } from '../../ui/format.js';
import { parseUtcParts } from '../../core/index.js';
import { chartCard, plot, VIZ, rgba } from '../../ui/plotly.js';
import { dataTable, btn, metricsBar, warningsBox } from '../../ui/components.js';
import { downloadCsv } from '../../ui/download.js';
import { MIN_YEARS_FOR_SCENARIO } from '../../core/weather.js';
import { probabilityAtThreshold } from './logic.js';

const OPTION_COLORS = [VIZ.series[0], VIZ.series[1], VIZ.series[2], VIZ.series[3]];
const BASELINE_COLOR = VIZ.muted;
const HIGHLIGHT = { dry: VIZ.stress, typical: VIZ.kcb, wet: VIZ.precip };

function shortDate(iso) {
  const p = parseUtcParts(iso);
  return `${MONTH_NAMES[p.monthIndex]} ${p.day}`;
}

const TABLE_COLS = [
  { key: 'option', label: 'Option', format: (v) => v },
  { key: 'year', label: 'Year', digits: 0 },
  { key: 'coverPlant', label: 'Cover plant', format: (v) => v },
  { key: 'termDate', label: 'Termination', format: (v) => v || '—' },
  { key: 'cashPlant', label: 'Cash plant', format: (v) => v },
  { key: 'finalWaterPct', label: 'Final water', digits: 1 },
  { key: 'rootDepth', label: 'Root depth', digits: 2 },
  { key: 'precip', label: 'Precip', digits: 0 },
  { key: 'etc', label: 'ETc', digits: 0 },
];

/** Colors matched 1:1 with a comparison result's options, in order. */
function colorsFor(comparisonResult) {
  let n = 0;
  return comparisonResult.map(opt => (opt.isBaseline ? BASELINE_COLOR : OPTION_COLORS[n++ % OPTION_COLORS.length]));
}

export function createDashboard() {
  const metrics = metricsBar([]);
  const warnBox = warningsBox();
  const probCard = chartCard('Probability by option', { subtitle: 'chance of reaching the chosen threshold', height: 260 });
  /* Charts carry a y-axis title only; the x-axis meaning lives in the subtitle
     (an in-plot x title spills past the fixed-height card's bottom edge). */
  const riskCard = chartCard('Full risk comparison', { subtitle: 'x: final available water, % · y: share of years reaching it', height: 260 });
  const inspectCard = chartCard('Inspect an option', { subtitle: 'available water vs. days after cover-crop planting · dry / typical / wet years', wide: true, height: 320 });
  const table = dataTable(TABLE_COLS);
  const csvBtn = btn('Download CSV', { small: true, kind: 'neon', onClick: () => downloadTable(lastResult) });

  const root = el('div', { class: 'stack' },
    metrics.el, warnBox.el,
    el('div', { class: 'chart-grid' }, probCard.card, riskCard.card, inspectCard.card),
    el('div', {}, el('div', { class: 'row', style: { margin: '0.4rem 0' } }, csvBtn), table.el),
  );

  let lastResult = null;

  function render(comparisonResult, { thresholdPct = 50, inspectId } = {}) {
    lastResult = comparisonResult;
    const colors = colorsFor(comparisonResult);
    const thresholdFraction = thresholdPct / 100;

    renderHeadlineAndWarn(comparisonResult, colors, thresholdFraction, thresholdPct);
    renderProbabilityBar(comparisonResult, colors, thresholdFraction, thresholdPct);
    renderRiskCurves(comparisonResult, colors);
    const selected = comparisonResult.find(o => o.id === inspectId) || comparisonResult[0];
    renderInspector(selected, colors[comparisonResult.indexOf(selected)], thresholdPct);
    renderTable(comparisonResult);
  }

  function renderHeadlineAndWarn(result, colors, thresholdFraction, thresholdPct) {
    const withProb = result.map(o => ({ ...o, prob: probabilityAtThreshold(o.runs, thresholdFraction) }));
    const nonBaseline = withProb.filter(o => !o.isBaseline);
    const baseline = withProb.find(o => o.isBaseline);
    const best = nonBaseline.length ? nonBaseline.reduce((a, b) => (b.prob > a.prob ? b : a)) : baseline;
    const tiles = [];
    if (best) {
      const bestValue = best.isBaseline ? 'No cover crop' : shortDate(best.runs[0].termDate);
      tiles.push({ label: 'Best termination', value: bestValue, title: 'The termination date with the highest chance of reaching the threshold — the cash-crop planting date is fixed and doesn’t change between options.' });
      tiles.push({ label: `P(≥${thresholdPct}% water)`, accent: true, value: fmtInt(best.prob * 100), unit: '%' });
      if (baseline && best !== baseline) {
        const diff = Math.round((best.prob - baseline.prob) * 100);
        tiles.push({
          label: 'vs. no cover crop', value: `${diff >= 0 ? '+' : ''}${diff}`, unit: '% points',
          title: `Percentage-point difference in P(≥${thresholdPct}% water) versus skipping the cover crop entirely — e.g. going from 50% of years to 62% of years is +12 % points.`,
        });
      }
    }
    const minYears = Math.min(...result.map(o => o.yearsUsed));
    metrics.update(tiles);

    const warnings = [];
    if (minYears < MIN_YEARS_FOR_SCENARIO) warnings.push(`Only ${minYears} year(s) available for at least one option — probabilities this thin are rough guidance, not precise odds.`);
    for (const o of result) if (o.yearsUsed < o.yearsFound) warnings.push(`${o.label}: ${o.yearsFound - o.yearsUsed} of ${o.yearsFound} historical year(s) skipped (window ran past the end of the weather record).`);
    warnBox.update(warnings);
  }

  function renderProbabilityBar(result, colors, thresholdFraction, thresholdPct) {
    const values = result.map(o => probabilityAtThreshold(o.runs, thresholdFraction) * 100);
    plot(probCard.div, [{
      type: 'bar', x: result.map(o => o.label), y: values, marker: { color: colors },
      text: values.map(v => `${Math.round(v)}%`), textposition: 'outside', cliponaxis: false,
      hovertemplate: '%{x}: %{y:.0f}%<extra></extra>',
    }], {
      showlegend: false,
      yaxis: { title: { text: `P(reach ${thresholdPct}% water)` }, range: [0, 115] },
      margin: { l: 48, r: 22, t: 6, b: 70 },
    }, 'cct-probability');
  }

  function renderRiskCurves(result, colors) {
    const traces = result.map((o, i) => {
      const vals = o.runs.map(r => r.finalPawFraction * 100).sort((a, b) => a - b);
      const exceed = vals.map((_, k) => (1 - (k + 1) / vals.length) * 100);
      return {
        type: 'scatter', mode: 'lines', x: vals, y: exceed, name: o.label,
        line: { color: colors[i], width: 2.25 },
        hovertemplate: `${o.label}<br>water ≥ %{x:.0f}%%: %{y:.0f}%% of years<extra></extra>`,
      };
    });
    plot(riskCard.div, traces, {
      yaxis: { title: { text: 'P(meet / exceed), %' }, range: [0, 105] },
      margin: { l: 48, r: 22, t: 6, b: 28 },
    }, 'cct-risk');
  }

  function renderInspector(opt, color, thresholdPct) {
    if (!opt || !opt.runs.length) { plot(inspectCard.div, [], {}, 'cct-inspect'); return; }
    const finals = opt.runs.map(r => r.finalPawFraction);
    const closest = (target) => opt.runs.reduce((best, r, i) => (Math.abs(r.finalPawFraction - target) < Math.abs(opt.runs[best].finalPawFraction - target) ? i : best), 0);
    const idxDry = closest(percentile(finals, 10));
    const idxTyp = closest(percentile(finals, 50));
    const idxWet = closest(percentile(finals, 90));

    const traces = opt.runs.map(r => ({
      type: 'scatter', mode: 'lines', x: r.days.map(d => d.dap), y: r.days.map(d => d.pawFraction * 100),
      line: { color: rgba(VIZ.muted, 0.22), width: 1 }, showlegend: false, hoverinfo: 'skip',
    }));
    [[idxDry, HIGHLIGHT.dry, 'dry year (P10)'], [idxTyp, HIGHLIGHT.typical, 'typical (P50)'], [idxWet, HIGHLIGHT.wet, 'wet year (P90)']]
      .forEach(([idx, c, name]) => {
        const r = opt.runs[idx];
        traces.push({ type: 'scatter', mode: 'lines', x: r.days.map(d => d.dap), y: r.days.map(d => d.pawFraction * 100), name, line: { color: c, width: 2.5 }, hovertemplate: `${name}<br>day %{x}: %{y:.0f}%%<extra></extra>` });
      });

    const maxDap = Math.max(1, ...opt.runs.map(r => r.days.length - 1));
    traces.push({ type: 'scatter', mode: 'lines', x: [0, maxDap], y: [thresholdPct, thresholdPct], name: `${thresholdPct}% threshold`, line: { color: VIZ.baseline, width: 1.5, dash: 'dash' }, hoverinfo: 'skip' });

    plot(inspectCard.div, traces, {
      yaxis: { title: { text: 'whole-profile available water, %' }, range: [0, 110] },
      margin: { l: 48, r: 22, t: 6, b: 28 },
    }, 'cct-inspect');
  }

  function renderTable(result) {
    const rows = [];
    for (const opt of result) {
      for (const r of opt.runs) {
        rows.push({
          option: opt.label, year: r.startYear, coverPlant: fmtDate(r.coverPlantDate),
          termDate: r.termDate ? fmtDate(r.termDate) : null, cashPlant: fmtDate(r.cashPlantDate),
          finalWaterPct: r.finalPawFraction * 100, rootDepth: r.rootDepthReached,
          precip: r.totalPrecip, etc: r.totalETc,
        });
      }
    }
    table.update(rows);
  }

  function downloadTable(result) {
    if (!result) return;
    const rows = [];
    for (const opt of result) {
      for (const r of opt.runs) {
        rows.push({
          option: opt.label, year: r.startYear, cover_plant: r.coverPlantDate,
          termination: r.termDate || '', cash_plant: r.cashPlantDate,
          final_water_pct: r.finalPawFraction * 100, root_depth_m: r.rootDepthReached,
          precip_mm: r.totalPrecip, etc_mm: r.totalETc, runoff_mm: r.totalRunoff,
        });
      }
    }
    downloadCsv('cover_crop_comparison.csv', [
      { key: 'option', label: 'option' }, { key: 'year', label: 'year' },
      { key: 'cover_plant', label: 'cover_plant' }, { key: 'termination', label: 'termination' },
      { key: 'cash_plant', label: 'cash_plant' }, { key: 'final_water_pct', label: 'final_water_pct', digits: 1 },
      { key: 'root_depth_m', label: 'root_depth_m', digits: 2 }, { key: 'precip_mm', label: 'precip_mm', digits: 1 },
      { key: 'etc_mm', label: 'etc_mm', digits: 1 }, { key: 'runoff_mm', label: 'runoff_mm', digits: 1 },
    ], rows);
  }

  return { el: root, render };
}
