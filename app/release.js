/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * release.js — the staggered public rollout, in one place.
 *
 * Every tool is fully built and tested; this only controls which ones are
 * PUBLIC yet. To announce a tool, uncomment its line (and bump APP_VERSION in
 * brand.js). Unreleased tools show as "coming soon" on the landing page, and
 * their routes redirect home, so nothing half-finished is ever reachable.
 *
 * Home ('') is always released.
 */

export const RELEASED = new Set([
  'single-season',            // v1.0.0
  // 'probabilistic',         // v1.1.0
  // 'rotation',              // v1.2.0
  // 'cover-crop-termination',
  // 'eto-calculator',
  // 'soil-limits',
  // 'gee-collector',
  // 'spatial',
  // 'mesoscale',
]);

export function isReleased(path) {
  return path === '' || RELEASED.has(path);
}
