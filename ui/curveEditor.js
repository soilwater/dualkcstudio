/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * curveEditor.js — interactive SVG editor for the FAO-56 four-stage Kcb
 * curve. The curve IS the input: dragging a handle rewrites stage lengths
 * and Kcb values (with clamping), and number fields elsewhere stay in sync
 * through set()/onChange.
 *
 * The SVG structure (axes group, path, each handle's <g>) is built ONCE.
 * redraw() only clears+rebuilds the small grid/band groups and updates
 * attributes on the same handle elements, so nothing holding a pointer-drag
 * listener is ever removed mid-gesture. The x-domain is a smooth function of
 * the stage lengths, so the axis never snaps on release.
 *
 *   handle A — end of initial stage:      x → L_ini,  y → Kcb_ini
 *   handle B — start of mid-season:       x → L_dev,  y → Kcb_mid
 *   handle C — end of mid-season:         x → L_mid,  y → Kcb_mid
 *   handle D — end of season:             x → L_late, y → Kcb_end
 */

import { svgEl, clear } from './dom.js';
import { clampNum } from './format.js';

/* A small viewBox so that, scaled to the ~300px sidebar width, the type
   renders large and legible. Ticks are deliberately coarse — the exact
   value sits on each handle, so the axes only need rough orientation. */
const W = 360, H = 224;
const M = { l: 30, r: 10, t: 20, b: 34 };
const PW = W - M.l - M.r;
const PH = H - M.t - M.b;

/* Dark theme (see styles/tokens.css). */
const CURVE = '#86dd52';                        /* --neon */
const CURVE_FILL = 'rgba(134, 221, 82, 0.11)';
const GRID = '#2a2f39';                          /* --border */
const BASE = '#363c47';                          /* --border-2 */
const MUTED = '#7f8794';                         /* --muted */
const BAND = 'rgba(255, 255, 255, 0.022)';

const MIN_STAGE = 1;    /* days */
const MIN_KCB = 0;
/* The x-axis ends ~45 days past the last stage, no fixed floor — so a short
   season doesn't sit in a huge empty plot and the two mid-stage markers
   don't crowd. A tiny minimum keeps very short crops sane. */
const X_PAD = 45;
const X_MIN = 90;

function niceStep(range) {
  const raw = range / 4;   /* coarse: ~4 ticks across */
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  for (const m of [1, 2, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}

export function createKcbEditor({ values, onChange, yMax = 1.4, refLines = [] } = {}) {
  let v = { ...values };
  let refs = refLines;
  let curXMax = computeXMax();

  function total() { return v.L_ini + v.L_dev + v.L_mid + v.L_late; }
  function computeXMax() {
    const refMax = refs.reduce((m, r) => isFinite(r.day) ? Math.max(m, r.day) : m, 0);
    return Math.max(X_MIN, total() + X_PAD, refMax + 30);
  }

  const xOf = (d) => M.l + (d / curXMax) * PW;
  const yOf = (k) => M.t + (1 - k / yMax) * PH;
  const xInv = (px) => clampNum((px - M.l) / PW * curXMax, 0, curXMax);
  const yInv = (py) => clampNum((1 - (py - M.t) / PH) * yMax, 0, yMax);

  function toLocal(ev) {
    const pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const m = svg.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : pt;
  }

  function breakpoints() {
    const x1 = v.L_ini, x2 = v.L_ini + v.L_dev, x3 = x2 + v.L_mid, x4 = x3 + v.L_late;
    return { x1, x2, x3, x4 };
  }

  /* ── Static structure, built once ──────────────────────────────────── */

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': 'Editable basal crop coefficient curve; drag the handles to change stage lengths and Kcb values.',
    style: 'touch-action:none; user-select:none;',
  });
  const gBand = svgEl('g');
  const gGrid = svgEl('g');
  const gFill = svgEl('path', { fill: CURVE_FILL, stroke: 'none' });
  const gLine = svgEl('path', { fill: 'none', stroke: CURVE, 'stroke-width': 2, 'stroke-linejoin': 'round' });
  const gRefs = svgEl('g');
  const gHandles = svgEl('g');
  svg.append(gBand, gGrid, gFill, gLine, gRefs, gHandles);

  const root = document.createElement('div');
  root.className = 'widget';
  root.append(svg);
  const caption = document.createElement('div');
  caption.className = 'widget__caption';
  caption.textContent = 'Drag handles: vertical sets Kcb, horizontal sets stage length.';
  root.append(caption);
  const legend = document.createElement('div');
  legend.className = 'widget__legend';
  legend.hidden = true;
  root.append(legend);

  /* ── Redraws: grid/bands rebuild (cheap, axis genuinely may change);
     handles only move via reposition() — never destroyed ─────────────── */

  function drawBands() {
    clear(gBand);
    const { x1, x2, x3, x4 } = breakpoints();
    const stages = [
      { from: 0, to: x1, name: 'ini' },
      { from: x1, to: x2, name: 'dev' },
      { from: x2, to: x3, name: 'mid' },
      { from: x3, to: x4, name: 'late' },
    ];
    stages.forEach((s, i) => {
      if (i % 2 === 0) {
        gBand.append(svgEl('rect', {
          x: xOf(s.from), y: M.t,
          width: Math.max(xOf(s.to) - xOf(s.from), 0), height: PH,
          fill: BAND,
        }));
      }
      const cx = (xOf(s.from) + xOf(s.to)) / 2;
      if (xOf(s.to) - xOf(s.from) > 28) {
        gBand.append(svgEl('text', {
          x: cx, y: M.t - 6, fill: MUTED, 'font-size': 13,
          'text-anchor': 'middle', 'font-family': 'inherit',
        }, s.name));
      }
    });
  }

  function drawGrid() {
    clear(gGrid);
    for (let k = 0; k <= yMax + 1e-9; k += 0.4) {   /* coarse y ticks */
      const y = yOf(k);
      gGrid.append(svgEl('line', { x1: M.l, x2: M.l + PW, y1: y, y2: y, stroke: GRID, 'stroke-width': 1 }));
      gGrid.append(svgEl('text', {
        x: M.l - 5, y: y + 5, fill: MUTED, 'font-size': 14, 'text-anchor': 'end',
      }, k.toFixed(1)));
    }
    const step = niceStep(curXMax);
    for (let d = 0; d <= curXMax + 1e-9; d += step) {
      const x = xOf(d);
      gGrid.append(svgEl('line', { x1: x, x2: x, y1: M.t + PH, y2: M.t + PH + 4, stroke: BASE, 'stroke-width': 1 }));
      gGrid.append(svgEl('text', {
        x, y: M.t + PH + 19, fill: MUTED, 'font-size': 14, 'text-anchor': 'middle',
      }, String(Math.round(d))));
    }
    gGrid.append(svgEl('line', { x1: M.l, x2: M.l + PW, y1: M.t + PH, y2: M.t + PH, stroke: BASE, 'stroke-width': 1.25 }));
    gGrid.append(svgEl('line', { x1: M.l, x2: M.l, y1: M.t, y2: M.t + PH, stroke: BASE, 'stroke-width': 1.25 }));
  }

  function setPath() {
    const { x1, x2, x3, x4 } = breakpoints();
    const pts = [
      [0, v.Kcb_ini], [x1, v.Kcb_ini], [x2, v.Kcb_mid], [x3, v.Kcb_mid], [x4, v.Kcb_end],
    ];
    const path = pts.map(([d, k], i) => `${i ? 'L' : 'M'}${xOf(d).toFixed(1)},${yOf(k).toFixed(1)}`).join(' ');
    gLine.setAttribute('d', path);
    gFill.setAttribute('d', `${path} L${xOf(x4).toFixed(1)},${yOf(0)} L${xOf(0)},${yOf(0)} Z`);
  }

  /**
   * A persistent handle: hit-circle + visible dot + an always-on value
   * label above it (day · Kcb, like the reference tool), all built once.
   * reposition() only ever updates attributes on these same elements.
   */
  function addHandle(getPos, applyDrag, labelFn) {
    const g = svgEl('g', { style: 'cursor:grab;' });
    const labelBg = svgEl('rect', { rx: 3, ry: 3, fill: 'rgba(8,10,13,0.9)' });
    const labelText = svgEl('text', {
      'font-size': 13, fill: '#f5f6f8', 'text-anchor': 'middle', 'font-family': 'IBM Plex Mono, monospace',
    });
    const hit = svgEl('circle', { r: 16, fill: 'transparent' });
    const dot = svgEl('circle', { r: 6, fill: '#16191e', stroke: CURVE, 'stroke-width': 2.5 });
    g.append(labelBg, labelText, hit, dot);
    gHandles.append(g);

    function reposition() {
      const p = getPos();
      const cx = xOf(p.x), cy = yOf(p.y);
      hit.setAttribute('cx', cx); hit.setAttribute('cy', cy);
      dot.setAttribute('cx', cx); dot.setAttribute('cy', cy);
      labelText.textContent = labelFn(p);
      const ty = Math.max(11, cy - 13);
      labelText.setAttribute('x', cx); labelText.setAttribute('y', ty);
      let bx = cx - 30, by = ty - 11, bw = 60, bh = 15;
      try {
        const bb = labelText.getBBox();
        bx = bb.x - 5; by = bb.y - 2; bw = bb.width + 10; bh = bb.height + 4;
      } catch { /* getBBox needs layout; falls back to the estimate above */ }
      labelBg.setAttribute('x', bx); labelBg.setAttribute('y', by);
      labelBg.setAttribute('width', bw); labelBg.setAttribute('height', bh);
    }

    attachDrag(g, applyDrag);
    return { reposition };
  }

  function attachDrag(g, applyDrag) {
    g.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      /* Capture (and listen) on `svg`, which redraw() never removes — only
         gGrid/gBand's children get cleared, and handles are repositioned in
         place, so nothing here is ever destroyed mid-gesture. */
      svg.setPointerCapture(ev.pointerId);
      svg.style.cursor = 'grabbing';

      const move = (e) => {
        if (e.pointerId !== ev.pointerId) return;
        const loc = toLocal(e);
        applyDrag(xInv(loc.x), yInv(loc.y));
        redraw();
        onChange && onChange({ ...v }, { live: true });
      };
      const up = (e) => {
        if (e.pointerId !== ev.pointerId) return;
        svg.removeEventListener('pointermove', move);
        svg.removeEventListener('pointerup', up);
        svg.removeEventListener('pointercancel', up);
        svg.style.cursor = '';
        onChange && onChange({ ...v }, { live: false });
      };
      svg.addEventListener('pointermove', move);
      svg.addEventListener('pointerup', up);
      svg.addEventListener('pointercancel', up);
    });
  }

  const hA = addHandle(
    () => ({ x: v.L_ini, y: v.Kcb_ini }),
    (day, kcb) => { v.L_ini = Math.max(Math.round(day), MIN_STAGE); v.Kcb_ini = round2(kcb); },
    (p) => `d${Math.round(p.x)} ${p.y.toFixed(2)}`);
  const hB = addHandle(
    () => ({ x: v.L_ini + v.L_dev, y: v.Kcb_mid }),
    (day, kcb) => { v.L_dev = Math.max(Math.round(day) - v.L_ini, MIN_STAGE); v.Kcb_mid = round2(kcb); },
    (p) => `d${Math.round(p.x)} ${p.y.toFixed(2)}`);
  const hC = addHandle(
    () => ({ x: v.L_ini + v.L_dev + v.L_mid, y: v.Kcb_mid }),
    (day, kcb) => { const x2 = v.L_ini + v.L_dev; v.L_mid = Math.max(Math.round(day) - x2, MIN_STAGE); v.Kcb_mid = round2(kcb); },
    (p) => `d${Math.round(p.x)} ${p.y.toFixed(2)}`);
  const hD = addHandle(
    () => ({ x: v.L_ini + v.L_dev + v.L_mid + v.L_late, y: v.Kcb_end }),
    (day, kcb) => { const x3 = v.L_ini + v.L_dev + v.L_mid; v.L_late = Math.max(Math.round(day) - x3, MIN_STAGE); v.Kcb_end = round2(kcb); },
    (p) => `d${Math.round(p.x)} ${p.y.toFixed(2)}`);

  function round2(x) { return clampNum(Math.round(x * 100) / 100, MIN_KCB, yMax); }

  /**
   * Vertical marker lines (e.g. termination / cash-planting dates) drawn on
   * top of the curve, plus — when any marker falls past the end of the drawn
   * curve — a faint "hold" plateau at Kcb_end from the curve's end out to the
   * last such marker. That plateau is the honest continuation of kcbFlat,
   * which clamps at Kcb_end past the final stage: the crop stays at its end
   * coefficient until it is terminated (it is NOT bare between the curve's
   * end and the marker). A small color-keyed legend names each marker.
   *
   * Each ref line: { day, color, label, kind?: 'hold'|'plain', dash? }.
   * kind 'hold' markers (default) drive the plateau; a 'plain' marker (e.g.
   * cash planting, which sits in the fallow gap) does not extend it.
   */
  function drawRefs() {
    clear(gRefs);

    const holdDays = refs.filter(r => isFinite(r.day) && (r.kind ?? 'hold') === 'hold').map(r => r.day);
    const seasonEnd = total();
    if (holdDays.length) {
      const lastHold = Math.max(...holdDays);
      if (lastHold > seasonEnd + 0.5) {
        const y = yOf(v.Kcb_end);
        gRefs.append(svgEl('line', {
          x1: xOf(seasonEnd), x2: xOf(clampNum(lastHold, 0, curXMax)), y1: y, y2: y,
          stroke: CURVE, 'stroke-width': 1.5, 'stroke-dasharray': '2 3', opacity: '0.55',
        }));
      }
    }

    for (const r of refs) {
      if (!isFinite(r.day)) continue;
      const x = xOf(clampNum(r.day, 0, curXMax));
      gRefs.append(svgEl('line', {
        x1: x, x2: x, y1: M.t, y2: M.t + PH,
        stroke: r.color || MUTED, 'stroke-width': 1.5, 'stroke-dasharray': r.dash || '4 3',
      }));
    }

    legend.innerHTML = '';
    const withLabels = refs.filter(r => r.label);
    legend.hidden = withLabels.length === 0;
    for (const r of withLabels) {
      const item = document.createElement('span');
      item.className = 'widget__legend-item';
      const sw = document.createElement('span');
      sw.className = 'widget__legend-swatch';
      sw.style.background = r.color || MUTED;
      item.append(sw, document.createTextNode(r.label));
      legend.append(item);
    }
  }

  function redraw() {
    curXMax = computeXMax();
    drawBands();
    drawGrid();
    setPath();
    drawRefs();
    hA.reposition(); hB.reposition(); hC.reposition(); hD.reposition();
  }

  redraw();

  return {
    el: root,
    get: () => ({ ...v }),
    set(values) {
      v = { ...v, ...values };
      redraw();
    },
    setRefLines(lines) {
      refs = lines || [];
      redraw();
    },
  };
}
