/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/eto-calculator/index.js — a small utility mode: upload a weather
 * CSV, compute reference ET (ETo) by whichever method the available
 * variables support, see it plotted, and download the original file with a
 * single `eto` column appended (to feed the other tools, which expect ETo).
 *
 * Deliberately standalone from the shared weather panel: that panel requires
 * the full 8-column schema and computes Penman-Monteith itself, whereas this
 * tool must accept partial files (e.g. temperature only) and offer several
 * methods. It reuses the pure logic in methods.js (which in turn reuses the
 * tested core ETo + gap-filling).
 */

import { el, clear } from '../../ui/dom.js';
import { fmt, fmtInt, fmtDate, mean } from '../../ui/format.js';
import { group, btn, ctrl, numInput, selectInput, readout, dropzone, callout, metricsBar, subhead } from '../../ui/components.js';
import { downloadText } from '../../ui/download.js';
import { createWorkbench } from '../../ui/workbench.js';
import { chartCard, plot, VIZ } from '../../ui/plotly.js';
import { checkColumns, showColumnModal } from '../../ui/weatherSchema.js';
import { parseLooseCsv, detectColumns, METHODS, METHOD_BY_ID, methodStatus, computeEto } from './methods.js';
import { DOCS } from './docs.js';

/* This tool only strictly needs a date column; the weather variables are
   optional (they decide which methods are available). */
const ETO_REQUIRED = ['date'];

const EXAMPLE = { url: 'kansas_north_west.csv', label: 'Load example (NW Kansas)', elev: 960 };

/* Human labels for the detected-variable checklist (Inputs tab). */
const VAR_ROWS = [
  { key: 'tmin', label: 'Min temperature (tmin)' },
  { key: 'tmax', label: 'Max temperature (tmax)' },
  { key: 'humidity', label: 'Humidity — RH (rmin/rmax) or VPD' },
  { key: 'srad', label: 'Solar radiation (srad)' },
  { key: 'wspd', label: 'Wind speed (wspd)' },
  { key: 'rn', label: 'Net radiation (rn) — optional' },
  { key: 'prcp', label: 'Precipitation (prcp) — carried through' },
];

