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
