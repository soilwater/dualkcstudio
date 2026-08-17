/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * seasonCharts.js — the standard chart set for one engine run (a season or
 * any single stitched window). Used by Single Season and reusable by any
 * mode that has daily engine rows. All charts share a linked date x-axis.
 */

import { el } from './dom.js';
import { chartCard, plot, linkZoom, VIZ, rgba } from './plotly.js';

export function createSeasonCharts() {
  const cards = {
    coeff: chartCard('Crop coefficients', { subtitle: 'Kcb · Kcb+Ke · Kc max · Ks' }),
    flux: chartCard('Evapotranspiration', { subtitle: 'transpiration + evaporation vs. reference' }),
    input: chartCard('Water input', { subtitle: 'precipitation and irrigation' }),
    cumul: chartCard('Cumulative water', { subtitle: 'season running totals' }),
    root: chartCard('Root-zone depletion', { subtitle: 'down = drier · RAW/TAW thresholds' }),
    profile: chartCard('Profile storage', { subtitle: 'plant-available water by layer' }),
    surface: chartCard('Surface evaporation layer', { subtitle: 'depletion De vs. REW/TEW' }),
  };

  const root = el('div', { class: 'chart-grid' }, Object.values(cards).map(c => c.card));
  let linked = false;

  function render(rows) {
    const x = rows.map(r => r.date);
    const line = (key, name, color, extra = {}) => ({
      type: 'scatter', mode: 'lines', x, y: rows.map(r => r[key]),
      name, line: { color, width: 2 }, hovertemplate: '%{y:.2f}<extra>' + name + '</extra>', ...extra,
    });

    /* Line-style convention: only a genuine horizontal/vertical reference
       or capacity line (Kc max, TAW, TEW) is dashed. Every actual value —
       including thresholds that vary day to day, like RAW/REW — is solid. */
    plot(cards.coeff.div, [
      line('Kc_max', 'Kc max', VIZ.baseline, { line: { color: VIZ.baseline, width: 1.5, dash: 'dash' } }),
      line('Kcb', 'Kcb', VIZ.kcb),
      { ...line('Ke', 'Kcb + Ke', VIZ.kc), y: rows.map(r => r.Kcb + r.Ke) },
      line('Ks', 'Ks (stress)', VIZ.stress),
    ], { yaxis: { title: { text: 'coefficient' }, rangemode: 'tozero' } }, 'crop-coefficients');

    plot(cards.flux.div, [
      {
        type: 'scatter', mode: 'lines', x, y: rows.map(r => r.T), name: 'Transpiration',
        stackgroup: 'et', line: { color: VIZ.t, width: 1 }, fillcolor: rgba(VIZ.t, 0.55),
        hovertemplate: '%{y:.2f} mm<extra>T</extra>',
      },
      {
        type: 'scatter', mode: 'lines', x, y: rows.map(r => r.E), name: 'Evaporation',
        stackgroup: 'et', line: { color: VIZ.e, width: 1 }, fillcolor: rgba(VIZ.e, 0.55),
        hovertemplate: '%{y:.2f} mm<extra>E</extra>',
      },
      line('ETo', 'ETo', VIZ.eto, { line: { color: VIZ.eto, width: 1.5 } }),
    ], { yaxis: { title: { text: 'mm/day' }, rangemode: 'tozero' } }, 'et-components');

    plot(cards.input.div, [
      {
        type: 'bar', x, y: rows.map(r => r.prcp), name: 'Precipitation',
        marker: { color: VIZ.precip }, hovertemplate: '%{y:.1f} mm<extra>precip</extra>',
      },
      {
        type: 'bar', x, y: rows.map(r => r.irrig_applied), name: 'Irrigation',
        marker: { color: VIZ.irrig }, hovertemplate: '%{y:.1f} mm<extra>irrigation</extra>',
      },
    ], { barmode: 'stack', yaxis: { title: { text: 'mm/day' }, rangemode: 'tozero' } }, 'water-input');

    const cum = (key, sel) => {
      let s = 0;
      return rows.map(r => { s += sel ? sel(r) : r[key]; return s; });
    };
    plot(cards.cumul.div, [
      { type: 'scatter', mode: 'lines', x, y: cum('prcp'), name: 'Σ Precip', line: { color: VIZ.precip, width: 2 }, hovertemplate: '%{y:.0f} mm<extra>Σ precip</extra>' },
      { type: 'scatter', mode: 'lines', x, y: cum('irrig_applied'), name: 'Σ Irrigation', line: { color: VIZ.irrig, width: 2 }, hovertemplate: '%{y:.0f} mm<extra>Σ irrigation</extra>' },
      { type: 'scatter', mode: 'lines', x, y: cum('ETo'), name: 'Σ ETo', line: { color: VIZ.eto, width: 1.5 }, hovertemplate: '%{y:.0f} mm<extra>Σ ETo</extra>' },
      { type: 'scatter', mode: 'lines', x, y: cum('ETc'), name: 'Σ ETc', line: { color: VIZ.etc, width: 2 }, hovertemplate: '%{y:.0f} mm<extra>Σ ETc</extra>' },
      { type: 'scatter', mode: 'lines', x, y: cum('T'), name: 'Σ T', line: { color: VIZ.t, width: 2 }, hovertemplate: '%{y:.0f} mm<extra>Σ T</extra>' },
    ], { yaxis: { title: { text: 'mm' }, rangemode: 'tozero' } }, 'cumulative-water');

    plot(cards.root.div, [
      line('TAW', 'TAW', VIZ.ink2, { line: { color: VIZ.ink2, width: 1.5, dash: 'dash' } }),
      line('RAW', 'RAW', VIZ.muted, { line: { color: VIZ.muted, width: 1.5 } }),
      {
        type: 'scatter', mode: 'lines', x, y: rows.map(r => r.Dr), name: 'Depletion Dr',
        line: { color: VIZ.stress, width: 2 }, fill: 'tozeroy', fillcolor: rgba(VIZ.stress, 0.08),
        hovertemplate: '%{y:.1f} mm<extra>Dr</extra>',
      },
    ], {
      yaxis: { title: { text: 'depletion, mm' }, autorange: 'reversed' },
    }, 'root-zone-depletion');

    /* Root-zone and subsoil available water get DISTINCT hues (violet vs
       blue), not two opacities of one, so the stack reads clearly. */
    plot(cards.profile.div, [
      {
        type: 'scatter', mode: 'lines', x, y: rows.map(r => r.Sr_paw), name: 'Root zone PAW',
        stackgroup: 's', line: { color: VIZ.storage, width: 1 }, fillcolor: rgba(VIZ.storage, 0.5),
        hovertemplate: '%{y:.1f} mm<extra>root zone</extra>',
      },
      {
        type: 'scatter', mode: 'lines', x, y: rows.map(r => r.Ss_paw), name: 'Subsoil PAW',
        stackgroup: 's', line: { color: VIZ.precip, width: 1 }, fillcolor: rgba(VIZ.precip, 0.45),
        hovertemplate: '%{y:.1f} mm<extra>subsoil</extra>',
      },
    ], { yaxis: { title: { text: 'plant-available water, mm' }, rangemode: 'tozero' } }, 'profile-storage');

    plot(cards.surface.div, [
      line('TEW', 'TEW', VIZ.ink2, { line: { color: VIZ.ink2, width: 1.5, dash: 'dash' } }),
      line('REW', 'REW', VIZ.muted, { line: { color: VIZ.muted, width: 1.5 } }),
      line('De', 'Surface depletion De', VIZ.e, { line: { color: VIZ.e, width: 2 } }),
    ], { yaxis: { title: { text: 'mm' }, rangemode: 'tozero' } }, 'surface-layer');

    if (!linked && window.Plotly) {
      linkZoom(Object.values(cards).map(c => c.div));
      linked = true;
    }
  }

  return { el: root, render };
}
