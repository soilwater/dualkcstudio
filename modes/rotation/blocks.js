/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * modes/rotation/blocks.js — pure rotation logic: the block model (crop /
 * fallow / alfalfa multi-cut), per-block daily series, cycle stitching into
 * engine-ready arrays, the preset rotation library, and the one-call engine
 * run with the Farahani et al. (1998) summary indices.
 *
 * No DOM imports. All parameter names are engine-shaped (Kcb_ini, L_dev,
 * Zr_max, p_tab, …).
 */

import { runModel, kcbFlat, rootDepthArray, toUtcTimestamp } from '../../core/index.js';
import { sliceWeatherWindow } from '../../core/weather.js';
import { CROPS, CROP_LIST, FALLOW_PRESET, ALFALFA_PRESET, ALFALFA_MAX_CUTS } from '../../core/cropSettings.js';

export { ALFALFA_MAX_CUTS };

export const MAX_ROTATION_DAYS = 3650;   /* one cycle, 10 years */
export const TERMINATION_RAMP_DAYS = 5;  /* Kcb → 0 ramp after termination */

let nextId = 1;
function uid() { return `b${nextId++}${Math.random().toString(36).slice(2, 7)}`; }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Standing root depth for fallow and just-planted crops: the evaporation
 * layer plus 0.20 m, so the root-zone book never collapses to a
 * zero-capacity layer.
 */
export function zrFloorFor(soil) {
  const Ze = soil && isFinite(soil.Ze) ? soil.Ze : 0.10;
  return Math.max(0.05, Ze + 0.20);
}

/* ── Block factories ───────────────────────────────────────────────────── */

/** Crop block seeded from a core preset; overrides win. */
export function makeCropBlock(presetId, overrides = {}) {
  const p = CROPS[presetId] || CROPS.custom;
  return {
    id: uid(), type: 'crop', presetId: CROPS[presetId] ? presetId : 'custom',
    name: p.label, color: p.color,
    Kcb_ini: p.Kcb_ini, Kcb_mid: p.Kcb_mid, Kcb_end: p.Kcb_end,
    L_ini: p.L_ini, L_dev: p.L_dev, L_mid: p.L_mid, L_late: p.L_late,
    Zr_max: p.Zr_max, h_max: p.h_max, p_tab: p.p_tab,
    residue_pct: 0, CN: p.CN,
    terminate: !!p.terminateDefault,
    termDay: p.termDayDefault !== undefined ? p.termDayDefault : (p.L_ini + p.L_dev + 10),
    residueDays: p.residueDaysDefault !== undefined ? p.residueDaysDefault : 20,
    ...overrides,
  };
}

/** Bare-soil (or weedy, via Kcb > 0) fallow block. */
export function makeFallowBlock(overrides = {}) {
  return {
    id: uid(), type: 'fallow', presetId: 'fallow',
    name: FALLOW_PRESET.label, color: FALLOW_PRESET.color,
    duration: FALLOW_PRESET.duration, Kcb: 0,
    p_tab: FALLOW_PRESET.p_tab, residue_pct: 0, CN: FALLOW_PRESET.CN,
    ...overrides,
  };
}

/** Perennial multi-cut alfalfa block (one cutting season + optional rest). */
export function makeAlfalfaBlock(overrides = {}) {
  return {
    id: uid(), type: 'alfalfa', presetId: 'alfalfa',
    name: ALFALFA_PRESET.label, color: ALFALFA_PRESET.color,
    Kcb_low: ALFALFA_PRESET.Kcb_low, Kcb_peak: ALFALFA_PRESET.Kcb_peak,
    iniDays: ALFALFA_PRESET.iniDays, intervalDays: ALFALFA_PRESET.intervalDays,
    numCuts: ALFALFA_PRESET.numCuts,
    Zr_max: ALFALFA_PRESET.Zr_max, h_max: ALFALFA_PRESET.h_max,
    p_tab: ALFALFA_PRESET.p_tab, residue_pct: 0, CN: ALFALFA_PRESET.CN,
    restDays: 0, restKcb: 0.2, establishment: true,
    ...overrides,
  };
}

/** Duplicate a block (fresh id) — used by settings import and reordering. */
export function cloneBlock(b) {
  return { ...b, id: uid() };
}

/* ── Per-block series ──────────────────────────────────────────────────── */

