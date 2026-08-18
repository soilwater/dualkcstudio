/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/field-scale/results.js — the map view of a gridded run.
 *
 * A Leaflet map with a satellite basemap and the result grid drawn over it as
 * a semi-transparent image overlay, so every variable sits in its real
 * landscape. A variable selector spans three groups — vegetation (Kcb), the
 * daily water balance (Dr, ETc, Ks), and static soil limits (FC, WP, available
 * water) — plus season totals. Daily variables animate with the day slider;
 * an opacity slider fades the overlay against the imagery. Click any pixel for
 * its daily depletion and ETc.
 *
 * Two rules that make the colours mean something:
 *   - Each variable's colour scale is anchored to its whole-season min/max
 *     (not the current day), so a colour means the same thing on every day.
 *   - Invalid pixels (masked soil, never-clear) are transparent holes.
 */

import { el } from '../../ui/dom.js';
import { selectInput, btn } from '../../ui/components.js';
import { VIZ, linkZoom } from '../../ui/plotly.js';
import { downloadBlob } from '../../ui/download.js';
import { buildGeoTiff } from './geotiff_writer.js';
import { baseLayers } from './basemaps.js';

/* Small set of vanilla colour maps (control colours; interpolated per pixel).
   No Plotly/library dependency so they work on a plain <canvas>. */
const CMAPS = {
  greens: [[247, 252, 245], [199, 233, 192], [116, 196, 118], [35, 139, 69], [0, 68, 27]],
  YlGnBu: [[255, 255, 217], [199, 233, 180], [65, 182, 196], [34, 94, 168], [8, 29, 88]],
  YlOrRd: [[255, 255, 178], [254, 204, 92], [253, 141, 60], [240, 59, 32], [189, 0, 38]],
  RdYlGn: [[215, 48, 39], [252, 141, 89], [254, 224, 139], [145, 207, 96], [26, 152, 80]],
  Blues: [[247, 251, 255], [198, 219, 239], [107, 174, 214], [33, 113, 181], [8, 48, 107]],
  /* Divergent brown→teal for volumetric water content (dry → wet). */
  BrBG: [[140, 81, 10], [191, 129, 45], [223, 194, 125], [246, 232, 195], [199, 234, 229], [128, 205, 193], [53, 151, 143], [1, 102, 94]],
};

function lerp(cmap, t) {
  t = Math.min(1, Math.max(0, t));
  const x = t * (cmap.length - 1);
  const i = Math.floor(x), f = x - i;
  const a = cmap[i], b = cmap[Math.min(i + 1, cmap.length - 1)];
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
}

/* Variable catalogue. kind picks the data source; cmap the colours; fixed pins
   the scale (Ks is always 0–1). */
const VARS = {
  Kcb: { label: 'Kcb (vegetation)', unit: '–', kind: 'daily', cmap: 'greens' },
  Sr_paw: { label: 'Available water', unit: 'mm', kind: 'daily', cmap: 'YlGnBu' },
  Dr: { label: 'Root-zone depletion', unit: 'mm', kind: 'daily', cmap: 'YlOrRd' },
  ETo: { label: 'Reference ET (ETo)', unit: 'mm/day', kind: 'daily', cmap: 'YlOrRd' },
  ETc: { label: 'Crop ET (ETc)', unit: 'mm/day', kind: 'daily', cmap: 'YlGnBu' },
  Precip: { label: 'Precipitation', unit: 'mm', kind: 'daily', cmap: 'YlGnBu' },
  Ks: { label: 'Water-stress coeff. Ks', unit: '–', kind: 'daily', cmap: 'RdYlGn', fixed: [0, 1] },
  /* Volumetric water contents share one divergent scale anchored 0–0.45
     (just past the wettest soils), so FC and WP read on a common ruler. */
  FC: { label: 'Field capacity', unit: 'm³/m³', kind: 'soil', cmap: 'BrBG', fixed: [0, 0.45] },
  WP: { label: 'Wilting point', unit: 'm³/m³', kind: 'soil', cmap: 'BrBG', fixed: [0, 0.45] },
  AWC: { label: 'Available water capacity', unit: 'm³/m³', kind: 'soil', cmap: 'Blues' },
  ETc_sum: { label: 'Season ETc total', unit: 'mm', kind: 'summary', cmap: 'YlGnBu' },
  T_sum: { label: 'Season transpiration', unit: 'mm', kind: 'summary', cmap: 'YlGnBu' },
  E_sum: { label: 'Season evaporation', unit: 'mm', kind: 'summary', cmap: 'YlOrRd' },
  deepPerc_sum: { label: 'Season deep percolation', unit: 'mm', kind: 'summary', cmap: 'YlGnBu' },
  stressDays: { label: 'Water-stress days', unit: 'd', kind: 'summary', cmap: 'YlOrRd' },
  finalPaw: { label: 'Final available water', unit: 'mm', kind: 'summary', cmap: 'YlGnBu' },
};

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return; styleInjected = true;
  const s = document.createElement('style');
  s.textContent = `.gridoverlay{image-rendering:pixelated;image-rendering:crisp-edges;}
.spatial-legend{background:rgba(20,23,28,.82);border:1px solid var(--border,#2a2f3a);border-radius:8px;padding:8px 10px;color:var(--ink-2,#c3c8d2);font:11px Inter,sans-serif;line-height:1.35;}
.spatial-legend .lg-bar{width:14px;height:120px;border-radius:3px;border:1px solid rgba(255,255,255,.12);}
.spatial-legend .lg-wrap{display:flex;gap:7px;align-items:stretch;}
.spatial-legend .lg-ticks{display:flex;flex-direction:column;justify-content:space-between;}`;
  document.head.appendChild(s);
}