function create() {
  const state = { parsed: null, cols: null, fileName: null, result: null };
  const wb = createWorkbench();

  /* ── Sidebar: file ──────────────────────────────────────────────────── */

  const statusEl = el('div', {});
  const roFile = readout('File');
  const roRecords = readout('Records');
  const roRange = readout('Range');
  const summaryBlock = el('div', { hidden: true, style: { marginTop: '0.55rem' } }, roFile.el, roRecords.el, roRange.el);

  const zone = dropzone({ title: 'Drop weather CSV', sub: 'See Docs for the columns each method needs', onFile: (f) => f.text().then(t => loadCsv(t, f.name)).catch(e => showError(e.message)) });
  const exampleBtn = btn(EXAMPLE.label, { kind: 'neon', small: true, block: true, onClick: async () => {
    try { exampleBtn.disabled = true; const res = await fetch(EXAMPLE.url); if (!res.ok) throw new Error(`Could not fetch example (HTTP ${res.status}).`); loadCsv(await res.text(), EXAMPLE.url, { elev: EXAMPLE.elev }); }
    catch (e) { showError(e.message); } finally { exampleBtn.disabled = false; }
  } });

  const gFile = group('Weather file', { open: true });
  gFile.body.append(zone, el('div', { style: { marginTop: '0.4rem' } }, exampleBtn), statusEl, summaryBlock);

  /* ── Sidebar: site ──────────────────────────────────────────────────── */

  const latIn = numInput({ min: -90, max: 90, step: 0.0001, placeholder: 'e.g. 39', onChange: sync });
  const elevIn = numInput({ min: -430, max: 6000, step: 1, placeholder: 'e.g. 960', onChange: sync });
  const gSite = group('Site', { open: true });
  gSite.body.append(
    ctrl('Latitude', latIn.el, { unit: '°' }),
    ctrl('Elevation', elevIn.el, { unit: 'm' }),
    el('div', { class: 'hint', style: { marginTop: '0.2rem' } }, 'Latitude (north positive, south negative) drives solar geometry (Penman-Monteith, Hargreaves, Priestley-Taylor); elevation sets air pressure. Not every method needs both. Both auto-fill from latitude/elevation columns if present.'),
  );

  /* ── Sidebar: method ────────────────────────────────────────────────── */

  const methodSel = selectInput({ options: METHODS.map(m => ({ value: m.id, label: m.label })), value: 'pm', onChange: sync });
  const methodHint = el('div', { class: 'ctrl__help' });
  const gMethod = group('Method', { open: true });
  gMethod.body.append(
    ctrl('ETo method', methodSel.el),
    methodHint,
    el('div', { class: 'hint', style: { marginTop: '0.5rem' } },
      'Gaps are filled before computing: precipitation → 0, wind → 2 m/s, everything else → PCHIP interpolation (no extrapolation past the first/last real value).'),
  );

  wb.sidebar.append(gFile.el, gSite.el, gMethod.el);

  /* ── Run bar ────────────────────────────────────────────────────────── */

  const runBtn = btn('Compute ETo', { kind: 'primary', block: true, onClick: compute });
  const runStatus = el('div', { class: 'runbar__status' });
  const downloadBtn = btn('Download CSV', { small: true, kind: 'neon', onClick: download });
  downloadBtn.disabled = true;
  wb.foot.append(el('div', { class: 'runbar' }, runBtn, runStatus, el('div', { class: 'row' }, downloadBtn)));

  /* ── Canvas: Inputs (detected variables + method availability) ───────── */

  const inputsEmpty = el('div', { class: 'empty' }, el('h3', {}, 'No file loaded'), el('p', {}, 'Drop a weather CSV in the sidebar, or load the NW Kansas example. Detected variables and the methods they support will appear here.'));
  const detectedBox = el('div', { hidden: true });
  wb.inputs.append(inputsEmpty, detectedBox);

  /* ── Canvas: Outputs (chart + stats) ────────────────────────────────── */

  const metrics = metricsBar([]);
  const chart = chartCard('Reference ET (ETo)', { subtitle: 'computed daily series', wide: true, height: 360 });
  const warnBox = el('div', {});
  wb.outputs.append(el('div', { class: 'stack' }, metrics.el, warnBox, el('div', { class: 'chart-grid' }, chart.card)));

  const root = el('div', { class: 'view' }, wb.el);

  /* ── Behaviour ──────────────────────────────────────────────────────── */

  function showError(msg) { statusEl.innerHTML = ''; statusEl.append(el('div', { style: { marginTop: '0.4rem' } }, callout('error', msg))); }

  function loadCsv(text, name, { elev } = {}) {
    /* Same standard-name enforcement as every other tool (only `date` is
       required here); a misnamed weather column would otherwise silently
       make its methods unavailable. */
    const check = checkColumns(text, ETO_REQUIRED);
    if (!check.ok) { showColumnModal(check, ETO_REQUIRED); if (check.missing.length) return; }
    let parsed;
    try { parsed = parseLooseCsv(text); } catch (e) { showError(e.message); return; }
    state.parsed = parsed; state.fileName = name; state.result = null;
    state.cols = detectColumns(parsed);
    statusEl.innerHTML = '';

    /* Autofill site from columns when present (mean of the record). */
    const finiteMean = (k) => { const v = parsed.rows.map(r => r[k]).filter(isFinite); return v.length ? mean(v) : NaN; };
    if (parsed.keys.includes('latitude') && !isFinite(latIn.get())) { const m = finiteMean('latitude'); if (isFinite(m)) latIn.set(+m.toFixed(4)); }
    if (parsed.keys.includes('elevation') && !isFinite(elevIn.get())) { const m = finiteMean('elevation'); if (isFinite(m)) elevIn.set(Math.round(m)); }
    if (elev !== undefined && !isFinite(elevIn.get())) elevIn.set(elev);

    /* Default to the best method the data actually supports. */
    const firstAvail = METHODS.find(m => methodStatus(m, state.cols, location()).available);
    if (firstAvail) methodSel.set(firstAvail.id);

    renderSummary();
    downloadBtn.disabled = true;
    wb.setOutputsEnabled(false);
    sync();
  }

  function renderSummary() {
    const p = state.parsed;
    summaryBlock.hidden = false;
    roFile.set(state.fileName);
    roRecords.set(fmtInt(p.rows.length), 'days');
    roRange.set(`${fmtDate(p.rows[0].date)} → ${fmtDate(p.rows[p.rows.length - 1].date)}`);
    inputsEmpty.hidden = true;
    detectedBox.hidden = false;
  }

  function location() { return { lat: latIn.get(), elev: elevIn.get() }; }

  function renderDetected() {
    if (!state.cols) return;
    clear(detectedBox);
    const check = (ok) => el('span', { class: `tag ${ok ? 'tag--ok' : 'tag--off'}` }, ok ? '✓' : '—');
    detectedBox.append(
      subhead('Detected variables'),
      el('div', { class: 'varlist' }, VAR_ROWS.map(v => el('div', { class: 'varlist__row' }, check(!!state.cols[v.key]), el('span', {}, v.label)))),
      subhead('Methods'),
      el('div', { class: 'methodlist' }, METHODS.map(m => {
        const st = methodStatus(m, state.cols, location());
        const bits = [];
        if (st.missingData.length) bits.push(`needs ${st.missingData.join(', ')}`);
        else if (st.missingSite.length) bits.push(`enter site ${st.missingSite.join(' & ')}`);
        return el('div', { class: `methodlist__row${st.ready ? ' is-ready' : ''}` },
          el('div', { class: 'row', style: { gap: '0.5rem' } }, check(st.ready), el('strong', {}, m.label)),
          el('div', { class: 'hint' }, st.ready ? m.blurb : (bits.join(' · ') || m.blurb)),
        );
      })),
    );
  }

  function sync() {
    const m = METHOD_BY_ID[methodSel.get()];
    if (!state.parsed) { methodHint.textContent = m ? m.blurb : ''; updateHead(); return; }
    const st = methodStatus(m, state.cols, location());
    if (st.ready) { methodHint.textContent = m.blurb; methodHint.classList.remove('is-warn'); }
    else {
      const bits = [];
      if (st.missingData.length) bits.push(`missing data: ${st.missingData.join(', ')}`);
      if (st.missingSite.length) bits.push(`enter site ${st.missingSite.join(' & ')}`);
      methodHint.textContent = bits.join(' · ');
      methodHint.classList.add('is-warn');
    }
    runBtn.disabled = !st.ready;
    gFile.setHint(`${fmtInt(state.parsed.rows.length)} d`, true);
    renderDetected();
    updateHead();
  }

  function updateHead() {
    wb.head.innerHTML = '';
    if (!state.parsed) { wb.head.append(el('span', { class: 'hint' }, 'No file loaded')); return; }
    const p = state.parsed;
    wb.head.append(
      el('span', {}, `${fmtInt(p.rows.length)} days`),
      el('span', { style: { color: 'var(--muted)' } }, `${fmtDate(p.rows[0].date)} → ${fmtDate(p.rows[p.rows.length - 1].date)}`),
      el('span', { style: { color: 'var(--muted)' } }, METHOD_BY_ID[methodSel.get()].label),
    );
  }

  function setStatus(msg, kind = '') { runStatus.textContent = msg; runStatus.className = `runbar__status${kind ? ` is-${kind}` : ''}`; }

  function compute() {
    try {
      if (!state.parsed) throw new Error('Load a CSV first.');
      const m = METHOD_BY_ID[methodSel.get()];
      const st = methodStatus(m, state.cols, location());
      if (!st.ready) throw new Error(st.missingData.length ? `This method needs ${st.missingData.join(', ')}.` : `Enter site ${st.missingSite.join(' & ')}.`);
      setStatus('Computing…');
      const t0 = performance.now();
      const { values, warnings, validDays } = computeEto(state.parsed, m.id, location());
      state.result = { methodId: m.id, methodLabel: m.label, values, warnings, validDays };
      renderResults();
      downloadBtn.disabled = false;
      wb.setOutputsEnabled(true);
      wb.showTab('outputs');
      setStatus(`Done in ${Math.round(performance.now() - t0)} ms — ${fmtInt(validDays)} day(s).`, 'ok');
    } catch (e) { console.error(e); setStatus(e.message, 'error'); }
  }

  function renderResults() {
    const { values, warnings, validDays, methodLabel } = state.result;
    const valid = values.filter(isFinite);
    const total = valid.reduce((s, x) => s + x, 0);
    metrics.update([
      { label: 'Method', value: methodLabel },
      { label: 'Mean ETo', accent: true, value: fmt(mean(valid), 2), unit: 'mm/day' },
      { label: 'Min', value: fmt(Math.min(...valid), 2), unit: 'mm/day' },
      { label: 'Max', value: fmt(Math.max(...valid), 2), unit: 'mm/day' },
      { label: 'Annual mean', value: fmtInt(total / valid.length * 365.25), unit: 'mm/yr', title: 'Mean daily ETo × 365.25' },
      { label: 'Days computed', value: fmtInt(validDays), unit: `of ${fmtInt(values.length)}` },
    ]);

    warnBox.innerHTML = '';
    const w = [...warnings];
    const gaps = values.length - validDays;
    if (gaps > 0) w.push(`${fmtInt(gaps)} day(s) left without ETo — inputs were missing at the record's edge (no extrapolation).`);
    if (w.length) warnBox.append(callout('warn', w));

    const dates = state.parsed.rows.map(r => r.date);
    plot(chart.div, [{
      type: 'scatter', mode: 'lines', x: dates, y: values.map(v => (isFinite(v) ? v : null)),
      line: { color: VIZ.eto, width: 1.2 }, name: 'ETo', connectgaps: false,
      hovertemplate: '%{x}<br>ETo %{y:.2f} mm/day<extra></extra>',
    }], { showlegend: false, yaxis: { title: { text: 'ETo, mm/day' }, rangemode: 'tozero' }, margin: { l: 48, r: 16, t: 6, b: 28 } }, 'eto');
    chart.card.querySelector('.chart-card__sub').textContent = `${methodLabel} · mm/day`;
  }

  function download() {
    if (!state.result) return;
    const { headers, rawRows } = state.parsed;
    const vals = state.result.values;
    /* Replace an existing eto column rather than appending a duplicate. */
    const etoCol = headers.findIndex(h => h.trim().toLowerCase() === 'eto');
    const head = (etoCol >= 0 ? headers : [...headers, 'eto']).join(',');
    const lines = rawRows.map((cells, i) => {
      const v = isFinite(vals[i]) ? vals[i] : '';
      const out = etoCol >= 0 ? cells.slice() : [...cells, v];
      if (etoCol >= 0) out[etoCol] = v;
      return out.join(',');
    });
    const base = (state.fileName || 'weather').replace(/\.csv$/i, '');
    downloadText(`${base}_eto.csv`, [head, ...lines].join('\n'), 'text/csv');
  }

  sync();
  return root;
}

export default { title: 'ETo Calculator', docs: DOCS, create };
