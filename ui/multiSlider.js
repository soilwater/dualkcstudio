/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * multiSlider.js — a horizontal track (fixed 0 → max) carrying several
 * ordered, draggable markers, each bound to a get/set. Built for the soil
 * panel: one track per layer shows θ_wp ≤ θ_ini ≤ θ_fc at a glance and lets
 * you drag them, with the plant-available band (wp→fc) shaded. Replaces a
 * stack of numeric boxes with one compact, legible control.
 *
 * Same drag architecture as the Kcb editor: the SVG structure is built once
 * and only marker positions/labels update on drag, with pointer capture on
 * the persistent <svg> so a re-render never drops the gesture.
 */

import { el, svgEl } from './dom.js';
import { clampNum } from './format.js';

const W = 280, H = 42;
const PAD = 12;
const TRACK_Y = 27;
const PW = W - PAD * 2;

const TRACK = '#272c35';
const BAND = 'rgba(134, 221, 82, 0.16)';
const BAND_EDGE = '#3f6b2c';
const HANDLE = '#86dd52';
const MUTED = '#7f8794';
const INK = '#f5f6f8';

/**
 * @param {object} cfg
 * @param {number} cfg.min  track minimum (fixed)
 * @param {number} cfg.max  track maximum (fixed)
 * @param {object[]} cfg.markers ordered left→right; each { id, get, set, band? }
 *        `band: true` on two markers shades the region between them.
 * @param {number} [cfg.decimals=2]
 * @param {function} [cfg.onChange] (id, {live}) after a marker moves
 */
export function createMultiSlider({ min = 0, max = 0.6, markers, decimals = 2, onChange } = {}) {
  const xOf = (v) => PAD + ((v - min) / (max - min)) * PW;
  const xInv = (px) => clampNum(min + ((px - PAD) / PW) * (max - min), min, max);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, style: 'touch-action:none; user-select:none;' });
  const root = el('div', { class: 'widget' }, svg);

  function toLocal(ev) {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const m = svg.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : pt;
  }

  /* static chrome */
  svg.append(svgEl('line', { x1: PAD, x2: W - PAD, y1: TRACK_Y, y2: TRACK_Y, stroke: TRACK, 'stroke-width': 4, 'stroke-linecap': 'round' }));
  const bandRect = svgEl('rect', { y: TRACK_Y - 2, height: 4, fill: BAND, rx: 2 });
  svg.append(bandRect);
  const bandLine = svgEl('line', { y1: TRACK_Y, y2: TRACK_Y, stroke: BAND_EDGE, 'stroke-width': 4, 'stroke-linecap': 'round' });
  svg.append(bandLine);
  /* min/max scale labels */
  svg.append(svgEl('text', { x: PAD, y: H - 2, fill: MUTED, 'font-size': 8, 'text-anchor': 'start' }, min.toFixed(1)));
  svg.append(svgEl('text', { x: W - PAD, y: H - 2, fill: MUTED, 'font-size': 8, 'text-anchor': 'end' }, max.toFixed(1)));

  const handleEls = markers.map((mk) => {
    const g = svgEl('g', { style: 'cursor:ew-resize;' });
    const hit = svgEl('rect', { x: -9, y: TRACK_Y - 12, width: 18, height: 24, fill: 'transparent' });
    const tick = svgEl('line', { y1: TRACK_Y - 6, y2: TRACK_Y + 6, stroke: HANDLE, 'stroke-width': 2 });
    const dot = svgEl('circle', { cy: TRACK_Y, r: 4.5, fill: '#16191e', stroke: HANDLE, 'stroke-width': 2 });
    const val = svgEl('text', { y: TRACK_Y - 10, fill: INK, 'font-size': 8.5, 'text-anchor': 'middle', 'font-family': 'IBM Plex Mono, monospace' });
    g.append(hit, tick, dot, val);
    svg.append(g);
    attachDrag(g, mk);
    return { g, tick, dot, val };
  });

  function neighborBounds(i) {
    const lo = i > 0 ? markers[i - 1].get() : (typeof markers[i].loFn === 'function' ? markers[i].loFn() : min);
    const hi = i < markers.length - 1 ? markers[i + 1].get() : (typeof markers[i].hiFn === 'function' ? markers[i].hiFn() : max);
    return { lo, hi };
  }

  function attachDrag(g, mk) {
    g.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      svg.setPointerCapture(ev.pointerId);
      const i = markers.indexOf(mk);
      const move = (e) => {
        if (e.pointerId !== ev.pointerId) return;
        const { lo, hi } = neighborBounds(i);
        const v = clampNum(xInv(toLocal(e).x), lo, hi);
        mk.set(+v.toFixed(decimals));
        refresh();
        onChange && onChange(mk.id, { live: true });
      };
      const up = (e) => {
        if (e.pointerId !== ev.pointerId) return;
        svg.removeEventListener('pointermove', move);
        svg.removeEventListener('pointerup', up);
        svg.removeEventListener('pointercancel', up);
        onChange && onChange(mk.id, { live: false });
      };
      svg.addEventListener('pointermove', move);
      svg.addEventListener('pointerup', up);
      svg.addEventListener('pointercancel', up);
    });
  }

  function refresh() {
    const bandIdx = markers.map((m, i) => (m.band ? i : -1)).filter(i => i >= 0);
    if (bandIdx.length === 2) {
      const a = xOf(markers[bandIdx[0]].get()), b = xOf(markers[bandIdx[1]].get());
      bandRect.setAttribute('x', Math.min(a, b));
      bandRect.setAttribute('width', Math.max(Math.abs(b - a), 0));
      bandLine.setAttribute('x1', a); bandLine.setAttribute('x2', b);
      bandLine.style.display = '';
      bandRect.style.display = '';
    } else {
      bandLine.style.display = 'none';
      bandRect.style.display = 'none';
    }
    markers.forEach((mk, i) => {
      const x = xOf(mk.get());
      const h = handleEls[i];
      h.tick.setAttribute('x1', x); h.tick.setAttribute('x2', x);
      h.dot.setAttribute('cx', x);
      h.g.querySelector('rect').setAttribute('x', x - 9);
      h.val.setAttribute('x', clampNum(x, PAD + 10, W - PAD - 10));
      h.val.textContent = mk.get().toFixed(decimals);
    });
  }

  refresh();
  return { el: root, refresh };
}
