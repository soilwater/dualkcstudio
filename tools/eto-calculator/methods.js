/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/eto-calculator/methods.js — pure reference-ET methods and the loose
 * CSV parsing / gap-filling that feeds them. No DOM.
 *
 * Five daily reference-ET (ETo) methods, each keyed to the variables a user
 * actually has. Penman-Monteith reuses the tested core implementation; the
 * rest are standard published equations built from the same FAO-56 helper
 * relations (saturation vapour pressure, its slope, the psychrometric
 * constant, extraterrestrial and net radiation) so they stay consistent
 * with the engine's own physics. No water-balance code lives here.
 *
 *   pm          Penman-Monteith (FAO-56)     Tmin,Tmax, humidity, Rs, wind, (lat,elev)
 *   hargreaves  Hargreaves-Samani (1985)     Tmin,Tmax, (lat)
 *   makkink     Makkink (1957)               Tmin,Tmax, Rs, (elev)
 *   dalton      Mass transfer (Penman Ea)    VPD (or RH+T), wind
 *   pt          Priestley-Taylor (1972)      net radiation (or Rs+humidity), Tmin,Tmax, (elev)
 *
 * Gap-filling before a method runs reuses core/weather.js's preprocess():
 * precipitation → 0, wind → a constant 2 m/s, everything else → PCHIP
 * interpolation with NO extrapolation past the first/last real value.
 */

import { penmanMonteithDaily, getDayOfYear } from '../../core/index.js';
import { preprocess } from '../../core/weather.js';
import { parseLooseCsv } from '../../ui/csv.js';

export { parseLooseCsv };

const LAMBDA = 2.45;               /* latent heat of vaporisation, MJ/kg */
const SIGMA = 4.903e-9;            /* Stefan-Boltzmann, MJ K^-4 m^-2 day^-1 */
const ALBEDO = 0.23;

/* ── FAO-56 helper relations (kPa, °C, MJ m^-2 day^-1) ─────────────────── */

function svp(T) { return 0.6108 * Math.exp(17.27 * T / (T + 237.3)); }
function svpSlope(Tmean) { return 4098 * svp(Tmean) / Math.pow(Tmean + 237.3, 2); }
function atmPressure(elev) { return 101.3 * Math.pow((293 - 0.0065 * elev) / 293, 5.26); }
function psychro(elev) { return 0.000665 * atmPressure(elev); }
function meanSvp(tmin, tmax) { return (svp(tmin) + svp(tmax)) / 2; }
function actualVp(tmin, tmax, rmin, rmax) { return (svp(tmin) * rmax / 100 + svp(tmax) * rmin / 100) / 2; }

/** Extraterrestrial radiation Ra (MJ m^-2 day^-1) — FAO-56 Eq. 21–25. */
function extraterrestrialRadiation(lat, doy) {
  const phi = Math.PI / 180 * lat;
  const dr = 1 + 0.033 * Math.cos(2 * Math.PI * doy / 365);
  const decl = 0.409 * Math.sin(2 * Math.PI * doy / 365 - 1.39);
  const ws = Math.acos(Math.min(Math.max(-Math.tan(phi) * Math.tan(decl), -1), 1));
  return (24 * 60 / Math.PI) * 0.0820 * dr * (ws * Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.sin(ws));
}

/** Net radiation from incoming solar Rs (FAO-56 Eq. 38–40), MJ m^-2 day^-1. */
function netRadiation(row, loc, doy) {
  const ea = actualVp(row.tmin, row.tmax, row.rmin, row.rmax);
  const Ra = extraterrestrialRadiation(loc.lat, doy);
  const Rso = (0.75 + 2e-5 * loc.elev) * Ra;
  const Rns = (1 - ALBEDO) * row.srad;
  const Rnl = SIGMA * ((Math.pow(row.tmax + 273.16, 4) + Math.pow(row.tmin + 273.16, 4)) / 2)
    * (0.34 - 0.14 * Math.sqrt(Math.max(ea, 1e-6)))
    * (1.35 * Math.min(row.srad / Math.max(Rso, 0.001), 1) - 0.35);
  return Rns - Rnl;
}

