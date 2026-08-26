/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/field-scale/index.js — the gridded FAO-56 tool (Field Scale + Mesoscale).
 *
 * Draw or upload an area, pick a period and crop/management settings, sign in
 * to Earth Engine; soil + vegetation index + GRIDMET weather are pulled onto one
 * grid, engine.js runs once per pixel (single thread), and the result is mapped.
 * The area is bounded by a per-dataset hectare cap.
 *
 * The heavy externals (Leaflet, Google Identity Services, the Earth Engine JS
 * API) load lazily on first open, exactly as the GEE Collector does.
 */

import { el } from '../../ui/dom.js';
import { group, ctrl, numInput, dateInput, textInput, selectInput, segmented, btn, readout, metricsBar, callout } from '../../ui/components.js';
import { createBoundaryPicker } from './boundaries.js';
import { createWorkbench } from '../../ui/workbench.js';
import { GEE_OAUTH_CLIENT_ID } from '../../app/config.js';
import { saveGeeSession, loadGeeSession, clearGeeSession, savedProject, saveProject } from '../../app/geeSession.js';
import { geeProjectHelp } from '../../app/geeHelp.js';
import { getVegSource, FIELD_SOURCES, indexOptions } from './veg_sources.js';
import { getSoilSource } from './soil_sources.js';
import { baseLayers } from './basemaps.js';
import { gridShape, checkAoi } from './grid.js';
import { buildKcbStack } from './kcb_grid.js';
import { runGrid, DEFAULT_DAILY_VARS } from './run_grid.js';
import { collectGrid } from './ee_data.js';
import { createResults } from './results.js';
import { DOCS } from './docs.js';

const EE_SCOPE = 'https://www.googleapis.com/auth/earthengine https://www.googleapis.com/auth/cloud-platform.read-only';

/* Default period: Jan 1 through ~a week ago. GRIDMET lags the present by a few
   days, so ending a week back keeps the default range inside available data.
   Start uses the END's year, so the first days of January still give a valid
   (previous-year) range instead of start > end. */
const iso = (d) => d.toISOString().slice(0, 10);
const DEFAULT_END = new Date(Date.now() - 7 * 86400000);
const DEFAULT = { lat: 39.05, lon: -96.55, start: `${DEFAULT_END.getFullYear()}-01-01`, end: iso(DEFAULT_END) };
/* Soft heads-up threshold only — NOT a cap. Above this many grid pixels we warn
   that a run may be slow or hit the user's Earth Engine quota; the run is never
   blocked (EE enforces its own limits and returns the real error). */
const HINT_PIXELS = 40000;

let libsPromise = null;
function ensureLibs() {
  if (libsPromise) return libsPromise;
  const css = (href) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); };
  const js = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error(`Could not load ${src}`)); document.head.appendChild(s); });
  css('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
  css('https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css');
  libsPromise = Promise.all([
    /* leaflet-draw extends L, so it must load after Leaflet itself. */
    js('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js')
      .then(() => js('https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js')),
    js('https://accounts.google.com/gsi/client'),
    js('https://cdn.jsdelivr.net/npm/@google/earthengine@latest/build/ee_api_js.js'),
  ]);
  /* A failed load (offline, blocked CDN) must not lock the tool until reload. */
  libsPromise.catch(() => { libsPromise = null; });
  return libsPromise;
}

/** The outer ring of the first polygon in a GeoJSON, as Leaflet [lat,lng] pairs. */
function geojsonOuterRing(gj) {
  const g = gj.type === 'FeatureCollection' ? gj.features?.[0]?.geometry
    : gj.type === 'Feature' ? gj.geometry : gj;
  if (!g) return null;
  const ring = g.type === 'Polygon' ? g.coordinates[0]
    : g.type === 'MultiPolygon' ? g.coordinates[0]?.[0] : null;
  return ring ? ring.map(([lng, lat]) => [lat, lng]) : null;
}