export function blockDuration(b) {
  if (b.type === 'fallow') return Math.max(1, Math.round(b.duration));
  if (b.type === 'alfalfa') return b.intervalDays * b.numCuts + (b.restDays || 0);
  if (b.terminate) return b.termDay + TERMINATION_RAMP_DAYS + b.residueDays;
  return b.L_ini + b.L_dev + b.L_mid + b.L_late;
}

/**
 * Per-day series for one block, day 0 = block start. Each entry:
 *   { kcb, zr, p, residue (0–1), cn, hMax, kcbFull }
 * kcbFull is the Kcb at which the canopy reaches hMax — required by the
 * engine's canopy-height derivation when Kcb is supplied as an array.
 */
export function blockSeries(b, { zrFloor = 0.30 } = {}) {
  const out = [];
  const residue = clamp((b.residue_pct || 0) / 100, 0, 1);
  const cn = isFinite(b.CN) ? clamp(b.CN, 30, 98) : 85;

  if (b.type === 'fallow') {
    const kcb = Math.max(b.Kcb || 0, 0);
    const p = isFinite(b.p_tab) ? b.p_tab : 0.5;
    const n = blockDuration(b);
    for (let d = 0; d < n; d++) {
      out.push({ kcb, zr: zrFloor, p, residue, cn, hMax: 0, kcbFull: 1 });
    }
    return out;
  }

  if (b.type === 'alfalfa') {
    /* Regrowth ramp within each cutting interval: flat lag after the cut,
       linear rise, short hold at the peak just before the next cut. Roots
       ramp only during the establishment year's first cycle; cutting never
       touches them afterwards. */
    const zrLow = Math.min(b.Zr_max, zrFloor);
    const holdDays = Math.min(3, Math.max(1, b.intervalDays - 2));
    const rampEndRaw = b.intervalDays - holdDays;
    const iniDays = Math.min(Math.max(0, b.iniDays || 0), Math.max(0, rampEndRaw - 1));
    const rampEnd = Math.max(iniDays + 1, rampEndRaw);
    for (let c = 0; c < b.numCuts; c++) {
      for (let d = 0; d < b.intervalDays; d++) {
        let kcb;
        if (d < iniDays) kcb = b.Kcb_low;
        else if (d < rampEnd) kcb = b.Kcb_low + ((d - iniDays) / Math.max(1, rampEnd - iniDays)) * (b.Kcb_peak - b.Kcb_low);
        else kcb = b.Kcb_peak;
        let zr;
        if (b.establishment && c === 0) {
          const f = clamp((kcb - b.Kcb_low) / Math.max(1e-6, b.Kcb_peak - b.Kcb_low), 0, 1);
          zr = zrLow + f * (b.Zr_max - zrLow);
        } else {
          zr = b.Zr_max;
        }
        out.push({ kcb, zr, p: b.p_tab, residue, cn, hMax: b.h_max, kcbFull: b.Kcb_peak });
      }
    }
    /* Optional rest after the last cut: still a living stand at a low but
       non-zero Kcb, roots held at Zr_max — not bare fallow. */
    const restKcb = b.restKcb !== undefined ? b.restKcb : 0.2;
    for (let d = 0; d < (b.restDays || 0); d++) {
      out.push({ kcb: restKcb, zr: b.Zr_max, p: b.p_tab, residue, cn, hMax: b.h_max, kcbFull: b.Kcb_peak });
    }
    return out;
  }

  /* Standard annual crop, optionally terminated early (cover crops):
     Kcb ramps from its value at termDay to 0 over TERMINATION_RAMP_DAYS,
     then residueDays of bare residue-covered soil; roots hold at the depth
     reached on the termination day. */
  const n = blockDuration(b);
  const cropDef = { ...b, Zr_ini: Math.min(zrFloor, b.Zr_max) };
  const zrArr = rootDepthArray(n, cropDef);
  const term = b.terminate ? Math.max(0, Math.round(b.termDay)) : Infinity;
  const kcbAtTerm = b.terminate ? kcbFlat(Math.min(term, n), b) : 0;
  const zrAtTerm = b.terminate ? zrArr[Math.min(term, n - 1)] : 0;
  for (let d = 0; d < n; d++) {
    let kcb, zr;
    if (d >= term) {
      const f = Math.min((d - term + 1) / TERMINATION_RAMP_DAYS, 1);
      kcb = kcbAtTerm * (1 - f);
      zr = zrAtTerm;
    } else {
      kcb = kcbFlat(d, b);
      zr = zrArr[d];
    }
    out.push({ kcb, zr, p: b.p_tab, residue, cn, hMax: b.h_max, kcbFull: b.Kcb_mid });
  }
  return out;
}

