/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * modes/spatial/index.js — the gridded FAO-56 tool (Field Scale + Mesoscale).
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
import { group, ctrl, numInput, dateInput, textInput, selectInput, btn, readout, metricsBar, callout } from '../../ui/components.js';
import { createWorkbench } from '../../ui/workbench.js';
import { GEE_OAUTH_CLIENT_ID } from '../../app/config.js';
import { saveGeeSession, loadGeeSession, clearGeeSession, savedProject, saveProject } from '../../app/geeSession.js';
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
const DEFAULT = { lat: 39.05, lon: -96.55, start: '2021-05-01', end: '2021-09-15' };

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
  const state = { authed: false, tokenClient: null, map: null, drawn: null, fieldShape: null, center: { lat: DEFAULT.lat, lon: DEFAULT.lon }, vegSource: config.sources[0], result: null };

  /* ── Sidebar: Earth Engine ──────────────────────────────────────────── */
  const appConfigured = !!GEE_OAUTH_CLIENT_ID;
  const projectIn = textInput({ value: savedProject(), placeholder: 'your-earth-engine-project-id', onChange: (v) => saveProject(v.trim()) });
  const clientIn = textInput({ placeholder: 'xxxx.apps.googleusercontent.com' });
  const signInBtn = btn('Sign in with Google', { kind: 'neon', small: true, block: true, onClick: signIn });
  const authStatus = el('div', { class: 'hint', style: { marginTop: '0.3rem' } }, 'Not connected.');
  const gEE = group('Earth Engine', { open: true });
  gEE.body.append(ctrl('Project ID', projectIn.el));
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

  wb.sidebar.append(gEE.el, gData.el, gArea.el, gCrop.el, gMgmt.el);

  const runBtn = btn('Run model', { kind: 'primary', block: true, onClick: run });
  runBtn.disabled = true;
  const runStatus = el('div', { class: 'runbar__status' });
  wb.foot.append(el('div', { class: 'runbar' }, runBtn, runStatus));

  /* ── Canvas: Map + size report ──────────────────────────────────────── */
  const mapEl = el('div', { style: { height: '460px', width: '100%', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--panel-2)', position: 'relative', zIndex: '0', isolation: 'isolate' } });
  const sizeMetrics = metricsBar([]);
  const sizeWarn = el('div', {});
  const srcHint = el('div', { class: 'hint' }, `${state.vegSource.label} · ${state.vegSource.scaleM} m grid`);
  const drawHint = el('div', { class: 'hint' }, 'Trace the boundary with the draw tools (top-left of the map), or upload a GeoJSON.');
  const gjInput = el('input', { type: 'file', accept: '.geojson,.json,application/geo+json', style: { display: 'none' }, onchange: onGeojson });
  const gjBtn = btn('Upload boundary (GeoJSON)', { small: true, onClick: () => gjInput.click() });
  wb.inputs.append(el('div', { class: 'stack' }, srcHint,
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
        () => setAuth('ok', `Connected · project ${project} (restored)`),
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
    srcHint.textContent = `${src.label} · ${src.scaleM} m grid`;
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
    const chk = checkAoi(rect, { scaleM: state.vegSource.scaleM, maxHa: state.vegSource.maxHa });
    sizeMetrics.update([
      { label: 'Grid', value: `${chk.cols}×${chk.rows}` },
      { label: 'Pixels', value: chk.nPixels, accent: !chk.ok },
      { label: 'Area', value: chk.ha, digits: 0, unit: 'ha', accent: !chk.ok },
      { label: 'Max area', value: chk.maxHa, digits: 0, unit: 'ha' },
    ]);
    sizeWarn.innerHTML = '';
    if (!chk.ok) sizeWarn.append(callout('warn', `Area ${chk.ha.toFixed(0)} ha is over the ${chk.maxHa.toLocaleString()} ha limit for ${state.vegSource.label}. Draw a smaller field.`));
    runBtn.disabled = !state.authed || !chk.ok;
  }

  /* ── OAuth ──────────────────────────────────────────────────────────── */
  function setAuth(kind, msg) {
    authStatus.textContent = msg; authStatus.className = `hint${kind === 'ok' ? ' is-ok' : ''}`;
    state.authed = kind === 'ok'; syncSize();
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
    const ring = isCircle ? null : fieldShape.getLatLngs()[0].map((ll) => [ll.lng, ll.lat]);
    const dLon = (rect.east - rect.west) / targetCols;
    const dLat = (rect.north - rect.south) / targetRows;
    for (let r = 0; r < dataRows; r++) {
      for (let c = 0; c < dataCols; c++) {
        const lon = rect.west + (c + 0.5) * dLon;
        const lat = rect.north - (r + 0.5) * dLat;
        const inside = isCircle ? state.map.distance([lat, lon], center) <= radius : pointInRing(lon, lat, ring);
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
      const gsz = gridShape(rect, state.vegSource.scaleM);
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
      /* Per-pixel weather (mesoscale) → ETo/precip become map layers too. */
      if (data.weatherStacks) {
        result.daily.ETo = data.weatherStacks.eto;
        result.daily.Precip = data.weatherStacks.prcp;
      }
      if (state.fieldShape) {
        const L = window.L, s = state.fieldShape;
        result.fieldShape = (s instanceof L.Circle)
          ? { kind: 'circle', center: [s.getLatLng().lat, s.getLatLng().lng], radius: s.getRadius() }
          : { kind: 'poly', latlngs: s.getLatLngs()[0].map((ll) => [ll.lat, ll.lng]) };
      }

      state.result = result;
      results.setData(result);
      wb.setOutputsEnabled(true);
      wb.showTab('outputs');
      setTimeout(() => results.resize(), 60);
      setStatus(`Done — ${result.nValid} pixels, ${data.nViDates} clear VI dates, ${(ms / 1000).toFixed(1)} s.`, 'ok');
    } catch (e) {
      console.error(e);
      setStatus(`Failed: ${e.message}`, 'error');
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

export default createSpatialTool({ title: 'Field Scale', docs: DOCS, sources: FIELD_SOURCES });