/**
 * A Leaflet polygon/multipolygon's outer rings, each as [lng,lat] pairs. Works
 * for a simple drawn/uploaded polygon (one ring) and for a selected boundary
 * that is a MultiPolygon (several). Holes, if any, are treated as extra rings —
 * harmless here since the boundary layers carry only outer rings.
 */
function shapeOuterRings(fieldShape) {
  const out = [];
  const walk = (a) => {
    if (!a || !a.length) return;
    if (Array.isArray(a[0])) { a.forEach(walk); return; }   /* deeper: array of rings/polys */
    out.push(a.map((ll) => [ll.lng, ll.lat]));              /* leaf: array of LatLng */
  };
  walk(fieldShape.getLatLngs());
  return out;
}

/** Set a daily stack [t*nPixels+p] to NaN wherever validMask[p] is 0, so weather
 *  layers (ETo/precip) share the clipped footprint of the modeled variables. */
function maskDailyToValid(stack, validMask, T, nPixels) {
  for (let p = 0; p < nPixels; p++) {
    if (!validMask[p]) for (let t = 0; t < T; t++) stack[t * nPixels + p] = NaN;
  }
  return stack;
}

/** Ray-casting point-in-polygon on [lng,lat] pairs (planar; fine at field scale). */
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/**
 * Factory parameterised by the vegetation dataset(s) it offers (config.sources)
 * — Field Scale and Mesoscale share the engine, map, draw tools, and results,
 * differing only in dataset (and therefore resolution, soil source, weather
 * mode, and area cap). onShow is held in this factory's own closure, so two
 * tools built from this module never clash.
 */