/** Vapour-pressure deficit (kPa): the column if present, else from RH + T. */
function vpdOf(row) {
  if (isFinite(row.vpd)) return Math.max(row.vpd, 0);
  if ([row.tmin, row.tmax, row.rmin, row.rmax].every(isFinite)) {
    return Math.max(meanSvp(row.tmin, row.tmax) - actualVp(row.tmin, row.tmax, row.rmin, row.rmax), 0);
  }
  return NaN;
}

/* ── The five methods. Each returns mm/day, or NaN if inputs are missing ── */

function etoPM(row, loc, doy) {
  if (![row.tmin, row.tmax, row.srad, row.wspd].every(isFinite)) return NaN;
  const vpd = isFinite(row.vpd) ? row.vpd : null;
  if (vpd === null && !(isFinite(row.rmin) && isFinite(row.rmax))) return NaN;
  if (!(isFinite(loc.lat) && isFinite(loc.elev))) return NaN;
  return penmanMonteithDaily(loc.lat, loc.elev, doy, row.tmin, row.tmax, row.rmin, row.rmax, row.srad, row.wspd, vpd);
}

function etoHargreaves(row, loc, doy) {
  if (!(isFinite(row.tmin) && isFinite(row.tmax) && isFinite(loc.lat))) return NaN;
  const Tmean = (row.tmin + row.tmax) / 2;
  const Ra = extraterrestrialRadiation(loc.lat, doy);
  return Math.max(0.0023 * (0.408 * Ra) * (Tmean + 17.8) * Math.sqrt(Math.max(row.tmax - row.tmin, 0)), 0);
}

function etoMakkink(row, loc, doy) {
  if (!(isFinite(row.tmin) && isFinite(row.tmax) && isFinite(row.srad) && isFinite(loc.elev))) return NaN;
  const Tmean = (row.tmin + row.tmax) / 2;
  const D = svpSlope(Tmean), g = psychro(loc.elev);
  return Math.max(0.61 * (D / (D + g)) * (row.srad / LAMBDA) - 0.12, 0);
}

function etoDalton(row, loc, doy) {
  const vpd = vpdOf(row);
  if (!(isFinite(vpd) && isFinite(row.wspd) && isFinite(row.tmin) && isFinite(row.tmax) && isFinite(loc.elev))) return NaN;
  const Tmean = (row.tmin + row.tmax) / 2;
  const D = svpSlope(Tmean), g = psychro(loc.elev);
  /* Penman (1948) aerodynamic ("drying power") term, SI form after
     Shuttleworth (1993): Ea = 6.43 (1 + 0.536 u2) (es − ea) / λ — then
     weighted by the psychrometric ratio γ/(Δ+γ), which is how full Penman
     scales it (Ea alone over-estimates ~2×). This is only the aerodynamic
     CONTRIBUTION to ETo; it omits the radiation term, so it under-estimates
     where net radiation drives ET. A rough estimate, not a combination
     method. */
  const Ea = 6.43 * (1 + 0.536 * row.wspd) * vpd / LAMBDA;
  return Math.max((g / (D + g)) * Ea, 0);
}

function etoPriestleyTaylor(row, loc, doy) {
  if (!(isFinite(row.tmin) && isFinite(row.tmax) && isFinite(loc.elev))) return NaN;
  let Rn;
  if (isFinite(row.rn)) Rn = row.rn;
  else if (isFinite(row.srad) && isFinite(row.rmin) && isFinite(row.rmax) && isFinite(loc.lat)) Rn = netRadiation(row, loc, doy);
  else return NaN;
  const Tmean = (row.tmin + row.tmax) / 2;
  const D = svpSlope(Tmean), g = psychro(loc.elev);
  /* α = 1.26, daily soil heat flux G ≈ 0. */
  return Math.max(1.26 * (D / (D + g)) * (Rn / LAMBDA), 0);
}

/* ── Method catalogue ──────────────────────────────────────────────────── */

