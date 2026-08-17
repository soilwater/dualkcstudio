/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * modes/probabilistic/charts.js — the ensemble chart set: percentile fans
 * (or member spaghetti in scenario mode) on a days-after-planting axis,
 * plus the member yield distribution. Members span different calendar
 * years, so DAP is the only x-axis they share.
 */

import { el } from '../../ui/dom.js';
import { percentile, median, cumsum, fmtInt } from '../../ui/format.js';
import { chartCard, plot, linkZoom, VIZ, rgba } from '../../ui/plotly.js';

/* Per-day percentile across the member matrix (rows = members). */
function percentileSeries(matrix, p) {
  const n = matrix[0].length;
  const out = new Array(n);
  for (let d = 0; d < n; d++) out[d] = percentile(matrix.map(row => row[d]), p);
  return out;
}

const FAN_CARDS = [
  { id: 'dr', title: 'Root-zone depletion', subtitle: 'down = drier', col: 'Dr', cum: false, yTitle: 'depletion, mm', reversed: true },
  { id: 'etc', title: 'Cumulative ETc', subtitle: 'actual crop ET running total', col: 'ETc', cum: true, yTitle: 'mm' },
  { id: 'prcp', title: 'Cumulative precipitation', subtitle: 'running total per member', col: 'prcp', cum: true, yTitle: 'mm' },
  { id: 't', title: 'Cumulative transpiration', subtitle: 'running total per member', col: 'T', cum: true, yTitle: 'mm' },
  { id: 'ks', title: 'Stress coefficient Ks', subtitle: '1 = no stress', col: 'Ks', cum: false, yTitle: 'Ks', range: [0, 1.05] },
];

export function createEnsembleCharts() {
  const cards = {};
  for (const c of FAN_CARDS) cards[c.id] = chartCard(c.title, { subtitle: c.subtitle });
  const yieldCard = chartCard('Yield distribution', { subtitle: 'FAO-33 estimate per member, median marked' });

  const root = el('div', { class: 'chart-grid' },
    FAN_CARDS.map(c => cards[c.id].card), yieldCard.card);
  let linked = false;

  /**
   * @param {object[]} members [{year, rows, yieldEst}]
   * @param {object} opts { mode: 'probabilistic'|'scenario', nObs }
   */
  function render(members, { mode = 'probabilistic', nObs = 0 } = {}) {
    if (!members.length) return;
    const minLen = Math.min(...members.map(m => m.rows.length));
    const dap = Array.from({ length: minLen }, (_, i) => i + 1);

    for (const c of FAN_CARDS) {
      const matrix = members.map(m => {
        const vals = m.rows.slice(0, minLen).map(r => r[c.col]);
        return c.cum ? cumsum(vals) : vals;
      });
      const traces = mode === 'scenario'
        ? scenarioTraces(dap, matrix, members, Math.min(nObs, minLen))
        : fanTraces(dap, matrix);
      plot(cards[c.id].div, traces, {
        xaxis: { title: { text: 'days after planting' } },
        yaxis: {
          title: { text: c.yTitle },
          ...(c.reversed ? { autorange: 'reversed' } : {}),
          ...(c.range ? { range: c.range } : { rangemode: 'tozero' }),
        },
      }, `ensemble-${c.id}`);
    }

    renderYield(members);

    if (!linked && window.Plotly) {
      linkZoom(FAN_CARDS.map(c => cards[c.id].div));
      linked = true;
    }
  }

  /* P10–P90 and P25–P75 bands with the median line. */
  function fanTraces(dap, matrix) {
    return [
      { type: 'scatter', mode: 'lines', x: dap, y: percentileSeries(matrix, 10), line: { width: 0 }, showlegend: false, hoverinfo: 'skip' },
      {
        type: 'scatter', mode: 'lines', x: dap, y: percentileSeries(matrix, 90), name: 'P10–P90',
        fill: 'tonexty', fillcolor: rgba(VIZ.band90, 0.85), line: { width: 0 }, hoverinfo: 'skip',
      },
      { type: 'scatter', mode: 'lines', x: dap, y: percentileSeries(matrix, 25), line: { width: 0 }, showlegend: false, hoverinfo: 'skip' },
      {
        type: 'scatter', mode: 'lines', x: dap, y: percentileSeries(matrix, 75), name: 'P25–P75',
        fill: 'tonexty', fillcolor: rgba(VIZ.band50, 0.85), line: { width: 0 }, hoverinfo: 'skip',
      },
      {
        type: 'scatter', mode: 'lines', x: dap, y: percentileSeries(matrix, 50), name: 'Median',
        line: { color: VIZ.median, width: 2 }, hovertemplate: '%{y:.1f}<extra>median</extra>',
      },
    ];
  }

  /* Every member faint, the interquartile band, the median, and the
     observed portion (identical across members) on top. */
  function scenarioTraces(dap, matrix, members, nObs) {
    const traces = matrix.map((row, i) => ({
      type: 'scatter', mode: 'lines', x: dap, y: row,
      name: 'Members', legendgroup: 'members', showlegend: i === 0,
      line: { color: rgba(VIZ.median, 0.18), width: 1 },
      hovertemplate: '%{y:.1f}<extra>' + members[i].year + '</extra>',
    }));
    traces.push(
      { type: 'scatter', mode: 'lines', x: dap, y: percentileSeries(matrix, 25), line: { width: 0 }, showlegend: false, hoverinfo: 'skip' },
      {
        type: 'scatter', mode: 'lines', x: dap, y: percentileSeries(matrix, 75), name: 'P25–P75',
        fill: 'tonexty', fillcolor: rgba(VIZ.band50, 0.55), line: { width: 0 }, hoverinfo: 'skip',
      },
      {
        type: 'scatter', mode: 'lines', x: dap, y: percentileSeries(matrix, 50), name: 'Median',
        line: { color: VIZ.median, width: 2 }, hovertemplate: '%{y:.1f}<extra>median</extra>',
      },
    );
    if (nObs > 0) {
      traces.push({
        type: 'scatter', mode: 'lines', x: dap.slice(0, nObs), y: matrix[0].slice(0, nObs),
        name: 'Observed', line: { color: VIZ.observed, width: 3 },
        hovertemplate: '%{y:.1f}<extra>observed</extra>',
      });
    }
    return traces;
  }

  function renderYield(members) {
    const yields = members.map(m => m.yieldEst).filter(y => y !== null && isFinite(y));
    if (!yields.length) {
      yieldCard.card.hidden = true;
      return;
    }
    yieldCard.card.hidden = false;
    const med = median(yields);
    plot(yieldCard.div, [{
      type: 'histogram', x: yields, name: 'Members',
      marker: { color: rgba(VIZ.median, 0.55), line: { color: VIZ.median, width: 1 } },
      hovertemplate: '%{x} kg/ha: %{y} member(s)<extra></extra>',
    }], {
      xaxis: { title: { text: 'yield estimate, kg/ha' } },
      yaxis: { title: { text: 'members' }, rangemode: 'tozero' },
      bargap: 0.05,
      shapes: [{
        type: 'line', x0: med, x1: med, y0: 0, y1: 1, yref: 'paper',
        line: { color: VIZ.ink, width: 2, dash: 'dash' },
      }],
      annotations: [{
        x: med, y: 1, yref: 'paper', yanchor: 'bottom', showarrow: false,
        text: `median ${fmtInt(med)}`, font: { size: 11, color: VIZ.ink },
      }],
    }, 'ensemble-yield');
  }

  return { el: root, render };
}
