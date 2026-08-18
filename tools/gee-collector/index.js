/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/gee-collector/index.js — pick a point on a Leaflet map, choose a
 * period, sign in to Google Earth Engine (browser OAuth), and pull GRIDMET
 * weather + a MODIS vegetation index at that point into one ready-to-use CSV.
 *
 * This mode is different from the rest: it needs three external libraries
 * (Leaflet, Google Identity Services, the Earth Engine JS API) which are
 * loaded lazily on first open, and it talks to Google's servers. The parsing
 * / column-mapping / rescaling all live in gee.js (pure, no DOM); this file is
 * the map, the OAuth handshake, the two getRegion calls, and the UI.
 */

import { el } from '../../ui/dom.js';
import { fmtInt, fmtDate } from '../../ui/format.js';
import { group, ctrl, numInput, dateInput, textInput, selectInput, checkbox, btn, readout, metricsBar, dataTable, callout } from '../../ui/components.js';
import { downloadText } from '../../ui/download.js';
import { createWorkbench } from '../../ui/workbench.js';
import { chartCard, plot, VIZ } from '../../ui/plotly.js';
import { GEE_OAUTH_CLIENT_ID } from '../../app/config.js';
import { saveGeeSession, loadGeeSession, clearGeeSession, savedProject, saveProject } from '../../app/geeSession.js';
import { regionArrayToRows, gridmetToWeather, modisToVi, kcbSeries, assembleCsv } from './gee.js';
import { DOCS } from './docs.js';

const DEFAULT = { lat: 39.0845, lon: -96.5563, start: '2021-06-01', end: '2021-08-31', soil: 0.15, veg: 0.85 };

/* create() runs once (the view is cached); it stashes the instance's map
   initialiser here so the module-level onShow can (re)fit the map each time
   the mode becomes visible. */
let instanceOnShow = null;
const EE_SCOPE = 'https://www.googleapis.com/auth/earthengine https://www.googleapis.com/auth/cloud-platform.read-only';

/* Lazy-load the three heavy externals once; resolve when their globals exist. */
let libsPromise = null;
function ensureLibs() {
  if (libsPromise) return libsPromise;
  const css = (href) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); };
  const js = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error(`Could not load ${src}`)); document.head.appendChild(s); });
  css('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
  libsPromise = Promise.all([
    js('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'),
    js('https://accounts.google.com/gsi/client'),
    js('https://cdn.jsdelivr.net/npm/@google/earthengine@latest/build/ee_api_js.js'),
  ]);
  return libsPromise;
}

