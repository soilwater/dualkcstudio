/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * modes/rotation/charts.js — the cycle timeline (one rotation cycle's
 * stitched Kcb curve, one colored segment per block) and the rotation
 * wheel (calendar-year ring chart of what occupies the field when).
 * The daily result charts reuse ui/seasonCharts.js.
 */

import { chartCard, plot, VIZ, rgba } from '../../ui/plotly.js';
import { buildRotation, blockDuration, cycleDays } from './blocks.js';

export function createTimeline() {
  const { card, div } = chartCard('Cycle timeline', { subtitle: 'stitched Kcb over one rotation cycle', wide: true, height: 200 });
  /* The timeline lives in a flex stack, not a fixed-height grid cell; pin
     min-height/overflow so the container never follows the SVG's own size. */
  div.style.minHeight = '0';
  div.style.overflow = 'hidden';

  function render(blocks, { zrFloor = 0.3 } = {}) {
    if (!blocks.length) { plot(div, [], { xaxis: { visible: false }, yaxis: { visible: false }, showlegend: false }); return; }
    const built = buildRotation(blocks, 1, { zrFloor });
    const traces = [];
    const shapes = [];
    const annotations = [];
    const seen = new Set();
    for (const m of built.blocksMeta) {
      const xs = [], ys = [];
      for (let d = m.startDay; d <= m.endDay; d++) { xs.push(d); ys.push(built.Kcb[d]); }
      traces.push({
        type: 'scatter', mode: 'lines', x: xs, y: ys, name: m.name,
        line: { color: m.color, width: 2.25 }, fill: 'tozeroy', fillcolor: rgba(m.color, 0.18),
        showlegend: !seen.has(m.name), legendgroup: m.name,
        hovertemplate: `day %{x} · Kcb %{y:.2f}<extra>${m.name}</extra>`,
      });
      seen.add(m.name);
      shapes.push({ type: 'line', x0: m.startDay, x1: m.startDay, y0: 0, y1: 1, yref: 'paper', line: { color: VIZ.grid, width: 1 } });
      if (m.endDay - m.startDay > built.totalDays * 0.04) {
        annotations.push({
          x: (m.startDay + m.endDay) / 2, y: 1.02, yref: 'paper', text: m.name, showarrow: false,
          font: { size: 10.5, color: VIZ.ink2 }, xanchor: 'center', yanchor: 'bottom',
        });
      }
    }
    plot(div, traces, {
      shapes, annotations, showlegend: false,
      margin: { l: 44, r: 12, t: 26, b: 36 },
      xaxis: { title: { text: 'day of cycle' }, range: [0, built.totalDays] },
      yaxis: { title: { text: 'Kcb' }, rangemode: 'tozero' },
      hovermode: 'closest',
    }, 'rotation-timeline');
  }

  return { el: card, render };
}

const MONTH_SHORT = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/* Two-letter code for a wedge: first letters of the first two words, else the first letter. */
function wheelLabel(name) {
  const base = name.replace(/\s*\([^)]*\)\s*/g, '').trim();
  const words = base.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return base.slice(0, 1).toUpperCase();
}

/**
 * Rotation wheel — one revolution = ONE cycle of the rotation. Three
 * concentric rings: rotation year (inner),
 * calendar month anchored at the start date (middle), and the crop/fallow
 * components (outer, block-coloured). Center shows the % of the cycle under
 * a crop. Shows the rotation STRUCTURE, so it renders live from the builder,
 * before any run.
 */
