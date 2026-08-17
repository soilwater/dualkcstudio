/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * inputCharts.js — the Inputs-tab visualization of a loaded weather record:
 * the actual daily variables in the file (precipitation, reference ET,
 * temperature, solar radiation, wind, humidity), each a full daily series
 * with linked zoom. No derived climatology — just what's in the file. ETo
 * also appears in the Outputs tab, by design.
 */

import { el } from './dom.js';
import { chartCard, plot, VIZ, rgba, linkZoom } from './plotly.js';

export function createInputCharts() {
  const cards = {
    precip: chartCard('Precipitation', { subtitle: 'daily, mm', height: 230 }),
    eto: chartCard('Reference ET (ETo)', { subtitle: 'daily, mm', height: 230 }),
    temp: chartCard('Air temperature', { subtitle: 'daily min / max, °C', height: 230 }),
    srad: chartCard('Solar radiation', { subtitle: 'daily, MJ/m²', height: 230 }),
    wspd: chartCard('Wind speed', { subtitle: 'daily, m/s at 2 m', height: 230 }),
    rh: chartCard('Relative humidity', { subtitle: 'daily min / max, %', height: 230 }),
  };
  const root = el('div', { class: 'chart-grid' }, Object.values(cards).map(c => c.card));

  function render(rows) {
    if (!rows || !rows.length || !window.Plotly) return;
    const x = rows.map(r => r.date);
    const has = (k) => rows.some(r => isFinite(r[k]));
    const line = (key, color, name) => ({ type: 'scatter', mode: 'lines', x, y: rows.map(r => r[key]), name, line: { color, width: 1.3 }, hovertemplate: `%{x}: %{y:.1f}<extra>${name}</extra>` });
    const base = { margin: { l: 44, r: 12, t: 6, b: 26 }, xaxis: { type: 'date' } };

    plot(cards.precip.div, [{ type: 'bar', x, y: rows.map(r => r.prcp), marker: { color: VIZ.precip }, hovertemplate: '%{x}: %{y:.1f} mm<extra>precip</extra>' }],
      { ...base, showlegend: false, yaxis: { title: { text: 'mm' }, rangemode: 'tozero' } }, 'in-precip');

    plot(cards.eto.div, [line('ETo', VIZ.eto, 'ETo')],
      { ...base, showlegend: false, yaxis: { title: { text: 'mm' }, rangemode: 'tozero' } }, 'in-eto');

    plot(cards.temp.div, [
      line('tmax', VIZ.etc, 'Tmax'),
      { ...line('tmin', VIZ.precip, 'Tmin'), fill: 'tonexty', fillcolor: rgba(VIZ.precip, 0.08) },
    ], { ...base, yaxis: { title: { text: '°C' } } }, 'in-temp');

    cards.srad.card.hidden = !has('srad');
    if (has('srad')) plot(cards.srad.div, [line('srad', VIZ.series[3], 'Solar')],
      { ...base, showlegend: false, yaxis: { title: { text: 'MJ/m²' }, rangemode: 'tozero' } }, 'in-srad');

    cards.wspd.card.hidden = !has('wspd');
    if (has('wspd')) plot(cards.wspd.div, [line('wspd', VIZ.storage, 'Wind')],
      { ...base, showlegend: false, yaxis: { title: { text: 'm/s' }, rangemode: 'tozero' } }, 'in-wspd');

    cards.rh.card.hidden = !(has('rmin') || has('rmax'));
    if (has('rmin') || has('rmax')) plot(cards.rh.div, [
      line('rmax', VIZ.irrig, 'RHmax'),
      { ...line('rmin', VIZ.series[4], 'RHmin') },
    ], { ...base, yaxis: { title: { text: '%' }, rangemode: 'tozero' } }, 'in-rh');

    /* Re-link each render: a later file may add charts (wind, humidity…) that
       the first file lacked. linkZoom replaces handlers, so this never stacks. */
    linkZoom(Object.values(cards).map(c => c.div));
  }

  return { el: root, render };
}
