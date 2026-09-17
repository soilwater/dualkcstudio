/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/spatial_shared/veg_index.js — the one generic helper over a vegetation
 * source's band map, shared by the spatial factory and each tool's ee_data.js.
 *
 * A source declares exactly one index in its `bands` map (e.g. { evi: 'EVI' });
 * the index key IS part of the source's identity. Kept here, out of the per-tool
 * veg_sources.js registries, so Field Scale and Mesoscale share one definition
 * without importing from each other.
 */

/** The single index key a source provides, e.g. 'evi'. */
export function sourceIndex(src) {
  return Object.keys(src.bands)[0];
}
