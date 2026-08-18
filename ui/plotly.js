/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * plotly.js — the one place Plotly is configured. Base layout (fonts, grid,
 * margins, hover), the semantic series palette (mirrors styles/tokens.css),
 * chart-card scaffolding, and linked x-axis zoom across a chart group.
 *
 * Plotly itself is loaded once from the CDN in index.html (pinned version).
 * If it failed to load (offline), plot() renders a friendly notice instead
 * of throwing, so the rest of the app still works.
 */

import { el } from './dom.js';

/* Semantic chart colors — dark theme, keep in sync with styles/tokens.css. */
export const VIZ = {
  precip: '#3987e5',
  irrig: '#199e70',
  t: '#2fa84f',
  e: '#c98500',
  etc: '#d95926',
  eto: '#b0b6c0',
  kcb: '#00b9a1',
  kc: '#cdd1d6',
  stress: '#df4600',
  storage: '#9085e9',
  band90: '#16304d',
  band50: '#235a94',
  median: '#5cb0ff',
  observed: '#f5f6f8',
  ink: '#f5f6f8',
  ink2: '#c3c8d2',
  muted: '#7f8794',
  grid: '#242932',
  baseline: '#363c47',
  series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#2fa84f', '#9085e9', '#e66767'],
};

/** rgba() helper for band fills from a hex color. */
export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]))
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

const AXIS = {
  gridcolor: VIZ.grid,
  linecolor: VIZ.baseline,
  zeroline: false,
  ticks: '',
  tickfont: { size: 11, color: VIZ.muted },
  titlefont: { size: 12, color: VIZ.ink2 },
  automargin: true,
};

function baseLayout(overrides = {}) {
  return deepMerge({
    font: { family: 'Inter, "Segoe UI", sans-serif', size: 12, color: VIZ.ink2 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    margin: { l: 52, r: 14, t: 8, b: 38 },
    hovermode: 'x unified',
    hoverlabel: { bgcolor: '#1e222a', bordercolor: VIZ.baseline, font: { size: 11.5, color: VIZ.ink } },
    xaxis: { ...AXIS },
    yaxis: { ...AXIS },
    legend: {
      orientation: 'h',
      yanchor: 'bottom', y: 1.01,
      xanchor: 'left', x: 0,
      font: { size: 11.5, color: VIZ.ink2 },
    },
    modebar: { color: VIZ.muted, activecolor: VIZ.kcb, bgcolor: 'rgba(0,0,0,0)' },
    showlegend: true,
  }, overrides);
}

function plotConfig(filename = 'chart') {
  return {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d', 'zoomIn2d', 'zoomOut2d'],
    toImageButtonOptions: { format: 'png', scale: 2, filename },
  };
}

/** Render (or re-render) traces into a div. Safe if Plotly failed to load. */
export function plot(div, traces, layout = {}, filename = 'chart') {
  if (!window.Plotly) {
    div.innerHTML = '<div class="callout callout--warn">Charts unavailable: the Plotly library could not be loaded (no network?). Model results and tables still work.</div>';
    return;
  }
  window.Plotly.react(div, traces, baseLayout(layout), plotConfig(filename));
  /* A chart often renders before its flex/grid container has a resolved
     size (so Plotly measures 0 or a stale height). Re-fit to the container
     once layout settles — unconditionally, not via react's promise. */
  requestAnimationFrame(() => fit(div));
  observeResize(div);
}

function fit(div) {
  if (div._fullLayout && div.clientWidth > 0 && div.clientHeight > 0) window.Plotly.Plots.resize(div);
}

/**
 * A per-div ResizeObserver re-fits Plotly whenever the container's box
 * changes — the reliable cure for charts that were first drawn hidden
 * (a tab pane) or at 0 height, attached once per div.
 */
function observeResize(div) {
  if (div._resizeObserved || typeof ResizeObserver === 'undefined') return;
  div._resizeObserved = true;
  new ResizeObserver(() => fit(div)).observe(div);
}

/**
 * Standard chart card: header (title + optional subtitle) above a plot div.
 * Returns { card, div } — call plot(div, …) whenever results change.
 */
export function chartCard(title, { subtitle, wide = false, height = 280 } = {}) {
  /* A DEFINITE height (not min-height): Plotly fits to it predictably, and
     the container never follows the SVG's own size — which otherwise lets a
     chart that first drew tall stay stuck tall (a resize feedback trap). */
  const div = el('div', { class: 'chart-card__plot', style: { height: `${height}px` } });
  const card = el('div', { class: `card chart-card${wide ? ' chart-card--wide' : ''}` },
    el('div', { class: 'chart-card__head' },
      el('div', { class: 'chart-card__title' }, title),
      subtitle ? el('div', { class: 'chart-card__sub' }, subtitle) : null,
    ),
    div,
  );
  return { card, div };
}

/**
 * Link x-axis zoom/pan across a group of rendered chart divs: relayout on
 * one propagates to the others (guarded against feedback loops).
 */
export function linkZoom(divs) {
  if (!window.Plotly) return;
  /* Only a div that has been plotted has Plotly's .on(); a card that was
     skipped (e.g. no wind column in the file) must not break the linking. */
  divs = divs.filter(d => d && typeof d.on === 'function');
  let busy = false;
  for (const d of divs) {
    /* Safe to call again after a re-render: replace, don't stack, handlers. */
    if (typeof d.removeAllListeners === 'function') d.removeAllListeners('plotly_relayout');
    d.on('plotly_relayout', (ev) => {
      if (busy) return;
      const upd = {};
      if (ev['xaxis.range[0]'] !== undefined) {
        upd['xaxis.range'] = [ev['xaxis.range[0]'], ev['xaxis.range[1]']];
      } else if (ev['xaxis.autorange']) {
        upd['xaxis.autorange'] = true;
      } else return;
      busy = true;
      Promise.all(divs.filter(o => o !== d).map(o => window.Plotly.relayout(o, upd)))
        .finally(() => { busy = false; });
    });
  }
}