/* ── Rotation assembly ─────────────────────────────────────────────────── */

export function cycleDays(blocks) {
  return blocks.reduce((s, b) => s + blockDuration(b), 0);
}

/**
 * Stitches every block × cycle into engine-ready per-day arrays plus block
 * boundary metadata for the timeline/wheel and the daily table.
 */
export function buildRotation(blocks, numCycles, { zrFloor = 0.30 } = {}) {
  const Kcb = [], Zr = [], p_tab = [], h_max = [], Kcb_full = [];
  const residue_cover = [], curve_number = [];
  const dayBlock = [], dayType = [];
  const blocksMeta = [];
  let day = 0;
  for (let c = 0; c < numCycles; c++) {
    for (const b of blocks) {
      const s = blockSeries(b, { zrFloor });
      blocksMeta.push({
        id: b.id, name: b.name, color: b.color, type: b.type,
        cycle: c + 1, startDay: day, endDay: day + s.length - 1,
      });
      for (const x of s) {
        Kcb.push(x.kcb); Zr.push(x.zr); p_tab.push(x.p);
        h_max.push(x.hMax); Kcb_full.push(x.kcbFull);
        residue_cover.push(x.residue); curve_number.push(x.cn);
        dayBlock.push(b.name); dayType.push(b.type);
        day++;
      }
    }
  }
  return {
    Kcb, Zr, p_tab, h_max, Kcb_full, residue_cover, curve_number,
    dayBlock, dayType, blocksMeta, totalDays: day,
  };
}

/* ── Summary indices (Farahani et al. 1998; PPUE, E/P) ─────────────────── */

/**
 * SPSI = 1 − Ef/Pf (fraction of fallow-period rain not lost to fallow ET),
 * SPUI = 1 − Ef/Ps (fraction of ALL rain not lost to fallow ET),
 * PPUE = T/P (fraction of rain converted to transpiration), E/P.
 * Ef is fallow-period ETc (no crop → all evaporation); Pf fallow precip;
 * Ps total precip. Computed from the paper's Eq. 1/2 directly, not a
 * storage-delta proxy.
 */
export function computeSummary(rows) {
  let P = 0, Pf = 0, Ef = 0, T = 0, E = 0, ETc = 0, ETo = 0, RO = 0, DP = 0, stress = 0;
  for (const r of rows) {
    P += r.prcp; T += r.T; E += r.E; ETc += r.ETc; ETo += r.ETo;
    RO += r.runoff; DP += r.deep_percolation;
    if (r.block_type === 'fallow') { Pf += r.prcp; Ef += r.ETc; }
    if (r.Kcb > 0 && r.Ks < 1 - 1e-9) stress++;
  }
  return {
    days: rows.length,
    precipitation: P, eto: ETo, etc: ETc,
    transpiration: T, evaporation: E,
    runoff: RO, deep_percolation: DP,
    stress_days: stress, fallow_precip: Pf, fallow_et: Ef,
    SPSI: Pf > 0 ? 1 - Ef / Pf : null,
    SPUI: P > 0 ? 1 - Ef / P : null,
    PPUE: P > 0 ? T / P : null,
    E_over_P: P > 0 ? E / P : null,
  };
}

/* ── The run ───────────────────────────────────────────────────────────── */

/**
 * Slices the weather window and makes ONE runModel call for the whole
 * rotation (rainfed by design). Truncates gracefully when the record ends
 * before the requested cycles do.
 *
 * @returns {{rows, balance, warnings, options, blocksMeta, summary, days, truncated}}
 */
