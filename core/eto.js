/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * eto.js — FAO-56 Penman-Monteith daily reference evapotranspiration.
 *
 * Always-on / shared: ETo has no "strict vs. enhanced" variant, so this
 * module takes no options and is used identically by every run.
 */

import { getDayOfYear } from './dateUtils.js';

/**
 * FAO-56 Penman-Monteith reference ET (mm/day) for a single day.
 */
export function penmanMonteithDaily(lat, elev, doy, tmin, tmax, rmin, rmax, srad, wspd, vpd = null) {
  const tavg = (tmin + tmax) / 2.0;
  const pressure = 101.3 * Math.pow((293.0 - 0.0065 * elev) / 293.0, 5.26);
  const gamma = 0.001013 * pressure / (0.622 * 2.45);

  const e_sat_min = 0.6108 * Math.exp(17.27 * tmin / (tmin + 237.3));
  const e_sat_max = 0.6108 * Math.exp(17.27 * tmax / (tmax + 237.3));
  const e_sat = (e_sat_min + e_sat_max) / 2.0;
  const e_act = (e_sat_min * rmax / 100.0 + e_sat_max * rmin / 100.0) / 2.0;

  const actualVpd = (vpd !== null && !isNaN(vpd)) ? Math.max(vpd, 0.0) : Math.max(e_sat - e_act, 0.0);
  const delta = 4098.0 * (0.6108 * Math.exp(17.27 * tavg / (tavg + 237.3))) / Math.pow(tavg + 237.3, 2);

  const dr = 1.0 + 0.033 * Math.cos(2.0 * Math.PI * doy / 365.0);
  const phi = Math.PI / 180.0 * lat;
  const d = 0.409 * Math.sin(2.0 * Math.PI * doy / 365.0 - 1.39);
  const arg = Math.min(Math.max(-Math.tan(phi) * Math.tan(d), -1.0), 1.0);
  const omega = Math.acos(arg);

  const Ra = (24.0 * 60.0 / Math.PI) * 0.0820 * dr * (
    omega * Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.sin(omega)
  );

  const Rso = (0.75 + 2e-5 * elev) * Ra;
  const Rns = (1.0 - 0.23) * srad;
  const sigma = 4.903e-9;
  const Rnl = sigma * ((Math.pow(tmax + 273.16, 4) + Math.pow(tmin + 273.16, 4)) / 2.0)
    * (0.34 - 0.14 * Math.sqrt(Math.max(e_act, 1e-6)))
    * (1.35 * Math.min(srad / Math.max(Rso, 0.001), 1.0) - 0.35);

  const Rn = Rns - Rnl;
  const ETo = (0.408 * delta * Rn + gamma * (900.0 / (tavg + 273.0)) * wspd * actualVpd)
    / (delta + gamma * (1.0 + 0.34 * wspd));

  return Number(Math.max(ETo, 0.0).toFixed(2));
}

/**
 * Fills weatherDf[i].ETo in place for any row missing it. Idempotent —
 * safe to call repeatedly across runProbabilistic/runScenario iterations
 * on the same shared weatherDf.
 */
export function ensureEToComputed(weatherDf, location) {
  weatherDf.forEach(r => {
    if (r.ETo === undefined || isNaN(r.ETo)) {
      const doy = getDayOfYear(r.date);
      r.ETo = penmanMonteithDaily(location.lat, location.elev, doy, r.tmin, r.tmax, r.rmin, r.rmax, r.srad, r.wspd, r.vpd);
    }
  });
}
