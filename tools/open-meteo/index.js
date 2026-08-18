/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/open-meteo/index.js — fetch model-ready daily weather for a point from
 * the free Open-Meteo archive API and download it as a CSV the other tools can
 * load. Open-Meteo returns FAO-56 reference ET directly, so the file already
 * has the required date / prcp / eto columns.
 *
 * This tool is deliberately self-contained (its own folder, some repeated
 * plumbing) so it can serve as the template for other data sources — a state
 * Mesonet, say — and be removed by deleting this folder and its home-page card
 * if the API ever changes or goes away.
 */

import { el } from '../../ui/dom.js';
import { group, ctrl, numInput, dateInput, btn, dataTable } from '../../ui/components.js';
import { createWorkbench } from '../../ui/workbench.js';
import { createInputCharts } from '../../ui/inputCharts.js';
import { downloadCsv } from '../../ui/download.js';
import { fmtInt } from '../../ui/format.js';
import { DOCS } from './docs.js';

/* Minimum seconds between requests — be a good citizen of a free API. Tunable;
   the wait is enforced via localStorage, so it also holds across reloads. */
const MIN_REQUEST_INTERVAL_SEC = 30;
const LS_LAST_FETCH = 'openmeteo.lastFetch';

/* Longest period per request. Open-Meteo suits a growing season, not decades,
   so we cap it (~9 months). Tunable. */
const MAX_PERIOD_DAYS = 285;

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
/* Exactly the daily variables the model uses: precipitation, FAO-56 reference
   ET (both required), plus mean wind and minimum relative humidity — which let
   the model apply its wind/humidity climate correction. */
const DAILY_VARS = [
  'precipitation_sum',
  'et0_fao_evapotranspiration',
  'wind_speed_10m_mean',
  'relative_humidity_2m_min',
];
const WIND_10M_TO_2M = 0.748;   // FAO-56 Eq. 47: 10 m wind → 2 m wind

/* Output columns, in the exact names the model tools expect. */
const CSV_COLS = [
  { key: 'date' }, { key: 'prcp', digits: 2 }, { key: 'eto', digits: 2 },
  { key: 'wspd', digits: 2 }, { key: 'rmin', digits: 0 },
];

function round(v, d) { return (v === null || v === undefined || !isFinite(v)) ? '' : +(+v).toFixed(d); }

/* Inclusive day count between two 'YYYY-MM-DD' strings (UTC, no timezone drift). */
function daysBetween(startIso, endIso) {
  const [y1, m1, d1] = startIso.split('-').map(Number);
  const [y2, m2, d2] = endIso.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1;
}