export function runRotation({ weatherDf, startDate, blocks, numCycles = 1, soil, options }) {
  if (!blocks || !blocks.length) throw new Error('Add at least one component to the rotation.');
  if (!weatherDf || !weatherDf.length) throw new Error('Load weather data first.');
  if (!startDate) throw new Error('Pick a start date.');
  const perCycle = cycleDays(blocks);
  if (!(perCycle > 0)) throw new Error('The rotation cycle has zero length.');
  if (perCycle > MAX_ROTATION_DAYS) {
    throw new Error(`One rotation cycle is ${perCycle} days — the limit is ${MAX_ROTATION_DAYS} (10 years).`);
  }

  const zrFloor = zrFloorFor(soil);
  const built = buildRotation(blocks, Math.max(1, Math.round(numCycles)), { zrFloor });

  const lastDate = weatherDf[weatherDf.length - 1].date;
  const avail = Math.floor((toUtcTimestamp(lastDate) - toUtcTimestamp(startDate)) / 86400000) + 1;
  if (avail < 1) throw new Error('The start date is beyond the end of the weather record.');
  const N = Math.min(built.totalDays, avail);
  const windowDf = sliceWeatherWindow(weatherDf, startDate, N);

  const crop = {
    Kcb: built.Kcb.slice(0, N),
    Zr: built.Zr.slice(0, N),
    p_tab: built.p_tab.slice(0, N),
    h_max: built.h_max.slice(0, N),
    Kcb_full: built.Kcb_full.slice(0, N),
  };
  const management = {
    irrigation_mode: 'rainfed',
    residue_cover: built.residue_cover.slice(0, N),
    curve_number: built.curve_number.slice(0, N),
  };

  const result = runModel(soil, crop, management, windowDf, options);
  result.df.forEach((r, i) => {
    r.day = i + 1;
    r.block = built.dayBlock[i];
    r.block_type = built.dayType[i];
  });

  const blocksMeta = built.blocksMeta
    .filter(m => m.startDay < N)
    .map(m => ({ ...m, endDay: Math.min(m.endDay, N - 1) }));

  return {
    rows: result.df,
    balance: result.balance,
    warnings: result.warnings,
    options: result.options,
    blocksMeta,
    summary: computeSummary(result.df),
    days: N,
    truncated: N < built.totalDays,
  };
}

/* ── "Add component…" catalogue ────────────────────────────────────────── */

/* Winter/summer is a UI grouping only — cropSettings doesn't tag it. */
const COVER_CROP_SEASON = {
  rye: 'winter', clover: 'winter', covermix: 'winter', oats: 'winter', radish: 'winter',
  buckwheat: 'summer', sorghumSudan: 'summer', cowpea: 'summer',
};

export const ADDABLE_COMPONENTS = [
  ...CROP_LIST.filter(c => c.group === 'Cash crops').map(c => ({ id: c.id, label: c.label, group: 'Cash crops', kind: 'crop' })),
  { id: 'custom', label: CROPS.custom.label, group: 'Cash crops', kind: 'crop' },
  ...CROP_LIST.filter(c => c.group === 'Cover crops' && COVER_CROP_SEASON[c.id] === 'winter').map(c => ({ id: c.id, label: c.label, group: 'Winter cover crops', kind: 'crop' })),
  ...CROP_LIST.filter(c => c.group === 'Cover crops' && COVER_CROP_SEASON[c.id] === 'summer').map(c => ({ id: c.id, label: c.label, group: 'Summer cover crops', kind: 'crop' })),
  { id: 'alfalfa', label: ALFALFA_PRESET.label, group: 'Forages', kind: 'alfalfa' },
  { id: 'fallow', label: FALLOW_PRESET.label, group: 'Fallow', kind: 'fallow' },
];

/** Build a block from an ADDABLE_COMPONENTS entry. */
export function makeComponent(id) {
  const entry = ADDABLE_COMPONENTS.find(a => a.id === id);
  if (!entry) return null;
  if (entry.kind === 'fallow') return makeFallowBlock();
  if (entry.kind === 'alfalfa') return makeAlfalfaBlock();
  return makeCropBlock(id);
}

/* ── Preset rotations ──────────────────────────────────────────────────── */

/* Winter wheat as a full fall-to-summer season: slow dormant winter folded
   into a long development stage. 250 days, Sept → June. */
const WW_STAGES = { L_ini: 40, L_dev: 90, L_mid: 90, L_late: 30 };