export function createWheel() {
  const { card, div } = chartCard('Rotation wheel', { subtitle: 'one cycle · one revolution', height: 320 });

  /* @param blocks one cycle of blocks; @param startDate ISO anchor for months */
  function render(blocks, startDate) {
    if (!blocks || !blocks.length || !window.Plotly) return;
    const totalDays = cycleDays(blocks);
    const anchor = startDate ? new Date(`${startDate}T00:00:00Z`) : new Date('2000-01-01T00:00:00Z');

    /* Ring 1 (inner): rotation years, 365-day segments. */
    const yearVals = [], yearLabels = [];
    for (let d0 = 0; d0 < totalDays; d0 += 365) { yearVals.push(Math.min(365, totalDays - d0)); yearLabels.push('Y' + yearVals.length); }
    const YEAR_COLORS = ['#24313f', '#2c2536'];

    /* Ring 2 (middle): calendar months from the anchor; partial edge months unlabeled. */
    const monthVals = [], monthLabels = [], monthHover = [];
    let cur = new Date(anchor), covered = 0;
    while (covered < totalDays) {
      const monthStart = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), 1));
      const nextMonth = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
      const daysInMonth = Math.round((nextMonth - monthStart) / 86400000);
      const remainingInMonth = Math.round((nextMonth - cur) / 86400000);
      const span = Math.min(totalDays - covered, remainingInMonth);
      const isFull = cur.getTime() === monthStart.getTime() && span === daysInMonth;
      monthVals.push(span);
      monthLabels.push(isFull ? MONTH_SHORT[cur.getUTCMonth()] : '');
      monthHover.push(`${MONTH_LONG[cur.getUTCMonth()]} (${span} d)`);
      covered += span; cur = nextMonth;
    }
    const MONTH_COLORS = ['#1a1e25', '#232830'];

    /* Ring 3 (outer): the components. */
    const phaseVals = blocks.map(b => blockDuration(b));
    const phaseLabels = blocks.map(b => wheelLabel(b.name));
    const phaseHover = blocks.map((b, i) => `${b.name} — ${phaseVals[i]} d (${(100 * phaseVals[i] / totalDays).toFixed(1)}%)`);
    const phaseColors = blocks.map(b => b.color);

    const R = { phaseOut: 1.0, phaseIn: 0.72, monthIn: 0.5, yearIn: 0.3 };
    const domainFor = (rOuter) => { const lo = (1 - rOuter) / 2, hi = (1 + rOuter) / 2; return { x: [lo, hi], y: [lo, hi] }; };
    const common = { type: 'pie', sort: false, direction: 'clockwise', rotation: 0, textposition: 'inside', textinfo: 'text', insidetextorientation: 'horizontal', showlegend: false };

    const tracePhase = { ...common, values: phaseVals, text: phaseLabels, hovertext: phaseHover, hoverinfo: 'text', textfont: { size: 13, color: '#0d1608' }, domain: domainFor(R.phaseOut), hole: R.phaseIn / R.phaseOut, marker: { colors: phaseColors, line: { color: '#0e1013', width: 2 } } };
    const traceMonth = { ...common, values: monthVals, text: monthLabels, hovertext: monthHover, hoverinfo: 'text', textfont: { size: 10, color: VIZ.ink2 }, domain: domainFor(R.phaseIn), hole: R.monthIn / R.phaseIn, marker: { colors: monthVals.map((_, i) => MONTH_COLORS[i % 2]), line: { color: '#0e1013', width: 1 } } };
    const traceYear = { ...common, values: yearVals, text: yearLabels, hovertext: yearLabels, hoverinfo: 'text', textfont: { size: 12, color: VIZ.ink }, domain: domainFor(R.monthIn), hole: R.yearIn / R.monthIn, marker: { colors: yearVals.map((_, i) => YEAR_COLORS[i % 2]), line: { color: '#0e1013', width: 1.5 } } };

    const fallowDays = blocks.filter(b => b.type === 'fallow').reduce((s, b) => s + blockDuration(b), 0);
    const croppedPct = Math.round(100 * (totalDays - fallowDays) / totalDays);

    plot(div, [tracePhase, traceMonth, traceYear], {
      margin: { l: 8, r: 8, t: 8, b: 8 },
      showlegend: false,
      annotations: [
        { text: `${croppedPct}%`, showarrow: false, font: { size: 22, color: VIZ.kcb }, x: 0.5, y: 0.53 },
        { text: 'cropped', showarrow: false, font: { size: 10, color: VIZ.muted }, x: 0.5, y: 0.44 },
      ],
    }, 'rotation-wheel');
  }

  return { el: card, render };
}