export function createResults() {
  injectStyle();
  let R = null, curVar = 'Kcb', curDay = 0, opacity = 0.8, selPixel = null;
  const ranges = {};            /* var → [lo, hi], season-anchored, cached */
  let awc = null;               /* computed available-water grid, cached */

  let map = null, overlay = null, marker = null, legend = null, legendEl = null, fieldBoundary = null;
  let fitted = false;           /* has the map been fit to bounds at real size? */
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const varSel = selectInput({
    options: Object.entries(VARS).map(([v, m]) => ({ value: v, label: m.label })),
    value: 'Kcb',
    onChange: (v) => { curVar = v; daySlider.disabled = VARS[v].kind !== 'daily'; refresh(); },
  });
  const daySlider = el('input', { type: 'range', min: '0', max: '0', value: '0', class: 'dayslider', style: { flex: '1' },
    oninput: (e) => { curDay = +e.target.value; dayLabel.textContent = dayText(); drawOverlay(); } });
  const dayLabel = el('span', { class: 'hint', style: { fontVariantNumeric: 'tabular-nums', minWidth: '11rem' } }, '—');
  const opSlider = el('input', { type: 'range', min: '20', max: '100', value: '80', style: { width: '7rem' },
    oninput: (e) => { opacity = +e.target.value / 100; if (overlay) overlay.setOpacity(opacity); } });
  const tiffBtn = btn('⤓ GeoTIFF', { small: true, onClick: exportGeoTiff });

  const mapEl = el('div', { style: { height: '460px', width: '100%', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--panel-2)', position: 'relative', zIndex: '0', isolation: 'isolate' } });
  const pixHead = el('div', { class: 'chart-card__title' }, 'Click a pixel');
  /* Three stacked pixel time-series, in agronomic order: demand (ETo/ETc),
     water (Dr/precip), then crop coefficients (Kcb, Kcb+Ke). */
  const pixEt = el('div', { class: 'chart-card__plot', style: { height: '190px' } });
  const pixDr = el('div', { class: 'chart-card__plot', style: { height: '190px' } });
  const pixKc = el('div', { class: 'chart-card__plot', style: { height: '190px' } });
  const pixDivs = [pixEt, pixDr, pixKc];

  const root = el('div', { class: 'stack' },
    el('div', { class: 'row row--wrap', style: { gap: '1.2rem', alignItems: 'center' } },
      el('label', { class: 'row', style: { gap: '0.5rem' } }, el('span', { class: 'hint' }, 'Variable'), varSel.el),
      el('label', { class: 'row', style: { gap: '0.5rem', flex: '1', minWidth: '16rem' } }, el('span', { class: 'hint' }, 'Day'), daySlider, dayLabel),
      el('label', { class: 'row', style: { gap: '0.5rem' } }, el('span', { class: 'hint' }, 'Overlay'), opSlider),
      tiffBtn,
    ),
    el('div', { class: 'card chart-card chart-card--wide' },
      el('div', { class: 'chart-card__head' }, el('div', { class: 'chart-card__title' }, 'Map'), el('div', { class: 'chart-card__sub' }, 'satellite basemap · click a pixel')),
      mapEl),
    el('div', { class: 'card chart-card chart-card--wide' },
      el('div', { class: 'chart-card__head' }, pixHead, el('div', { class: 'chart-card__sub' }, 'daily series at the clicked pixel')),
      pixEt, pixDr, pixKc),
  );

  function dayText() { return R ? `${R.dates[curDay]}  (day ${curDay + 1}/${R.T})` : '—'; }

  /* One frame's per-pixel values (a Float32Array of length nPixels). */
  function slice(varName, day) {
    const m = VARS[varName], nP = R.rows * R.cols;
    if (m.kind === 'daily') return R.daily[varName].subarray(day * nP, (day + 1) * nP);
    if (m.kind === 'summary') return R.summary[varName];
    if (varName === 'FC') return R.soil.rootzone_fc;
    if (varName === 'WP') return R.soil.rootzone_wp;
    /* AWC */
    if (!awc) { awc = new Float32Array(nP); for (let i = 0; i < nP; i++) awc[i] = R.soil.rootzone_fc[i] - R.soil.rootzone_wp[i]; }
    return awc;
  }

  /* Season-anchored [lo, hi]: for a daily variable, the min/max across the
     WHOLE run so the colour scale never shifts under the slider. */
  function rangeFor(varName) {
    if (ranges[varName]) return ranges[varName];
    const m = VARS[varName];
    if (m.fixed) return (ranges[varName] = m.fixed);
    let lo = Infinity, hi = -Infinity;
    const scan = (arr) => { for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } } };
    if (m.kind === 'daily') scan(R.daily[varName]);       /* every day at once */
    else scan(slice(varName, 0));
    if (!(hi > lo)) { hi = lo + 1; }
    return (ranges[varName] = [lo, hi]);
  }

  function bounds() { const r = R.rect; return [[r.south, r.west], [r.north, r.east]]; }
  function pixelBounds(row, col) {
    const r = R.rect, dLat = (r.north - r.south) / R.rows, dLon = (r.east - r.west) / R.cols;
    return [[r.north - (row + 1) * dLat, r.west + col * dLon], [r.north - row * dLat, r.west + (col + 1) * dLon]];
  }

  function drawOverlay() {
    if (!R || !map || !window.L) return;
    const { rows, cols } = R, m = VARS[curVar], cmap = CMAPS[m.cmap];
    const [lo, hi] = rangeFor(curVar), span = (hi - lo) || 1;
    const src = slice(curVar, curDay);
    canvas.width = cols; canvas.height = rows;
    const img = ctx.createImageData(cols, rows);
    for (let i = 0; i < rows * cols; i++) {
      const v = src[i];
      if (!Number.isFinite(v)) { img.data[i * 4 + 3] = 0; continue; }
      const [rr, gg, bb] = lerp(cmap, (v - lo) / span);
      img.data[i * 4] = rr; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = bb; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const url = canvas.toDataURL();
    if (overlay) overlay.setUrl(url);
    else overlay = window.L.imageOverlay(url, bounds(), { opacity, className: 'gridoverlay', interactive: false }).addTo(map);
    updateLegend();
  }

  function updateLegend() {
    if (!legendEl) return;
    const m = VARS[curVar], cmap = CMAPS[m.cmap], [lo, hi] = rangeFor(curVar);
    const stops = [];
    for (let k = 0; k <= 10; k++) { const [r, g, b] = lerp(cmap, k / 10); stops.push(`rgb(${r},${g},${b}) ${k * 10}%`); }
    const mid = (lo + hi) / 2;
    const fmt = (x) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(1) : x.toFixed(2));
    legendEl.innerHTML = `<div style="margin-bottom:5px;color:var(--ink,#f5f6f8)">${m.label}</div>
      <div class="lg-wrap"><div class="lg-bar" style="background:linear-gradient(to top, ${stops.join(',')})"></div>
      <div class="lg-ticks"><span>${fmt(hi)}</span><span>${fmt(mid)}</span><span>${fmt(lo)}</span></div></div>
      <div style="margin-top:4px">${m.unit}</div>`;
  }

  function refresh() {
    dayLabel.textContent = VARS[curVar].kind === 'daily' ? dayText() : 'static layer';
    drawOverlay();
    if (selPixel) markPixel();
  }

  /* The drawn field boundary (circle/polygon), for orientation over the data. */
  function drawFieldBoundary() {
    if (!map || !window.L) return;
    if (fieldBoundary) { map.removeLayer(fieldBoundary); fieldBoundary = null; }
    const fs = R && R.fieldShape; if (!fs) return;
    const opts = { color: '#86dd52', weight: 2, fill: false, interactive: false, dashArray: '4 3' };
    fieldBoundary = fs.kind === 'circle'
      ? window.L.circle(fs.center, { radius: fs.radius, ...opts })
      : window.L.polygon(fs.latlngs, opts);
    fieldBoundary.addTo(map);
  }

  function markPixel() {
    if (!map || !selPixel || !window.L) return;
    const b = pixelBounds(selPixel.r, selPixel.c);
    if (marker) marker.setBounds(b);
    else marker = window.L.rectangle(b, { color: '#86dd52', weight: 2, fill: false, interactive: false }).addTo(map);
  }

  /* A compact time-series panel: shared base layout, its own y-axis title. */
  function panel(div, traces, yTitle, extra = {}) {
    const layout = {
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      margin: { l: 48, r: 46, t: 6, b: 22 }, hovermode: 'x unified', bargap: 0.2,
      font: { family: 'Inter, sans-serif', size: 11, color: VIZ.ink2 },
      xaxis: { gridcolor: VIZ.grid, tickfont: { size: 10, color: VIZ.muted } },
      yaxis: { title: yTitle, gridcolor: VIZ.grid, rangemode: 'tozero', tickfont: { size: 10, color: VIZ.muted }, titlefont: { size: 11, color: VIZ.ink2 } },
      legend: { orientation: 'h', y: 1.12, font: { size: 10.5, color: VIZ.ink2 } }, showlegend: true,
      ...extra,
    };
    /* No `responsive` — Plotly's global resize handler throws on a hidden plot
       (e.g. after navigating away from the results tab). The tool re-fits via
       resize() on show instead, guarded so it never touches a 0-size div. */
    window.Plotly.react(div, traces, layout, { displaylogo: false });
    requestAnimationFrame(() => { if (div.clientWidth > 0 && div.clientHeight > 0) window.Plotly.Plots.resize(div); });
  }

  function renderPixel() {
    if (!R || !selPixel || !window.Plotly) return;
    const { p } = selPixel;
    if (!R.validMask[p]) { pixHead.textContent = `Pixel (${selPixel.r}, ${selPixel.c}) — no data`; pixDivs.forEach((d) => window.Plotly.purge(d)); return; }
    pixHead.textContent = `Pixel (row ${selPixel.r}, col ${selPixel.c})`;
    const { T, rows, cols, dates, weather } = R, nP = rows * cols;
    const ser = (name) => { const s = R.daily[name]; if (!s) return null; const y = new Array(T); for (let t = 0; t < T; t++) y[t] = s[t * nP + p]; return y; };
    /* ETo/precip come per-pixel from the spatial stacks (R.daily.ETo/Precip) if
       present, else from the single field-wide series. */
    const eto = ser('ETo') || (weather ? weather.map((w) => w.ETo) : null);
    const prcp = ser('Precip') || (weather ? weather.map((w) => w.prcp) : null);
    const etc = ser('ETc'), aw = ser('Sr_paw'), kcb = ser('Kcb'), ke = ser('Ke');

    /* 1 — ETo (demand) and ETc (actual crop ET), both mm/day. */
    const t1 = [];
    if (eto) t1.push({ x: dates, y: eto, name: 'ETo', line: { color: VIZ.eto, width: 1.3, dash: 'dot' } });
    if (etc) t1.push({ x: dates, y: etc, name: 'ETc', line: { color: VIZ.etc, width: 1.6 } });
    panel(pixEt, t1, 'ET (mm/d)');

    /* 2 — plant-available water (mm, left; rises with rain, falls with ET, like
       soil moisture) and precipitation (bars, right, hanging from the top). */
    const t2 = [];
    if (aw) t2.push({ x: dates, y: aw, name: 'Avail. water', line: { color: VIZ.storage, width: 1.6 } });
    if (prcp) t2.push({ x: dates, y: prcp, name: 'Precip', type: 'bar', yaxis: 'y2', marker: { color: VIZ.precip } });
    panel(pixDr, t2, 'Avail. water (mm)', {
      yaxis2: { title: 'Pr (mm)', overlaying: 'y', side: 'right', showgrid: false, autorange: 'reversed', rangemode: 'tozero', tickfont: { size: 9, color: VIZ.muted }, titlefont: { size: 10, color: VIZ.ink2 } },
    });

    /* 3 — Kcb (basal) and Kcb+Ke (basal + soil evaporation = total Kc). */
    const t3 = [];
    if (kcb) t3.push({ x: dates, y: kcb, name: 'Kcb', line: { color: VIZ.kcb, width: 1.6 } });
    if (kcb && ke) t3.push({ x: dates, y: kcb.map((v, i) => v + (ke[i] || 0)), name: 'Kcb + Ke', line: { color: VIZ.kc, width: 1.3 } });
    panel(pixKc, t3, 'Kc (–)');

    linkZoom(pixDivs);
  }

  /* Export the active map layer (current variable + day) as a georeferenced
     Float32 GeoTIFF (EPSG:4326, -9999 nodata) built client-side from the grid. */
  function exportGeoTiff() {
    if (!R || !R.rect) return;
    const { rows, cols, rect } = R;
    const ab = buildGeoTiff(slice(curVar, curDay), {
      width: cols, height: rows,
      west: rect.west, north: rect.north,
      pixelW: (rect.east - rect.west) / cols, pixelH: (rect.north - rect.south) / rows,
      nodata: -9999,
    });
    const tag = VARS[curVar].kind === 'daily' ? `_${R.dates[curDay]}` : '';
    downloadBlob(`${curVar}${tag}.tif`, ab, 'image/tiff');
  }

  function ensureMap() {
    if (map || !window.L) return;
    const L = window.L;
    map = L.map(mapEl, { zoomControl: true });
    const bases = baseLayers(L);
    bases.Hybrid.addTo(map);
    L.control.layers(bases, {}, { position: 'topleft' }).addTo(map);

    legend = L.control({ position: 'topright' });
    legend.onAdd = () => { legendEl = L.DomUtil.create('div', 'spatial-legend'); L.DomEvent.disableClickPropagation(legendEl); return legendEl; };
    legend.addTo(map);

    map.on('click', (e) => {
      if (!R) return;
      const r = R.rect;
      const col = Math.floor((e.latlng.lng - r.west) / (r.east - r.west) * R.cols);
      const row = Math.floor((r.north - e.latlng.lat) / (r.north - r.south) * R.rows);
      if (row < 0 || col < 0 || row >= R.rows || col >= R.cols) return;
      selPixel = { r: row, c: col, p: row * R.cols + col };
      markPixel(); renderPixel();
    });
    map.setView([0, 0], 2);
  }

  /* Which variables this result actually carries (ETo/precip only exist for a
     spatial-weather run; soil layers need the soil grids). */
  function availableVars() {
    return Object.keys(VARS).filter((v) => {
      const m = VARS[v];
      if (m.kind === 'daily') return !!(R.daily && R.daily[v]);
      if (m.kind === 'summary') return !!(R.summary && R.summary[v]);
      return !!R.soil;   /* soil layers */
    });
  }

  function setData(result) {
    R = result;
    for (const k in ranges) delete ranges[k];
    awc = null; curDay = 0; selPixel = null;
    const avail = availableVars();
    if (!avail.includes(curVar)) curVar = avail[0];
    varSel.setOptions(avail.map((v) => ({ value: v, label: VARS[v].label })), curVar);
    daySlider.max = String(Math.max(0, R.T - 1)); daySlider.value = '0';
    daySlider.disabled = VARS[curVar].kind !== 'daily';
    if (window.Plotly) pixDivs.forEach((d) => window.Plotly.purge(d));
    pixHead.textContent = 'Click a pixel';
    ensureMap();
    fitted = false;
    if (marker) { map.removeLayer(marker); marker = null; }
    drawFieldBoundary();
    refresh();
    fitToBounds();
  }

  /* Fit the map to the data ONCE, and only when the container actually has a
     size. If setData runs while the outputs tab is hidden (0×0 container),
     fitBounds would pick a garbage zoom and blow the overlay up off-screen;
     invalidateSize alone never repairs that. So we defer the fit until the
     panel is visible (resize() fires on tab-show) and redraw the overlay then
     so its transform is recomputed against the correct projection. */
  function fitToBounds() {
    if (!map || !R || fitted) return;
    setTimeout(() => {
      if (fitted) return;
      map.invalidateSize();
      if (mapEl.clientWidth < 2 || mapEl.clientHeight < 2) return;   /* still hidden — try again on next resize() */
      map.fitBounds(bounds(), { padding: [10, 10] });
      drawOverlay();
      fitted = true;
    }, 60);
  }

  function resize() {
    if (map) { setTimeout(() => map.invalidateSize(), 40); fitToBounds(); }
    if (selPixel && window.Plotly) pixDivs.forEach((d) => { if (d._fullLayout && d.clientWidth > 0 && d.clientHeight > 0) window.Plotly.Plots.resize(d); });
  }

  return { el: root, setData, resize };
}
