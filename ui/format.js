/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * format.js — number/date formatting and small numeric helpers shared by
 * every mode. All chart/table numbers go through fmt() so precision is
 * consistent app-wide.
 */

/** Format a number to `d` decimals; em-dash for missing values. */
export function fmt(x, d = 1) {
  if (x === null || x === undefined || !isFinite(x)) return '—';
  return Number(x).toFixed(d);
}

export function fmtInt(x) {
  if (x === null || x === undefined || !isFinite(x)) return '—';
  return Math.round(x).toLocaleString('en-US');
}

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' (or Date) → 'Mar 5, 2024'. Falls back to the raw string. */
export function fmtDate(d) {
  if (!d) return '—';
  const m = typeof d === 'string' ? d.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  if (m) return `${MONTH_NAMES[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
  if (d instanceof Date) return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  return String(d);
}

/** 'YYYY-MM-DD' + n days → 'YYYY-MM-DD' (UTC-safe). */
export function addDaysISO(iso, n) {
  const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function clampNum(x, lo, hi) {
  return Math.min(Math.max(x, lo), hi);
}

export function cumsum(arr) {
  const out = new Array(arr.length);
  let s = 0;
  for (let i = 0; i < arr.length; i++) { s += arr[i]; out[i] = s; }
  return out;
}

export function mean(arr) {
  if (!arr.length) return NaN;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

/** Percentile with linear interpolation, p in [0, 100]. */
export function percentile(values, p) {
  const v = values.filter(x => isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const idx = (p / 100) * (v.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? v[lo] : v[lo] + (v[hi] - v[lo]) * (idx - lo);
}

export function median(values) {
  return percentile(values, 50);
}