export function createSpatialTool(config) {
  let onShowFn = null;

  function create() {
  const wb = createWorkbench({ inputsLabel: 'Map', outputsLabel: 'Results' });
  const state = { authed: false, tokenClient: null, map: null, drawn: null, fieldShape: null, center: { lat: DEFAULT.lat, lon: DEFAULT.lon }, vegSource: config.sources[0], result: null, scaleM: config.sources[0].scaleM };

  /* ── Sidebar: Earth Engine ──────────────────────────────────────────── */
  const appConfigured = !!GEE_OAUTH_CLIENT_ID;
  const projectIn = textInput({ value: savedProject(), placeholder: 'your-earth-engine-project-id', onChange: (v) => saveProject(v.trim()) });
  const clientIn = textInput({ placeholder: 'xxxx.apps.googleusercontent.com' });
  const signInBtn = btn('Sign in with Google', { kind: 'neon', small: true, block: true, onClick: signIn });
  const authStatus = el('div', { class: 'hint', style: { marginTop: '0.3rem' } }, 'Not connected.');
  const gEE = group('Earth Engine', { open: true });
  gEE.body.append(ctrl('GEE Project ID', projectIn.el), geeProjectHelp());
  if (!appConfigured) gEE.body.append(ctrl('OAuth Client ID', clientIn.el));
  gEE.body.append(
    el('div', { style: { marginTop: '0.4rem' } }, signInBtn), authStatus,
    el('div', { class: 'hint', style: { marginTop: '0.4rem' } }, appConfigured
      ? 'Sign in with a Google account that has Earth Engine access, then enter your EE project.'
      : 'Dev mode: paste a Web OAuth Client ID whose authorized origins include this app’s origin.'),
  );

  /* ── Sidebar: vegetation dataset ────────────────────────────────────── */
  /* Each tool currently offers a single dataset; the dropdown stays so a second
     source is a config entry in veg_sources.js. The dataset sets the grid
     resolution, soil source, weather mode, and area cap. */
  const datasetSel = selectInput({ options: config.sources.map((s) => ({ value: s.id, label: s.label })), value: state.vegSource.id, onChange: onDataset });
  const datasetNote = el('div', { class: 'hint', style: { marginTop: '0.4rem', lineHeight: '1.4' } }, state.vegSource.note);
  const gData = group('Vegetation dataset', { open: true });
  gData.body.append(ctrl('Source', datasetSel.el), datasetNote);

  /* ── Sidebar: region boundary ───────────────────────────────────────────
     Load a county / state / ASD from assets/ as the AOI, instead of drawing.
     Only offered when a tool opts in with config.boundaryLevels (Mesoscale) —
     a county is a mesoscale object, too coarse for the 30 m Field Scale tool.
     There is no area cap: the run uses the user's own Earth Engine project, so
     EE enforces its own quotas and returns the real error if a region is too
     large. Remove this block + boundaries.js to drop the feature; nothing else
     depends on it. */
  let gBoundary = null;
  if (config.boundaryLevels && config.boundaryLevels.length) {
    const boundaryPicker = createBoundaryPicker({
      levels: config.boundaryLevels,
      onPick: ({ rings, label }) => applyRegionShape(rings, label),
    });
    gBoundary = group('Region boundary', { open: false });
    gBoundary.body.append(boundaryPicker.el);
    /* Fetch the (large) boundary files only once the user opens this group. */
    gBoundary.el.addEventListener('toggle', () => { if (gBoundary.el.open) boundaryPicker.load(); });
  }

  /* ── Sidebar: period ────────────────────────────────────────────────── */
  const startIn = dateInput({ value: DEFAULT.start, onChange: syncSize });
  const endIn = dateInput({ value: DEFAULT.end, onChange: syncSize });
  const gArea = group('Period', { open: true });
  gArea.body.append(ctrl('Start', startIn.el), ctrl('End', endIn.el));

  /* ── Sidebar: crop & vegetation index ───────────────────────────────── */
  const indexSel = selectInput({ options: indexOptions(state.vegSource), value: indexOptions(state.vegSource)[0].value });
  /* EVI endpoints: bare soil ≈ 0.15, full canopy at 0.70 (the rescale clamps, so
     any EVI ≥ 0.70 saturates to Kcb max). */
  const viSoilIn = numInput({ value: 0.15, min: -0.2, max: 1, step: 0.01 });
  const viFullIn = numInput({ value: 0.70, min: 0, max: 1, step: 0.01 });
  const kcbMinIn = numInput({ value: 0.15, min: 0, max: 1, step: 0.01 });
  const kcbMaxIn = numInput({ value: 1.15, min: 0.2, max: 1.4, step: 0.01 });
  const zrIn = numInput({ value: 1.2, min: 0.2, max: 3, step: 0.1 });
  const pIn = numInput({ value: 0.55, min: 0.2, max: 0.8, step: 0.05 });
  const hIn = numInput({ value: 1.5, min: 0.1, max: 4, step: 0.1 });
  const gCrop = group('Crop & vegetation index', { open: true });
  gCrop.body.append(
    ctrl('Index', indexSel.el),
    ctrl('VI soil (→ Kcb min)', viSoilIn.el), ctrl('VI full cover (→ Kcb max)', viFullIn.el),
    ctrl('Kcb min', kcbMinIn.el), ctrl('Kcb max', kcbMaxIn.el),
    ctrl('Max root depth', zrIn.el, { unit: 'm' }),
    ctrl('Depletion fraction p', pIn.el),
    ctrl('Canopy height', hIn.el, { unit: 'm' }),
  );

  /* ── Sidebar: management ────────────────────────────────────────────── */
  const fawIn = numInput({ value: 70, min: 0, max: 100, step: 5 });
  const cnIn = numInput({ value: 78, min: 30, max: 98, step: 1 });
  const irrigSel = selectInput({ options: [{ value: 'rainfed', label: 'Rainfed' }, { value: 'auto', label: 'Auto (MAD trigger)' }], value: 'rainfed', onChange: (v) => { autoRow.hidden = v !== 'auto'; } });
  const madIn = numInput({ value: 0.5, min: 0.2, max: 0.8, step: 0.05 });
  const amtIn = numInput({ value: 25, min: 5, max: 75, step: 5 });
  const autoRow = el('div', {}, ctrl('MAD trigger', madIn.el), ctrl('Irrigation amount', amtIn.el, { unit: 'mm' }));
  autoRow.hidden = true;
  const gMgmt = group('Management', { open: false });
  gMgmt.body.append(
    ctrl('Initial available water', fawIn.el, { unit: '%' }),
    ctrl('Curve number', cnIn.el),
    ctrl('Irrigation', irrigSel.el), autoRow,
  );

  wb.sidebar.append(...[gEE.el, gData.el, gBoundary && gBoundary.el, gArea.el, gCrop.el, gMgmt.el].filter(Boolean));

  const runBtn = btn('Run model', { kind: 'primary', block: true, onClick: run });
  runBtn.disabled = true;
  const runStatus = el('div', { class: 'runbar__status' });
  wb.foot.append(el('div', { class: 'runbar' }, runBtn, runStatus));

  /* ── Canvas: Map + size report ──────────────────────────────────────── */
  const mapEl = el('div', { style: { height: '460px', width: '100%', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--panel-2)', position: 'relative', zIndex: '0', isolation: 'isolate' } });
  const sizeMetrics = metricsBar([]);
  const sizeWarn = el('div', {});
  const srcText = () => `${state.vegSource.label} · ${state.scaleM} m grid`;
  const srcHint = el('div', { class: 'hint' }, srcText());
  const drawHint = el('div', { class: 'hint' }, 'Trace the boundary with the draw tools (top-left of the map), or upload a GeoJSON.');
  const gjInput = el('input', { type: 'file', accept: '.geojson,.json,application/geo+json', style: { display: 'none' }, onchange: onGeojson });
  const gjBtn = btn('Upload boundary (GeoJSON)', { small: true, onClick: () => gjInput.click() });

  /* Optional grid-resolution selector (Field Scale offers 30/250/1000 m; a
     coarser grid trades detail for area so a whole county fits under the pixel
     budget). Absent when config.resolutions is unset (Mesoscale stays at its
     fixed native resolution). */
  const resSeg = config.resolutions ? segmented({
    options: config.resolutions.map((m) => ({ value: String(m), label: `${m} m` })),
    value: String(state.scaleM),
    onChange: (v) => { state.scaleM = +v; srcHint.textContent = srcText(); syncSize(); },
  }) : null;
  const resRow = resSeg ? el('div', { class: 'row', style: { gap: '0.5rem', alignItems: 'center' } },
    el('span', { class: 'hint' }, 'Grid resolution'), resSeg.el) : null;

  wb.inputs.append(el('div', { class: 'stack' }, srcHint, resRow,
    el('div', { class: 'row', style: { gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' } }, drawHint, gjBtn, gjInput),
    mapEl, sizeMetrics.el, sizeWarn));

  /* ── Canvas: Results ────────────────────────────────────────────────── */
  const results = createResults();
  wb.outputs.append(results.el);

  const root = el('div', { class: 'view' }, wb.el);

  /* ── Map ────────────────────────────────────────────────────────────── */
  let mapReady = false;
  async function initMap() {
    if (mapReady) { if (state.map) setTimeout(() => state.map.invalidateSize(), 50); return; }
    try { await ensureLibs(); } catch (e) { sizeWarn.append(callout('error', e.message)); return; }
    mapReady = true;
    const L = window.L;
    state.map = L.map(mapEl).setView([state.center.lat, state.center.lon], 11);
    const bases = baseLayers(L);
    bases.Hybrid.addTo(state.map);
    L.control.layers(bases, {}, { position: 'topleft' }).addTo(state.map);

    /* Draw tools: rectangle / circle / polygon define the field boundary; the
       grid is sampled over the shape's bounding box and clipped to the shape. */
    state.drawn = new L.FeatureGroup().addTo(state.map);
    state.map.addControl(new L.Control.Draw({
      position: 'topleft',
      draw: { rectangle: {}, circle: {}, polygon: { allowIntersection: false }, marker: false, polyline: false, circlemarker: false },
      edit: { featureGroup: state.drawn, edit: false },
    }));
    state.map.on(L.Draw.Event.CREATED, (e) => {
      state.drawn.clearLayers();
      state.drawn.addLayer(e.layer);
      state.fieldShape = e.layer;
      state.map.fitBounds(e.layer.getBounds(), { padding: [20, 20] });
      syncSize();
    });
    state.map.on(L.Draw.Event.DELETED, () => { state.fieldShape = null; syncSize(); });

    setTimeout(() => state.map.invalidateSize(), 60);
    syncSize();
    tryRestoreSession();
  }

  /* Reconnect from a stored token (if still valid) so a reload within the
     token's lifetime skips the sign-in popup. Libs are already loaded here. */
  function tryRestoreSession() {
    if (state.authed) return;
    const s = loadGeeSession();
    const clientId = GEE_OAUTH_CLIENT_ID || clientIn.get().trim();
    if (!s || !clientId) return;
    const project = s.project || projectIn.get().trim();
    const ee = window.ee;
    if (!ee) return;
    setAuth('', 'Reconnecting to Earth Engine…');
    ee.data.setAuthToken(clientId, 'Bearer', s.token, s.expiresInSec, null, () => {
      ee.initialize(null, null,
        () => { setAuth('ok', `Connected · project ${project} (restored)`); armExpiry(s.expiresInSec); },
        () => { clearGeeSession(); setAuth('', 'Session expired — sign in again.'); }, null, project);
    }, false);
  }

  /* Load a GeoJSON boundary as the field polygon (same role as a drawn one). */
  async function onGeojson(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';                    /* allow re-selecting the same file */
    if (!file) return;
    const warn = (kind, msg) => { sizeWarn.innerHTML = ''; sizeWarn.append(callout(kind, msg)); };
    if (!state.map || !window.L) { warn('warn', 'Open the map first, then upload a boundary.'); return; }
    let gj;
    try { gj = JSON.parse(await file.text()); } catch { warn('error', 'That file is not valid JSON/GeoJSON.'); return; }
    const latlngs = geojsonOuterRing(gj);
    if (!latlngs || latlngs.length < 3) { warn('warn', 'No polygon found in that GeoJSON (Polygon or MultiPolygon expected).'); return; }
    state.drawn.clearLayers();
    const poly = window.L.polygon(latlngs, { color: '#86dd52', weight: 2, fillOpacity: 0.06 });
    state.drawn.addLayer(poly);
    state.fieldShape = poly;
    state.map.fitBounds(poly.getBounds(), { padding: [20, 20] });
    syncSize();
  }

  /* Load a selected boundary (county/state/ASD) as the field polygon — same
     role as a drawn or uploaded one. `rings` are [lat,lng] outer rings; one →
     a simple polygon, several → a Leaflet MultiPolygon (so getBounds spans all
     parts). The sampled grid is still the bounding box; the polygon masks
     output pixels (see clipSoilToShape). */
  function applyRegionShape(rings, label) {
    if (!state.map || !window.L) { sizeWarn.innerHTML = ''; sizeWarn.append(callout('warn', 'Open the map first, then pick a boundary.')); return; }
    if (!rings || !rings.length) return;
    const L = window.L;
    const latlngs = rings.length === 1 ? rings[0] : rings.map((r) => [r]);
    const poly = L.polygon(latlngs, { color: '#86dd52', weight: 2, fillOpacity: 0.06 });
    state.drawn.clearLayers();
    state.drawn.addLayer(poly);
    state.fieldShape = poly;
    state.map.fitBounds(poly.getBounds(), { padding: [20, 20] });
    syncSize();
  }

  /* The AOI bounding box = the drawn shape's bounds, or null before anything is
     drawn. The grid is sampled over this rectangle; a circle/polygon then clips
     it (see run()). */
  function currentRect() {
    if (!state.fieldShape) return null;
    const b = state.fieldShape.getBounds();
    return { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() };
  }

  /* Switching dataset changes the grid resolution and area cap, so refresh the
     index options and the size report. */
  function onDataset(id) {
    const src = getVegSource(id);
    state.vegSource = src;
    datasetNote.textContent = src.note;
    /* A new dataset resets the resolution to its native scale (and the selector,
       if present, unless the native scale is one of the offered steps). */
    state.scaleM = (config.resolutions && config.resolutions.includes(src.scaleM)) ? state.scaleM : src.scaleM;
    if (resSeg && config.resolutions.includes(state.scaleM)) resSeg.set(String(state.scaleM));
    srcHint.textContent = srcText();
    const opts = indexOptions(src);
    indexSel.setOptions(opts, opts[0].value);
    syncSize();
  }

  function syncSize() {
    const rect = currentRect();
    if (!rect) {
      sizeMetrics.update([]);
      sizeWarn.innerHTML = '';
      sizeWarn.append(el('div', { class: 'hint' }, 'Draw a field boundary on the map to set the area.'));
      runBtn.disabled = true;
      return;
    }
    const chk = checkAoi(rect, { scaleM: state.scaleM });
    const big = chk.nPixels > HINT_PIXELS;
    sizeMetrics.update([
      { label: 'Grid', value: `${chk.cols}×${chk.rows}` },
      { label: 'Pixels', value: chk.nPixels, accent: big },
      { label: 'Area', value: chk.ha, digits: 0, unit: 'ha' },
    ]);
    /* No hard area cap — the user runs on their own Earth Engine project, so EE
       enforces its own quotas and returns the real error if the area is too
       large (surfaced in the run status). We only flag a large grid as a
       heads-up that it may be slow or rejected. A coarser resolution shrinks
       it when the tool offers one. */
    sizeWarn.innerHTML = '';
    if (big) {
      const canCoarsen = config.resolutions && state.scaleM !== Math.max(...config.resolutions);
      sizeWarn.append(callout('warn',
        `Large grid — ${chk.nPixels.toLocaleString()} pixels. This may take a while or exceed your Earth Engine limits; if it fails, EE’s message shows in the run status.${canCoarsen ? ' A coarser resolution reduces it.' : ''}`));
    }
    runBtn.disabled = !state.authed;
  }

  /* ── OAuth ──────────────────────────────────────────────────────────── */
  /* Google access tokens live ~1 h with no refresh token. Flip the UI back to
     signed-out shortly before expiry so the button never claims "Signed in"
     over a dead token (a run would then fail with an auth error). */
  let expiryTimer = null;
  function clearExpiry() { if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; } }
  function armExpiry(remainingSec) {
    clearExpiry();
    const ms = Math.max(0, (remainingSec || 3600) - 60) * 1000;
    expiryTimer = setTimeout(() => { clearGeeSession(); setAuth('', 'Session expired — sign in again.'); }, ms);
  }

  function setAuth(kind, msg) {
    authStatus.textContent = msg; authStatus.className = `hint${kind === 'ok' ? ' is-ok' : ''}`;
    state.authed = kind === 'ok';
    if (!state.authed) clearExpiry();
    /* Reflect the state on the button so a connected user isn't unsure whether
       to click again; it stays clickable so they can re-auth or switch project.
       Drop the neon call-to-action look once connected. */
    signInBtn.textContent = state.authed ? '✓ Signed in' : 'Sign in with Google';
    signInBtn.classList.toggle('btn--neon', !state.authed);
    syncSize();
  }
  async function signIn() {
    const clientId = GEE_OAUTH_CLIENT_ID || clientIn.get().trim();
    const project = projectIn.get().trim();
    if (!clientId) { setAuth('err', 'No OAuth Client ID (set app/config.js or paste one).'); return; }
    if (!project) { setAuth('err', 'Enter your Earth Engine project ID.'); return; }
    setAuth('', 'Loading libraries…');
    try { await ensureLibs(); } catch (e) { setAuth('err', e.message); return; }
    const ee = window.ee, google = window.google;
    try {
      state.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: EE_SCOPE,
        callback: (resp) => {
          if (resp.error) { setAuth('err', `Sign-in failed: ${resp.error}`); return; }
          setAuth('', 'Initializing Earth Engine…');
          ee.data.setAuthToken(clientId, 'Bearer', resp.access_token, resp.expires_in, null, () => {
            ee.initialize(null, null, () => {
              saveGeeSession(resp.access_token, resp.expires_in, project);
              setAuth('ok', `Connected · project ${project}`);
              armExpiry(resp.expires_in);
            }, (err) => setAuth('err', `EE init failed: ${err}`), null, project);
          }, false);
        },
      });
      state.tokenClient.requestAccessToken();
    } catch (e) { setAuth('err', `OAuth setup failed: ${e.message}`); }
  }

  /* Mask soil to NaN for pixels whose centre falls outside a drawn circle or
     polygon, so run_grid skips them and the field is clipped to the boundary.
     Pixel size uses the target cols/rows (the sampling transform); iteration
     uses the actual returned shape (which may be cropped by a pixel). */
  function clipSoilToShape(soil, rect, targetCols, targetRows, dataRows, dataCols, fieldShape) {
    const L = window.L;
    const isCircle = fieldShape instanceof L.Circle;
    const center = isCircle ? fieldShape.getLatLng() : null;
    const radius = isCircle ? fieldShape.getRadius() : 0;
    const rings = isCircle ? null : shapeOuterRings(fieldShape);   /* one (drawn) or many (multipolygon region) */
    const dLon = (rect.east - rect.west) / targetCols;
    const dLat = (rect.north - rect.south) / targetRows;
    for (let r = 0; r < dataRows; r++) {
      for (let c = 0; c < dataCols; c++) {
        const lon = rect.west + (c + 0.5) * dLon;
        const lat = rect.north - (r + 0.5) * dLat;
        const inside = isCircle ? state.map.distance([lat, lon], center) <= radius : rings.some((ring) => pointInRing(lon, lat, ring));
        if (!inside) { const p = r * dataCols + c; soil.rootzone_fc[p] = NaN; soil.rootzone_wp[p] = NaN; soil.surface_fc[p] = NaN; soil.surface_wp[p] = NaN; }
      }
    }
  }

  /* ── Run ────────────────────────────────────────────────────────────── */
  function setStatus(msg, kind) { runStatus.textContent = msg; runStatus.className = `runbar__status${kind ? ' is-' + kind : ''}`; }

  async function run() {
    if (!state.authed) { setStatus('Sign in first.', 'error'); return; }
    const start = startIn.get(), end = endIn.get();
    if (!start || !end || end < start) { setStatus('Pick a valid start/end.', 'error'); return; }
    const rect = currentRect();
    if (!rect) { setStatus('Draw a field boundary first.', 'error'); return; }
    runBtn.disabled = true;
    const ee = window.ee;
    try {
      const zrMax = zrIn.get();
      const gsz = gridShape(rect, state.scaleM);
      const data = await collectGrid(ee, {
        rect, cols: gsz.cols, rows: gsz.rows,
        start, end, index: indexSel.get(),
        vegSource: state.vegSource, soilSource: getSoilSource(state.vegSource.soil),
        weatherMode: state.vegSource.weather,
        onProgress: (m) => setStatus(m),
      });

      /* Clip the sampled bbox to a drawn field boundary: mask soil to NaN
         outside the shape so run_grid skips those pixels (a rectangle needs no
         clip — its bbox is the shape). */
      if (state.fieldShape && !(state.fieldShape instanceof window.L.Rectangle)) {
        clipSoilToShape(data.soil, rect, gsz.cols, gsz.rows, data.rows, data.cols, state.fieldShape);
      }

      setStatus('Building Kcb from vegetation index…');
      const { kcb } = buildKcbStack(data.obsDates, data.viStack, data.dates, {
        viMin: viSoilIn.get(), viMax: viFullIn.get(), kcbMin: kcbMinIn.get(), kcbMax: kcbMaxIn.get(),
      });

      const grid = { cols: data.cols, rows: data.rows, nPixels: data.cols * data.rows };
      const scalars = { Ze: 0.10, REW_frac: 0.5, Zr_profile: Math.max(2.0, zrMax + 0.3), faw0: fawIn.get() / 100 };
      const crop = { Zr_max: zrMax, h_max: hIn.get(), Kcb_full: kcbMaxIn.get(), p_tab: pIn.get(), Kc_min: 0.15 };
      const mgmt = { curve_number: cnIn.get(), irrigation_mode: irrigSel.get(), mad: madIn.get(), irrig_amount: amtIn.get() };

      setStatus(`Running model on ${grid.nPixels} pixels…`);
      /* Let the status paint before the synchronous single-thread run. */
      await new Promise((r) => setTimeout(r, 30));
      const t0 = performance.now();
      const result = runGrid(grid, data.soil, scalars, kcb, data.dates, data.weather || null, crop, mgmt,
        { dailyVars: DEFAULT_DAILY_VARS, weatherStacks: data.weatherStacks });
      const ms = performance.now() - t0;

      /* Bounds, soil grids and driving weather ride along for the map overlay,
         the soil layers, and the pixel charts. */
      result.rect = rect;
      result.soil = data.soil;
      result.weather = data.weather;
      /* Per-pixel weather (mesoscale) → ETo/precip become map layers too. These
         come straight from the sampled bounding box, so mask them to the run's
         validMask — the same footprint (drawn/region polygon minus no-data) that
         clips every modeled variable — or they'd spill past the boundary. */
      if (data.weatherStacks) {
        result.daily.ETo = maskDailyToValid(data.weatherStacks.eto, result.validMask, result.T, grid.nPixels);
        result.daily.Precip = maskDailyToValid(data.weatherStacks.prcp, result.validMask, result.T, grid.nPixels);
      }
      if (state.fieldShape) {
        const L = window.L, s = state.fieldShape;
        if (s instanceof L.Circle) {
          result.fieldShape = { kind: 'circle', center: [s.getLatLng().lat, s.getLatLng().lng], radius: s.getRadius() };
        } else {
          /* Outline the largest outer ring (multipolygon regions have several). */
          const rings = shapeOuterRings(s);
          const outer = rings.reduce((a, b) => (b.length > a.length ? b : a), rings[0]);
          result.fieldShape = { kind: 'poly', latlngs: outer.map(([lng, lat]) => [lat, lng]) };
        }
      }

      state.result = result;
      results.setData(result);
      wb.setOutputsEnabled(true);
      wb.showTab('outputs');
      setTimeout(() => results.resize(), 60);
      setStatus(`Done — ${result.nValid} pixels, ${data.nViDates} clear VI dates, ${(ms / 1000).toFixed(1)} s.`, 'ok');
    } catch (e) {
      console.error(e);
      /* An expired/invalid token surfaces here as an auth error. Flip back to
         signed-out so the button stops claiming "Signed in" and prompts a
         re-sign-in, rather than leaving a dead session that keeps failing. */
      if (/authenticat|credential|oauth|unauthorized|401/i.test(e.message || '')) {
        clearGeeSession();
        setAuth('', 'Session expired — sign in again, then re-run.');
        setStatus('Session expired — sign in again, then re-run.', 'error');
      } else {
        setStatus(`Failed: ${e.message}`, 'error');
      }
    } finally {
      syncSize();
    }
  }

  onShowFn = () => { initMap(); setTimeout(() => results.resize(), 80); };
  return root;
  }

  return {
    title: config.title,
    docs: config.docs,
    create,
    onShow() { if (onShowFn) onShowFn(); },
  };
}

/* Field Scale: 30 m, draw or upload a real field. No region picker or grid-
   resolution steps — a county is a Mesoscale object (see tools/mesoscale). */
export default createSpatialTool({ title: 'Field Scale', docs: DOCS, sources: FIELD_SOURCES });