export const PRESET_ROTATIONS = [
  {
    id: 'cornsoy', label: 'Corn – Soybean', years: 2, region: 'US Midwest, rainfed or irrigated',
    desc: 'The most common US row-crop rotation — alternating a grass and a legume breaks pest and disease cycles.',
    cycle: () => [
      makeCropBlock('maize'),
      makeFallowBlock({ name: 'Winter fallow', duration: 240 }),
      makeCropBlock('soybean'),
      makeFallowBlock({ name: 'Winter fallow', duration: 235 }),
    ],
  },
  {
    id: 'wsf', label: 'Winter Wheat – Sorghum – Fallow (WSF)', years: 3, region: 'Western Kansas / dryland Great Plains',
    desc: 'Classic 3-year dryland rotation — long fallow periods rebuild soil water between two crops.',
    cycle: () => [
      makeCropBlock('wheat', WW_STAGES),
      makeFallowBlock({ name: 'Summer fallow', duration: 335 }),
      makeCropBlock('sorghum'),
      makeFallowBlock({ name: 'Fallow', duration: 390 }),
    ],
  },
  {
    id: 'wcf', label: 'Winter Wheat – Corn – Fallow (WCF)', years: 3, region: 'Central/western Kansas, better water-holding soils',
    desc: 'Higher water-use alternative to WSF where soils can support corn.',
    cycle: () => [
      makeCropBlock('wheat', WW_STAGES),
      makeFallowBlock({ name: 'Summer fallow', duration: 335 }),
      makeCropBlock('maize'),
      makeFallowBlock({ name: 'Fallow', duration: 385 }),
    ],
  },
  {
    id: 'contwheat', label: 'Continuous Winter Wheat', years: 1, region: 'Dryland, higher-rainfall areas',
    desc: 'Wheat every year with only a short summer fallow between harvest and the next planting.',
    cycle: () => [
      makeCropBlock('wheat', WW_STAGES),
      makeFallowBlock({ name: 'Short summer fallow', duration: 115 }),
    ],
  },
  {
    id: 'wf', label: 'Wheat – Fallow (WF)', years: 2, region: 'Semi-arid western Kansas / High Plains',
    desc: 'The traditional low-input dryland rotation — one wheat crop every two years, with a long fallow to store water.',
    cycle: () => [
      makeCropBlock('wheat', WW_STAGES),
      makeFallowBlock({ name: 'Long fallow', duration: 480 }),
    ],
  },
  {
    id: 'csw_cover', label: 'Corn – Soybean – Wheat + Cover Crop', years: 3, region: 'Conservation rotation, diversified row-crop systems',
    desc: 'Adds a small grain and a terminated cover crop to a corn-soy base for more residue and diversity.',
    cycle: () => [
      makeCropBlock('maize'),
      makeFallowBlock({ name: 'Winter fallow', duration: 115 }),
      makeCropBlock('soybean'),
      makeFallowBlock({ name: 'Short fallow', duration: 30 }),
      makeCropBlock('wheat', WW_STAGES),
      makeCropBlock('rye'),
      makeFallowBlock({ name: 'Fallow before corn', duration: 330 }),
    ],
  },
  {
    id: 'contcorn', label: 'Continuous Corn', years: 1, region: 'High-input irrigated systems',
    desc: 'Corn every year — simple, but with higher disease/pest pressure than a rotation.',
    cycle: () => [
      makeCropBlock('maize'),
      makeFallowBlock({ name: 'Winter fallow', duration: 240 }),
    ],
  },
  {
    id: 'alfalfacorn', label: 'Alfalfa (4 yr) – Corn (1 yr)', years: 5, region: 'Forage / livestock systems',
    desc: 'A multi-cut alfalfa stand for four years, rotated to corn for one year to break the stand and manage pests.',
    cycle: () => [
      makeAlfalfaBlock({ name: 'Alfalfa yr 1', establishment: true, restDays: 215, restKcb: 0.2 }),
      makeAlfalfaBlock({ name: 'Alfalfa yr 2', establishment: false, restDays: 215, restKcb: 0.2 }),
      makeAlfalfaBlock({ name: 'Alfalfa yr 3', establishment: false, restDays: 215, restKcb: 0.2 }),
      makeAlfalfaBlock({ name: 'Alfalfa yr 4', establishment: false, restDays: 215, restKcb: 0.2 }),
      makeCropBlock('maize'),
      makeFallowBlock({ name: 'Winter fallow', duration: 240 }),
    ],
  },
];