function addDaysISO(iso, n) {
  const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

function create() {
  const wb = createWorkbench({ inputsLabel: 'Map', outputsLabel: 'Data' });
  const state = { authed: false, tokenClient: null, map: null, marker: null, weather: null, vi: null, result: null };

  /* ── Sidebar: Earth Engine ──────────────────────────────────────────── */

  /* The app owner registers ONE OAuth client id (config.js) with the served
     origins whitelisted; end users then just sign in. Only when it's unset
     (local dev before registration) do we show a manual client-id field. */
  const appConfigured = !!GEE_OAUTH_CLIENT_ID;
  const projectIn = textInput({ value: savedProject(), placeholder: 'your-earth-engine-project-id', onChange: (v) => saveProject(v.trim()) });
  const clientIn = textInput({ placeholder: 'xxxx.apps.googleusercontent.com' });
  const signInBtn = btn('Sign in with Google', { kind: 'neon', small: true, block: true, onClick: signIn });
  const authStatus = el('div', { class: 'hint', style: { marginTop: '0.3rem' } }, 'Not connected.');
  const gEE = group('Earth Engine', { open: true });
  gEE.body.append(ctrl('Project ID', projectIn.el));
  if (!appConfigured) gEE.body.append(ctrl('OAuth Client ID', clientIn.el));
  gEE.body.append(
    el('div', { style: { marginTop: '0.4rem' } }, signInBtn),
    authStatus,
    el('div', { class: 'hint', style: { marginTop: '0.4rem' } }, appConfigured
      ? 'Sign in with a Google account that has Earth Engine access, then enter your EE project.'
      : 'Dev mode: paste a Web OAuth Client ID whose authorized origins include this app’s origin.'),
  );

  /* ── Sidebar: location & period ─────────────────────────────────────── */

  const latIn = numInput({ value: DEFAULT.lat, min: -90, max: 90, step: 0.0001, onChange: () => syncMarker() });
  const lonIn = numInput({ value: DEFAULT.lon, min: -180, max: 180, step: 0.0001, onChange: () => syncMarker() });
  const startIn = dateInput({ value: DEFAULT.start });
  const endIn = dateInput({ value: DEFAULT.end });
  const gLoc = group('Location & period', { open: true });
  gLoc.body.append(
    ctrl('Latitude', latIn.el, { unit: '°N' }),
    ctrl('Longitude', lonIn.el, { unit: '°E' }),
    el('div', { class: 'hint', style: { margin: '0.1rem 0 0.4rem' } }, 'Or click the map to set the point.'),
    ctrl('Start', startIn.el),
    ctrl('End', endIn.el),
    el('div', { class: 'hint', style: { marginTop: '0.3rem' } }, 'Longer periods take longer to fetch; a few seasons is typical.'),
  );

  /* ── Sidebar: vegetation index ──────────────────────────────────────── */

  /* Re-derive the output from already-fetched data when a post-processing
     option changes — no need to hit Earth Engine again. */
  const reRender = () => { if (state.weather) renderResult(); };
  const indexSel = selectInput({ options: [{ value: 'ndvi', label: 'NDVI' }, { value: 'evi', label: 'EVI' }], value: 'ndvi', onChange: reRender });
  const soilIn = numInput({ value: DEFAULT.soil, min: -0.2, max: 1, step: 0.01, onChange: reRender });
  const vegIn = numInput({ value: DEFAULT.veg, min: 0, max: 1, step: 0.01, onChange: reRender });
  const interpChk = checkbox({ label: 'Interpolate Kcb to daily', onChange: (v) => { extrapRow.hidden = !v; reRender(); } });
  const extrapSel = selectInput({ options: [{ value: 'constant', label: 'Hold first / last' }, { value: 'linear', label: 'Linear' }], value: 'constant', onChange: reRender });
  const extrapRow = ctrl('Beyond ends', extrapSel.el);
  extrapRow.hidden = true;
  const gVi = group('Vegetation index', { open: true });
  gVi.body.append(
    ctrl('Index', indexSel.el),
    ctrl('Soil (→ 0)', soilIn.el),
    ctrl('Full cover (→ 1)', vegIn.el),
    el('div', { style: { marginTop: '0.45rem' } }, interpChk.el),
    extrapRow,
    el('div', { class: 'hint', style: { marginTop: '0.3rem' } }, 'MODIS 16-day, Terra + Aqua merged, clear pixels only. The rescaled index becomes kcb_obs; interpolate to fill every day (edges held or extended linearly).'),
  );

  wb.sidebar.append(gEE.el, gLoc.el, gVi.el);

  const collectBtn = btn('Collect data', { kind: 'primary', block: true, onClick: collect });
  collectBtn.disabled = true;
  const runStatus = el('div', { class: 'runbar__status' });
  const downloadBtn = btn('Download CSV', { small: true, kind: 'neon', onClick: download });
  downloadBtn.disabled = true;
  wb.foot.append(el('div', { class: 'runbar' }, collectBtn, runStatus, el('div', { class: 'row' }, downloadBtn)));

  /* ── Canvas: Map ────────────────────────────────────────────────────── */

  /* isolation:isolate confines Leaflet's high internal z-indexes (panes/
     controls run to ~1000) to this element's own stacking context, so the map
     can never render over the Docs drawer or a modal. */
  const mapEl = el('div', { style: { height: '460px', width: '100%', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--panel-2)', position: 'relative', zIndex: '0', isolation: 'isolate' } });
  const coordRO = readout('Point');
  wb.inputs.append(el('div', { class: 'stack' },
    el('div', { class: 'hint' }, 'Click anywhere to place the sample point.'),
    mapEl,
    coordRO.el,
  ));

  /* ── Canvas: Data ───────────────────────────────────────────────────── */

  const metrics = metricsBar([]);
  const dataWarn = el('div', {});
  const cPrcp = chartCard('Precipitation', { subtitle: 'mm/day', height: 220 });
  const cEto = chartCard('Reference ET (ETo)', { subtitle: 'mm/day', height: 220 });
  const cRmin = chartCard('Min relative humidity', { subtitle: '%', height: 220 });
  const cWspd = chartCard('Wind speed at 2 m', { subtitle: 'm/s', height: 220 });
  const cKcb = chartCard('Kcb from vegetation index', { subtitle: 'markers = clear observations', wide: true, height: 240 });
  const preview = dataTable([
    { key: 'date', label: 'date', format: (v) => v }, { key: 'prcp', label: 'prcp', digits: 2 },
    { key: 'eto', label: 'eto', digits: 2 }, { key: 'rmin', label: 'rmin', digits: 1 },
    { key: 'wspd', label: 'wspd', digits: 2 }, { key: 'kcb_obs', label: 'kcb_obs', format: (v) => (v === '' || v == null ? '' : v) },
  ], { maxHeight: '30rem' });
  wb.outputs.append(el('div', { class: 'stack' }, metrics.el, dataWarn,
    el('div', { class: 'chart-grid' }, cPrcp.card, cEto.card, cRmin.card, cWspd.card, cKcb.card),
    el('div', {}, el('div', { class: 'subhead' }, 'Preview'), preview.el)));

  const root = el('div', { class: 'view' }, wb.el);

  /* ── Map init (after libs load, on first show) ──────────────────────── */

  let mapReady = false;
  async function initMap() {
    if (mapReady) { if (state.map) setTimeout(() => state.map.invalidateSize(), 50); return; }
    try { await ensureLibs(); } catch (e) { coordRO.set(e.message); return; }
    mapReady = true;
    const L = window.L;
    state.map = L.map(mapEl).setView([latIn.get(), lonIn.get()], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(state.map);
    state.marker = L.marker([latIn.get(), lonIn.get()], { draggable: true }).addTo(state.map);
    state.marker.on('dragend', () => { const p = state.marker.getLatLng(); latIn.set(+p.lat.toFixed(4)); lonIn.set(+p.lng.toFixed(4)); showCoord(); });
    state.map.on('click', (e) => { latIn.set(+e.latlng.lat.toFixed(4)); lonIn.set(+e.latlng.lng.toFixed(4)); syncMarker(); });
    setTimeout(() => state.map.invalidateSize(), 60);
    showCoord();
    tryRestoreSession();
  }

  /* Reconnect from a stored token (if still valid) so a reload within the
     token's lifetime skips the sign-in popup. Libs are already loaded here. */
  function tryRestoreSession() {
    if (state.authed) return;
    const s = loadGeeSession();
    const clientId = GEE_OAUTH_CLIENT_ID || clientIn.get().trim();
    if (!s || !clientId || !window.ee) return;
    const project = s.project || projectIn.get().trim();
    const ee = window.ee;
    setAuth('', 'Reconnecting to Earth Engine…');
    ee.data.setAuthToken(clientId, 'Bearer', s.token, s.expiresInSec, null, () => {
      ee.initialize(null, null,
        () => setAuth('ok', `Connected · project ${project} (restored)`),
        () => { clearGeeSession(); setAuth('', 'Session expired — sign in again.'); }, null, project);
    }, false);
  }
  function syncMarker() { if (state.marker) state.marker.setLatLng([latIn.get(), lonIn.get()]); showCoord(); }
  function showCoord() { coordRO.set(`${(+latIn.get()).toFixed(4)}, ${(+lonIn.get()).toFixed(4)}`); }

  /* ── OAuth + Earth Engine init ──────────────────────────────────────── */

  function setAuth(kind, msg) {
    authStatus.textContent = msg;
    authStatus.className = `hint${kind === 'ok' ? ' is-ok' : ''}`;
    state.authed = kind === 'ok';
    collectBtn.disabled = !state.authed;
    updateHead();
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

  /* ── Collect ────────────────────────────────────────────────────────── */

  function getRegion(collection, point, scale) {
    return new Promise((resolve, reject) => {
      collection.getRegion(point, scale).getInfo((data, err) => (err ? reject(new Error(err)) : resolve(data)));
    });
  }

  async function collect() {
    if (!state.authed) { setStatus('Sign in to Earth Engine first.', 'error'); return; }
    const start = startIn.get(), end = endIn.get();
    if (!start || !end || end < start) { setStatus('Pick a valid start/end.', 'error'); return; }
    const ee = window.ee;
    const point = ee.Geometry.Point([lonIn.get(), latIn.get()]);
    const endExcl = addDaysISO(end, 1);   /* filterDate end is exclusive */
    try {
      setStatus('Requesting GRIDMET…');
      const gm = ee.ImageCollection('IDAHO_EPSCOR/GRIDMET').filterDate(start, endExcl).select(['pr', 'eto', 'rmin', 'vs']);
      const gmArr = await getRegion(gm, point, 4000);
      const weather = gridmetToWeather(regionArrayToRows(gmArr));
      if (!weather.length) throw new Error('No GRIDMET data for that point/period.');

      setStatus('Requesting MODIS vegetation index…');
      const modis = ee.ImageCollection('MODIS/061/MOD13Q1').merge(ee.ImageCollection('MODIS/061/MYD13Q1'))
        .filterDate(start, endExcl).select(['NDVI', 'EVI', 'SummaryQA']);
      const viArr = await getRegion(modis, point, 250);
      const vi = modisToVi(regionArrayToRows(viArr));

      state.weather = weather; state.vi = vi;
      renderResult();
      wb.setOutputsEnabled(true);
      wb.showTab('outputs');
      setStatus(`Done — ${fmtInt(weather.length)} days, ${fmtInt(vi.length)} clear VI observations.`, 'ok');
    } catch (e) { console.error(e); setStatus(`Failed: ${e.message}`, 'error'); }
  }

  function currentOpts() { return { index: indexSel.get(), soil: soilIn.get(), veg: vegIn.get(), interpolate: interpChk.get(), extrap: extrapSel.get() }; }

  function renderResult() {
    const { weather, vi } = state;
    const opts = currentOpts();
    const idx = opts.index;
    const { daily, obs, nObs } = kcbSeries(weather, vi, opts);
    const { csv } = assembleCsv(weather, vi, opts);
    state.result = { csv };
    downloadBtn.disabled = false;

    metrics.update([
      { label: 'Location', value: `${(+latIn.get()).toFixed(3)}, ${(+lonIn.get()).toFixed(3)}` },
      { label: 'Weather days', value: weather.length, unit: 'd' },
      { label: 'Clear VI obs', accent: true, value: nObs, unit: idx.toUpperCase() },
      { label: 'Kcb days', value: daily.filter(isFinite).length, unit: 'd', title: opts.interpolate ? 'Interpolated to daily' : 'On clear-observation days only' },
      { label: 'Range', value: weather.length ? `${fmtDate(weather[0].date)} → ${fmtDate(weather[weather.length - 1].date)}` : '—' },
    ]);
    dataWarn.innerHTML = '';
    if (!nObs) dataWarn.append(callout('warn', 'No clear vegetation-index observations in this period — kcb_obs is empty. Widen the period.'));

    renderCharts(weather, daily, obs, idx);
    preview.update(weather.map((w, i) => ({ ...w, kcb_obs: isFinite(daily[i]) ? daily[i] : '' })));
  }

  function renderCharts(weather, daily, obs, idx) {
    const dates = weather.map(w => w.date);
    const M = { l: 46, r: 12, t: 6, b: 26 };
    const line = (div, y, color, filename) => plot(div, [{ type: 'scatter', mode: 'lines', x: dates, y, line: { color, width: 1.5 } }], { showlegend: false, yaxis: { rangemode: 'tozero' }, margin: M }, filename);
    plot(cPrcp.div, [{ type: 'bar', x: dates, y: weather.map(w => w.prcp), marker: { color: VIZ.precip } }], { showlegend: false, yaxis: { rangemode: 'tozero' }, margin: M }, 'gee-prcp');
    line(cEto.div, weather.map(w => w.eto), VIZ.eto, 'gee-eto');
    line(cRmin.div, weather.map(w => w.rmin), VIZ.median, 'gee-rmin');
    line(cWspd.div, weather.map(w => w.wspd), VIZ.t, 'gee-wspd');
    const kt = [];
    if (daily.some(isFinite)) kt.push({ type: 'scatter', mode: 'lines', x: dates, y: daily.map(v => (isFinite(v) ? v : null)), line: { color: VIZ.kcb, width: 1.8 }, connectgaps: false, name: 'kcb_obs' });
    kt.push({ type: 'scatter', mode: 'markers', x: obs.map(o => o.date), y: obs.map(o => o.value), marker: { color: VIZ.kcb, size: 7, line: { color: VIZ.bg || '#0c0e12', width: 1 } }, name: `clear ${idx.toUpperCase()}` });
    plot(cKcb.div, kt, { yaxis: { title: { text: 'kcb_obs' }, range: [0, 1.05] }, margin: M }, 'gee-kcb');
  }

  function download() {
    if (!state.result) return;
    downloadText(`gee_${(+latIn.get()).toFixed(3)}_${(+lonIn.get()).toFixed(3)}_${startIn.get()}_${endIn.get()}.csv`.replace(/[^\w.\-]/g, '_'), state.result.csv, 'text/csv');
  }

  function setStatus(msg, kind = '') { runStatus.textContent = msg; runStatus.className = `runbar__status${kind ? ` is-${kind}` : ''}`; if (kind === 'ok') downloadBtn.disabled = false; }

  function updateHead() { wb.head.innerHTML = ''; wb.head.append(el('span', { class: 'hint' }, state.authed ? 'Earth Engine connected' : 'Sign in, pick a point, collect')); }

  updateHead();
  instanceOnShow = initMap;
  return root;
}

export default { title: 'GEE Data Collector', docs: DOCS, create, onShow() { if (instanceOnShow) instanceOnShow(); } };