function create() {
  const wb = createWorkbench({ inputsLabel: 'Charts', outputsLabel: 'Table' });
  const state = { rows: null, lat: null, lon: null };

  /* ── Sidebar: location ──────────────────────────────────────────────── */
  const latIn = numInput({ min: -90, max: 90, step: 0.0001, placeholder: 'e.g. 39.08' });
  const lonIn = numInput({ min: -180, max: 180, step: 0.0001, placeholder: 'e.g. -96.55' });
  const geoBtn = btn('Use my location', { small: true, block: true, onClick: useLocation });
  const gLoc = group('Location', { open: true });
  gLoc.body.append(
    ctrl('Latitude', latIn.el, { unit: '°' }),
    ctrl('Longitude', lonIn.el, { unit: '°' }),
    el('div', { style: { marginTop: '0.4rem' } }, geoBtn),
  );

  /* ── Sidebar: period ────────────────────────────────────────────────── */
  const startIn = dateInput({ value: '2023-04-01' });
  const endIn = dateInput({ value: '2023-10-31' });
  const gPeriod = group('Period', { open: true });
  gPeriod.body.append(
    ctrl('Start', startIn.el), ctrl('End', endIn.el),
    el('div', { class: 'hint', style: { marginTop: '0.3rem' } },
      `Daily archive data (1940 to about five days ago), up to about ${Math.round(MAX_PERIOD_DAYS / 30.44)} months per request — Open-Meteo suits a growing season, not decades.`),
  );

  wb.sidebar.append(gLoc.el, gPeriod.el);

  /* ── Footer: fetch + download ───────────────────────────────────────── */
  const fetchBtn = btn('Fetch from Open-Meteo', { kind: 'primary', block: true, onClick: fetchData });
  const status = el('div', { class: 'runbar__status' });
  const dlBtn = btn('Download CSV', { small: true, kind: 'neon', onClick: download });
  dlBtn.disabled = true;
  wb.foot.append(el('div', { class: 'runbar' }, fetchBtn, status, el('div', { class: 'row' }, dlBtn)));

  /* ── Canvas ─────────────────────────────────────────────────────────── */
  const charts = createInputCharts();
  wb.inputs.append(charts.el);
  const table = dataTable(CSV_COLS.map(c => ({ ...c, label: c.key })));
  const tableNote = el('div', { class: 'hint', style: { marginBottom: '0.6rem' } });
  wb.outputs.append(tableNote, table.el);

  cooldownTick();   // resume any in-progress cooldown from a previous request

  function setStatus(msg, kind) { status.textContent = msg; status.className = `runbar__status${kind ? ' is-' + kind : ''}`; }

  function useLocation() {
    if (!navigator.geolocation) { setStatus('Geolocation is not available in this browser.', 'error'); return; }
    setStatus('Locating…');
    navigator.geolocation.getCurrentPosition(
      (p) => { latIn.set(+p.coords.latitude.toFixed(4)); lonIn.set(+p.coords.longitude.toFixed(4)); setStatus('Location set.', 'ok'); },
      () => setStatus('Could not get your location.', 'error'),
    );
  }

  /* Seconds remaining before another request is allowed (0 = ready). */
  function secsUntilAllowed() {
    let last = 0;
    try { last = +localStorage.getItem(LS_LAST_FETCH) || 0; } catch (e) { /* storage off */ }
    return Math.max(0, MIN_REQUEST_INTERVAL_SEC - Math.floor((Date.now() - last) / 1000));
  }
  function cooldownTick() {
    const s = secsUntilAllowed();
    if (s > 0) { fetchBtn.disabled = true; fetchBtn.textContent = `Wait ${s} s`; setTimeout(cooldownTick, 500); }
    else { fetchBtn.disabled = false; fetchBtn.textContent = 'Fetch from Open-Meteo'; }
  }

  async function fetchData() {
    const lat = latIn.get(), lon = lonIn.get(), start = startIn.get(), end = endIn.get();
    if (!isFinite(lat) || !isFinite(lon)) { setStatus('Enter a latitude and longitude.', 'error'); return; }
    if (!start || !end || end < start) { setStatus('Pick a valid start and end date.', 'error'); return; }
    if (daysBetween(start, end) > MAX_PERIOD_DAYS) {
      setStatus(`Keep the period to about ${Math.round(MAX_PERIOD_DAYS / 30.44)} months or less — Open-Meteo is best for a growing season, not decades.`, 'error');
      return;
    }
    if (secsUntilAllowed() > 0) { setStatus(`Please wait ${secsUntilAllowed()} s before the next request.`, 'error'); return; }

    try { localStorage.setItem(LS_LAST_FETCH, String(Date.now())); } catch (e) { /* storage off */ }
    cooldownTick();
    setStatus('Fetching from Open-Meteo…');
    const url = `${ARCHIVE_URL}?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}`
      + `&daily=${DAILY_VARS.join(',')}&wind_speed_unit=ms&timezone=UTC`;
    try {
      const res = await fetch(url);
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.reason || `HTTP ${res.status}`); }
      const j = await res.json();
      const rows = mapRows(j.daily);
      if (!rows.length) throw new Error('No data was returned for that location and period.');
      state.rows = rows; state.lat = lat; state.lon = lon;
      charts.render(rows);
      table.update(rows.slice(0, 366));
      tableNote.textContent = rows.length > 366 ? `Showing the first 366 of ${fmtInt(rows.length)} days (the download has all of them).` : '';
      dlBtn.disabled = false;
      wb.setOutputsEnabled(true);
      updateHead();
      wb.showTab('inputs');
      setStatus(`Fetched ${fmtInt(rows.length)} day(s). Ready to download.`, 'ok');
    } catch (e) {
      setStatus(`Failed: ${e.message}`, 'error');
    }
  }

  /* Open-Meteo returns parallel arrays under `daily`; map them to model rows.
     `ETo` (capital) is added so the preview charts pick it up; the CSV uses the
     lowercase `eto` the model expects. */
  function mapRows(d) {
    if (!d || !d.time) return [];
    return d.time.map((date, i) => {
      const eto = round(d.et0_fao_evapotranspiration?.[i], 2);
      const w = d.wind_speed_10m_mean?.[i];
      return {
        date,
        prcp: round(d.precipitation_sum?.[i], 2),
        eto, ETo: eto,
        wspd: round(w == null ? NaN : w * WIND_10M_TO_2M, 2),
        rmin: round(d.relative_humidity_2m_min?.[i], 0),
      };
    });
  }

  function updateHead() {
    wb.head.innerHTML = '';
    if (!state.rows) return;
    wb.head.append(
      el('span', {}, `${fmtInt(state.rows.length)} days`),
      el('span', { style: { color: 'var(--muted)' } }, `${state.rows[0].date} → ${state.rows[state.rows.length - 1].date}`),
      el('span', { style: { color: 'var(--muted)' } }, `${state.lat}°, ${state.lon}°`),
    );
  }

  function download() {
    if (!state.rows) return;
    downloadCsv(`openmeteo_${state.lat}_${state.lon}.csv`, CSV_COLS, state.rows);
  }

  return el('div', { class: 'view' }, wb.el);
}

export default {
  title: 'Open-Meteo Weather',
  docs: DOCS,
  create,
  onShow() { requestAnimationFrame(() => window.dispatchEvent(new Event('resize'))); },
};
