/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * modes/mesoscale/docs.js — documentation for the Mesoscale (4 km) tool.
 */

export const DOCS = {
  title: 'Mesoscale',
  html: `
<p>The same FAO-56 water balance as Field Scale, run <strong>per pixel on a
4 km grid</strong> for <strong>large watersheds and regional-scale</strong> work
(up to 250,000 km²). Trace the area with the draw tools or upload a GeoJSON
boundary, pick a season, sign in to Google Earth Engine, and the tool pulls
soil, canopy, and weather onto the 4 km grid.</p>

<h3>Signing in and choosing the area</h3>
<p>Click <strong>Sign in with Google</strong> with an account that has Earth
Engine access and enter your Earth Engine <strong>Project ID</strong> (the
sign-in lasts about an hour). Trace the area with the draw tools at the
top-left of the map or upload a GeoJSON polygon; the grid is clipped to the
shape. Areas over 250,000 km² are flagged before running.</p>

<h3>Data sources</h3>
<table>
  <tr><th>layer</th><th>source</th></tr>
  <tr><td>Canopy</td><td><strong>VIIRS EVI</strong> (500 m, 16-day), averaged
      onto the 4 km grid; only good-quality pixels are used. Each clear
      observation is rescaled to Kcb between a bare-soil endpoint (EVI 0.15 →
      Kcb min) and a full-cover endpoint (EVI 0.70 → Kcb max), then interpolated
      to daily values per pixel.</td></tr>
  <tr><td>Soil</td><td><strong>SoilGrids</strong> (250 m, global), averaged to
      4 km: sand, clay and organic carbon → field capacity &amp; wilting point
      via the Saxton &amp; Rawls (2006) pedotransfer functions (surface layer
      0–15 cm, root zone 0–100 cm).</td></tr>
  <tr><td>Weather</td><td><strong>GRIDMET</strong>, per pixel (~4 km native, a
      natural match) — ETo and precipitation vary across the region rather than
      being a single series, and both are available as map layers.</td></tr>
</table>

<h3>Reading the map</h3>
<p>Choose a variable and drag the day slider (Kcb, available water, depletion,
ETo, ETc, precipitation, the stress coefficient Ks), or view a season summary or
the soil limits. Click any pixel for its daily ET, available water and
precipitation, and crop coefficients. Pixels with no soil, no clear satellite
observation, outside the drawn boundary, or off GRIDMET's coverage are blank.
The <strong>GeoTIFF</strong> button downloads the layer currently shown as a
georeferenced raster.</p>
`,
};
