/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * dateUtils.js — Shared UTC date helpers.
 *
 * Dates are handled as UTC midnight timestamps throughout the engine so day
 * arithmetic (adding N days, comparing windows) never trips over local
 * timezone / DST shifts. Every other module that needs to compare or step
 * dates should go through these, not `new Date(str)` directly.
 */

export function parseUtcParts(dateStr) {
  const s = String(dateStr).split('T')[0];
  const [y, m, d] = s.split('-').map(Number);
  return { year: y, monthIndex: m - 1, day: d };
}

export function toUtcTimestamp(dateStr) {
  const { year, monthIndex, day } = parseUtcParts(dateStr);
  return Date.UTC(year, monthIndex, day);
}

export function getDayOfYear(dateStr) {
  const { year, monthIndex, day } = parseUtcParts(dateStr);
  const date = new Date(Date.UTC(year, monthIndex, day));
  const start = new Date(Date.UTC(year, 0, 0));
  return Math.floor((date - start) / 86400000);
}
