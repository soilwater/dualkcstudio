/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * modes/spatial/basemaps.js — shared Leaflet basemaps for the spatial maps.
 *
 * The default is a HYBRID view: Esri satellite imagery with transparent
 * reference overlays (boundaries/places + roads) on top, so a field can be
 * both seen and located. A plain Satellite and an OSM Street option are offered
 * too. Each function returns FRESH layer instances — a Leaflet layer can't be
 * shared between two maps — so both the AOI map and the results map call these
 * independently.
 */

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const tile = (L, path, opts) => L.tileLayer(`${ESRI}/${path}/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19, ...opts });

/** Satellite imagery + roads + boundaries/place labels (for orientation). */
export function hybridLayer(L) {
  return L.layerGroup([
    tile(L, 'World_Imagery', { attribution: 'Imagery © Esri' }),
    tile(L, 'Reference/World_Transportation', {}),
    tile(L, 'Reference/World_Boundaries_and_Places', {}),
  ]);
}

/** Plain satellite imagery, no labels. */
export function satelliteLayer(L) {
  return tile(L, 'World_Imagery', { attribution: 'Imagery © Esri' });
}

/** OpenStreetMap street map. */
export function streetLayer(L) {
  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
}

/** The base-layer set for L.control.layers (Hybrid is the intended default). */
export function baseLayers(L) {
  return { Hybrid: hybridLayer(L), Satellite: satelliteLayer(L), Street: streetLayer(L) };
}
