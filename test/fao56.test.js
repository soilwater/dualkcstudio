/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * fao56.test.js — Regression tests that pin the model to FAO-56's own
 * published worked examples, digit for digit.
 *
 * Allen, R.G., Pereira, L.S., Raes, D., Smith, M. (1998). Crop
 * evapotranspiration. FAO Irrigation and Drainage Paper 56.
 *
 * The point of these is not coverage but FIDELITY: each assertion is a
 * number the manual prints, so an edit that silently drifts away from
 * FAO-56 fails here rather than in the field. The examples used:
 *
 *   Example 18 (Ch. 4) — daily ETo by Penman-Monteith, Brussels.
 *   Example 35 (Ch. 7) — soil evaporation coefficient Ke, sandy loam.
 *
 * Run with:  node --test
 *
 * Nothing here needs a build step, a browser, or any dependency beyond
 * Node's own test runner — the same no-build stance as the rest of the app.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { penmanMonteithDaily, runModel, kcMax } from '../core/index.js';

// The manual rounds its worked examples to 2-3 significant figures, so an
// exact float equality would fail on rounding alone. `close` asserts we land
// within `tol` of the printed value — tight enough that a real regression
// (a dropped term, a wrong coefficient) still trips it.
function close(actual, expected, tol, msg) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg}: expected ${expected} +/- ${tol}, got ${actual}`
  );
}

// ── Example 18 — ETo with daily data (FAO-56 Ch. 4, pp. 72-73) ──────────────
//
// Brussels, 50.80 deg N, elevation 100 m, day of year 187. The manual derives
// Rs = 22.07 MJ m-2 d-1 from sunshine hours and converts the 10 m wind to
// u2 = 2.078 m/s (Eq. 47). penmanMonteithDaily takes Rs (srad) and 2 m wind
// directly — as the app's data contract requires — so we feed those derived
// values and check the full chain reproduces the manual's ETo.
//
// Printed intermediates we implicitly reproduce: P = 100.1 kPa, gamma =
// 0.0666, delta = 0.122, es = 1.997, ea = 1.409, Ra = 41.09, Rso = 30.90,
// Rns = 17.00, Rnl = 3.71, Rn = 13.28. Final: ETo = 3.9 mm/day (3.88).
test('Example 18: daily Penman-Monteith ETo (Brussels) = 3.9 mm/day', () => {
  const eto = penmanMonteithDaily(
    50.80,  // lat
    100,    // elevation, m
    187,    // day of year
    12.3,   // tmin, degC
    21.5,   // tmax, degC
    63,     // RHmin, %
    84,     // RHmax, %
    22.07,  // Rs (srad), MJ m-2 d-1  (manual's derived value)
    2.078   // u2, m/s                (manual's 2 m converted value)
  );
  // The manual computes 3.88 before its final rounding to 3.9.
  close(eto, 3.88, 0.01, 'ETo (mm/day)');
  close(eto, 3.9, 0.05, 'ETo vs. manual rounded value');
});

// ── Example 35 — soil evaporation coefficient Ke (FAO-56 Ch. 7) ─────────────
//
// Sandy loam: theta_FC = 0.23, theta_WP = 0.10, Ze = 0.10 m, so
//   TEW = 1000 (0.23 - 0.5*0.10) 0.10 = 18 mm   (Eq. 73)
// Day-1 conditions: Kcb = 0.30, h = 0.30 m, u2 = 1.6 m/s, RHmin = 35 %,
// fw = 0.8, exposed fraction 1 - fc = 0.92, surface freshly wetted so the
// evaporation reduction coefficient Kr = 1 (stage 1). The manual reports:
//   Kc max = 1.21   (Eq. 72)
//   few    = 0.80   (Eq. 75, = min(1 - fc, fw))
//   Ke     = 0.91   (Eq. 71, = min[Kr (Kc max - Kcb), few Kc max])
//   E      = 4.1 mm (Ke * ETo, with ETo = 4.5 mm/day that day)

// Kc max is a pure function of the day's climate and canopy — test it alone
// first, so a failure points straight at Eq. 72 rather than the water balance.
test('Example 35: Kc max (Eq. 72) = 1.21', () => {
  const kcMaxVal = kcMax(0.30, { u2: 1.6, rhmin: 35, h: 0.30 });
  close(kcMaxVal, 1.21, 0.005, 'Kc max');
});

// Then drive the same day through the full engine and check TEW, Kc max, few,
// Ke and E fall out of the water balance as the manual prints them. The run is
// engineered to reproduce the example's day-1 state: soil.ini = soil.fc leaves
// the surface undepleted (De = 0 <= REW, so Kr = 1), and a wetting event with
// management.fw = 0.8 sets the wetted fraction. crop.fc is supplied directly
// as the example's 1 - fc = 0.92 (fc = 0.08) rather than derived from Eq. 76,
// because the example specifies it.
test('Example 35: engine reproduces TEW=18, few=0.80, Ke=0.91, E=4.1 mm', () => {
  const soil = {
    fc: 0.23, wp: 0.10, ini: 0.23, // ini = fc: surface starts undepleted
    Ze: 0.10, REW_frac: 8 / 18,    // Table 19 REW ~ 8 mm on TEW = 18 mm
    Zr_profile: 1.0,
  };
  const crop = {
    Kcb: [0.30],   // array path: a single fixed day, no tabulated stages
    fc: [0.08],    // the example's 1 - fc = 0.92
    h: [0.30],
    Zr: [0.50],
    p_tab: 0.5,
  };
  const management = {
    curve_number: 85,
    fw: 0.8,               // wetted fraction of the surface (drip/furrow-like)
    irrig_efficiency: 1.0, // net = gross, so the event is unambiguous
  };
  const wx = [{
    date: '2020-06-01',
    ETo: 4.5, prcp: 0, irrig: 5, // an irrigation event => fw_event = fw = 0.8
    wspd: 1.6, rmin: 35,
    // srad/tmin/tmax/rmax are not consumed once ETo is supplied
  }];

  const { df } = runModel(soil, crop, management, wx);
  const r = df[0];

  close(r.TEW, 18, 0.001, 'TEW (Eq. 73)');
  close(r.Kc_max, 1.21, 0.005, 'Kc max (Eq. 72)');
  close(r.few, 0.80, 0.001, 'few (Eq. 75)');
  close(r.Ke, 0.91, 0.01, 'Ke (Eq. 71)');
  close(r.E, 4.1, 0.05, 'E = Ke * ETo (mm)');
});

// The whole ten-day table of Example 35, not just day 1. This pins the
// "De,i start" convention: the 40 mm irrigation at the beginning of day 1 and
// the 6 mm rain at the beginning of day 6 act on that same day's Kr. It also
// pins the fw rule (irrigation => fw = 0.8, significant rain => fw = 1).
//
// The manual starts from De = TEW = 18 mm. The engine cannot start drier than
// wilting point (De = 13 mm), but the day-1 irrigation (I/fw = 50 mm) resets De
// to zero either way, so every printed row is still reproduced.
const EX35 = {
  ETo: [4.5, 5.0, 3.9, 4.2, 4.8, 2.7, 5.8, 5.1, 4.7, 5.2],
  Kcb: [0.30, 0.31, 0.32, 0.33, 0.34, 0.36, 0.37, 0.38, 0.39, 0.40],
  exposed: [0.92, 0.91, 0.91, 0.90, 0.89, 0.89, 0.88, 0.87, 0.87, 0.86],
  few: [0.80, 0.80, 0.80, 0.80, 0.80, 0.89, 0.88, 0.87, 0.87, 0.86],
  Kr: [1.00, 1.00, 0.70, 0.40, 0.20, 0.75, 0.53, 0.20, 0.09, 0.05],
  Ke: [0.91, 0.90, 0.62, 0.35, 0.18, 0.64, 0.45, 0.17, 0.08, 0.04],
  // Day 3 is printed as 2.8, which contradicts the same row's Ke x ETo =
  // 0.62 x 3.9 and E/few x few = 3.0 x 0.80, both 2.4. Treated as a misprint.
  E: [4.1, 4.5, 2.4, 1.5, 0.8, 1.7, 2.6, 0.9, 0.4, 0.2],
  DeEnd: [5, 11, 14, 16, 17, 13, 16, 17, 18, 18],
};

function runExample35() {
  const N = 10;
  const soil = { fc: 0.23, wp: 0.10, ini: 0.10, Ze: 0.10, REW_frac: 8 / 18, Zr_profile: 1.0 };
  const crop = {
    Kcb: EX35.Kcb,
    fc: EX35.exposed.map((x) => 1 - x),
    h: new Array(N).fill(0.30),
    Zr: new Array(N).fill(0.50),
    p_tab: 0.5,
  };
  const management = { curve_number: 85, fw: 0.8, irrig_efficiency: 1.0 };
  const wx = EX35.ETo.map((ETo, i) => ({
    date: `2020-06-${String(i + 1).padStart(2, '0')}`,
    ETo, prcp: i === 5 ? 6 : 0, irrig: i === 0 ? 40 : 0, wspd: 1.6, rmin: 35,
  }));
  return runModel(soil, crop, management, wx);
}

test('Example 35: all ten days of few, Kr, Ke, E and De (De,i start convention)', () => {
  const { df } = runExample35();
  for (let i = 0; i < 10; i++) {
    const day = `day ${i + 1}`;
    close(df[i].few, EX35.few[i], 0.005, `${day} few`);
    // Day 6 prints Kr = 0.75 beside De start = 11 mm, where Eq. 74 gives
    // (18 - 11) / (18 - 8) = 0.70; the tolerances absorb that. The lagged
    // convention would give Kr = 0.10 on that day, so they still bite.
    close(df[i].Kr, EX35.Kr[i], 0.05, `${day} Kr`);
    close(df[i].Ke, EX35.Ke[i], 0.05, `${day} Ke`);
    close(df[i].E, EX35.E[i], 0.15, `${day} E (mm)`);
    close(df[i].De, EX35.DeEnd[i], 0.75, `${day} De end (mm)`);
  }
});

// ── Behavior the manual describes in words rather than in a worked example ──

function bareSoil(N, overrides = {}) {
  return {
    soil: { fc: 0.30, wp: 0.12, ini: 0.30, Ze: 0.10, REW_frac: 0.35, Zr_profile: 1.0, ...overrides.soil },
    crop: { Kcb: new Array(N).fill(0), fc: new Array(N).fill(0), h: new Array(N).fill(0), Zr: new Array(N).fill(0.30), p_tab: 0.5 },
    management: { curve_number: 80, fw: 0.4, ...overrides.management },
  };
}

function residual(b) {
  return b.precipitation - b.runoff + b.irrigation_net - b.transpiration
    - b.evaporation - b.diffusive_loss - b.deep_percolation - b.storage_change;
}

test('fw: rain under 3 mm does not reset fw to 1, but is still fully counted', () => {
  const { soil, crop, management } = bareSoil(4);
  const day = (prcp, irrig) => ({ ETo: 5, prcp, irrig, wspd: 2, rmin: 45 });
  // irrigation, then light rain, then significant rain
  const { df, balance } = runModel(soil, crop, management, [day(0, 20), day(0, 0), day(2, 0), day(6, 0)]);
  close(df[0].few, 0.4, 1e-9, 'irrigation day few = fw');
  close(df[2].few, 0.4, 1e-9, '2 mm rain leaves fw at the irrigation value');
  close(df[3].few, 1.0, 1e-9, '6 mm rain resets fw to 1');
  // The 2 mm is not discarded: it lowers De by 2 mm before that day's E is added.
  close(df[2].De, df[1].De - 2 + df[2].E / df[2].few, 1e-9, 'light rain enters the De balance');
  close(balance.precipitation, 8, 1e-9, 'all rain is in the balance');
  close(residual(balance), 0, 1e-6, 'balance closes');
});

test('REW is capped at Table 19 maximum of 12 mm, with a warning', () => {
  const { soil, crop, management } = bareSoil(1, { soil: { REW_frac: 0.6 } });
  const { df, warnings } = runModel(soil, crop, management, [{ ETo: 5, prcp: 0, wspd: 2, rmin: 45 }]);
  close(df[0].TEW, 24, 1e-9, 'TEW');
  close(df[0].REW, 12, 1e-9, 'REW capped');
  assert.ok(warnings.some((w) => w.includes('REW')), 'a warning names the cap');
});

test('balance closes when evaporation dries a wilting-point root zone', () => {
  const N = 120;
  const { soil, crop, management } = bareSoil(N, { soil: { ini: 0.12 }, management: { fw: 1.0 } });
  const wx = [];
  for (let i = 0; i < N; i++) wx.push({ ETo: 7, prcp: i % 4 === 0 ? 3 : 0, wspd: 2, rmin: 45 });
  const { df, balance } = runModel(soil, crop, management, wx);
  close(residual(balance), 0, 1e-6, 'water balance residual (mm)');
  const maxDr = Math.max(...df.map((r) => r.Dr - r.TAW));
  assert.ok(maxDr > 0, 'Dr went past TAW');
  assert.ok(maxDr <= 1000 * 0.5 * 0.12 * 0.10 + 1e-9, 'but never past TAW + 1000 (0.5 wp) Ze');
});

test('fw: irrigation and rain on the same day => fw of the irrigation system', () => {
  const { soil, crop, management } = bareSoil(2);
  const { df } = runModel(soil, crop, management, [
    { ETo: 5, prcp: 25, irrig: 10, wspd: 2, rmin: 45 }, // rain larger than irrigation
    { ETo: 5, prcp: 10, irrig: 0, wspd: 2, rmin: 45 },  // significant rain alone
  ]);
  close(df[0].few, 0.4, 1e-9, 'irrigation + rain: fw = irrigation fw');
  close(df[1].few, 1.0, 1e-9, 'rain alone: fw = 1');
});

test('auto irrigation: the trigger sees today\'s rain first', () => {
  const N = 40;
  const soil = { fc: 0.30, wp: 0.12, ini: 0.30, Ze: 0.10, REW_frac: 0.35, Zr_profile: 1.5 };
  const crop = {
    Kcb: new Array(N).fill(1.0), fc: new Array(N).fill(0.9), h: new Array(N).fill(1.0),
    Zr: new Array(N).fill(1.0), p_tab: 0.5,
  };
  const management = { curve_number: 60, irrigation_mode: 'auto', mad: 0.5, irrig_amount: 25, irrig_efficiency: 1.0 };
  const dry = () => Array.from({ length: N }, () => ({ ETo: 6, prcp: 0, wspd: 2, rmin: 45 }));

  const base = runModel(soil, crop, management, dry()).df;
  const first = base.findIndex((r) => r.irrig_applied > 0);
  assert.ok(first > 0, 'a dry run irrigates at some point');

  // Same run, but 30 mm of rain falls on the day the first event would fire.
  const wx = dry();
  wx[first].prcp = 30;
  const wet = runModel(soil, crop, management, wx).df;
  close(wet[first].irrig_applied, 0, 1e-9, 'rain that clears the MAD threshold cancels the event');
  assert.ok(wet[first].Dr < management.mad * wet[first].TAW, 'root zone is back above MAD');
});