export const METHODS = [
  { id: 'pm', label: 'Penman-Monteith (FAO-56)', fn: etoPM, needs: ['tmin', 'tmax', 'humidity', 'srad', 'wspd'], site: ['lat', 'elev'],
    blurb: 'The FAO-56 standard. Uses all variables; the reference where full data exist.' },
  { id: 'pt', label: 'Priestley-Taylor', fn: etoPriestleyTaylor, needs: ['tmin', 'tmax', 'netrad'], site: ['elev'],
    blurb: 'Radiation-driven (α = 1.26). Uses net radiation, or derives it from solar radiation + humidity. No wind needed.' },
  { id: 'makkink', label: 'Makkink', fn: etoMakkink, needs: ['tmin', 'tmax', 'srad'], site: ['elev'],
    blurb: 'Radiation-based. Needs solar radiation and temperature only; well suited to humid climates.' },
  { id: 'hargreaves', label: 'Hargreaves-Samani', fn: etoHargreaves, needs: ['tmin', 'tmax'], site: ['lat'],
    blurb: 'Temperature-only fallback (needs latitude for solar geometry). Robust where only air temperature exists.' },
  { id: 'dalton', label: 'Mass transfer (Penman aerodynamic)', fn: etoDalton, needs: ['tmin', 'tmax', 'vpdOk', 'wspd'], site: ['elev'],
    blurb: 'Penman drying-power term (VPD + wind), psychrometric-weighted. Omits radiation, so it under-estimates where radiation drives ET — a rough approximation.' },
];

export const METHOD_BY_ID = Object.fromEntries(METHODS.map(m => [m.id, m]));

/** Which recognised weather variables are present (≥1 finite value). */
export function detectColumns(parsed) {
  const has = (k) => parsed.keys.includes(k) && parsed.rows.some(r => isFinite(r[k]));
  const cols = {
    tmin: has('tmin'), tmax: has('tmax'), rmin: has('rmin'), rmax: has('rmax'),
    srad: has('srad'), wspd: has('wspd'), prcp: has('prcp'), vpd: has('vpd'), rn: has('rn'),
  };
  cols.humidity = (cols.rmin && cols.rmax) || cols.vpd;
  cols.vpdOk = cols.vpd || (cols.rmin && cols.rmax && cols.tmin && cols.tmax);
  cols.netrad = cols.rn || (cols.srad && cols.rmin && cols.rmax);
  return cols;
}

const NEED_LABEL = {
  tmin: 'Tmin', tmax: 'Tmax', humidity: 'humidity (RH or VPD)', srad: 'solar radiation',
  wspd: 'wind', vpdOk: 'VPD (or RH+temp)', netrad: 'net radiation (or Rs+humidity)',
};

/** For one method: is it runnable, and what data/site inputs are missing. */
export function methodStatus(method, cols, location = {}) {
  const missingData = method.needs.filter(n => !cols[n]).map(n => NEED_LABEL[n] || n);
  const missingSite = method.site.filter(s => !isFinite(location[s]));
  return { available: missingData.length === 0, missingData, missingSite, ready: missingData.length === 0 && missingSite.length === 0 };
}

/* ── Compute ───────────────────────────────────────────────────────────── */

/**
 * Gap-fills the parsed rows (precip → 0, wind → 2, else PCHIP, no
 * extrapolation) and computes ETo for the chosen method. Returns the ETo
 * values (aligned with parsed.rows; NaN where inputs were still missing),
 * the fill warnings, and how many days produced a value.
 */
export function computeEto(parsed, methodId, location) {
  const method = METHOD_BY_ID[methodId];
  if (!method) throw new Error(`Unknown method: ${methodId}`);
  const { df: filled, warnings } = preprocess(parsed.rows, { wspd: { method: 'constant', value: 2 } });
  const values = filled.map((r) => {
    const v = method.fn(r, location, getDayOfYear(r.date));
    return isFinite(v) ? Number(v.toFixed(2)) : NaN;
  });
  return { values, warnings, validDays: values.filter(isFinite).length };
}
