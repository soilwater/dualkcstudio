/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * modes/spatial/docs.js — documentation for the Field Scale tool.
 */

export const DOCS = {
  title: 'Field Scale',
  html: `
<p>Runs the same FAO-56 dual crop coefficient water balance as the other tools,
but <strong>per pixel on a 30 m grid</strong> across a field. Trace the boundary
on the map (or upload a GeoJSON), pick a season, sign in to Google Earth Engine,
and the tool pulls the soil, canopy, and weather it needs, then maps the result
day by day.</p>

<h3>Signing in</h3>
<p>Click <strong>Sign in with Google</strong> with an account that has Earth
Engine access and enter your Earth Engine <strong>Project ID</strong>. The
sign-in lasts about an hour and survives a reload; after that, sign in again.</p>

<h3>One engine, per pixel</h3>
<p>There is no separate spatial model: each pixel is run through the exact same
FAO-56 engine as the Single Season tool, with that pixel's own soil and
satellite-derived Kcb, so a one-pixel field reproduces Single Season exactly.
Fields up to 2,500 ha are accepted; a larger boundary is flagged before it
runs. For larger areas use the Mesoscale tool.</p>

<h3>Data sources</h3>
<table>
  <tr><th>layer</th><th>source</th></tr>
  <tr><td>Canopy</td><td><strong>Landsat 8-day EVI</strong> (30 m, cloud-free
      composite). Each clear observation is linearly rescaled to Kcb between a
      bare-soil endpoint (EVI 0.15 → Kcb min) and a full-cover endpoint (EVI
      0.70 → Kcb max), then interpolated to daily values per pixel; beyond the
      first and last observation the nearest value is held.</td></tr>
  <tr><td>Soil</td><td><strong>POLARIS</strong> (30 m, CONUS): sand, clay and
      organic matter → field capacity &amp; wilting point via the Saxton &amp;
      Rawls (2006) pedotransfer functions. The <strong>surface</strong>
      (evaporation) layer is the 0–15 cm mean; the <strong>root zone</strong> is
      the 0–100 cm mean.</td></tr>
  <tr><td>Weather</td><td><strong>GRIDMET</strong> (~4 km) as one daily series
      at the field centroid, applied to every pixel — appropriate at field
      scale, where weather is effectively uniform.</td></tr>
</table>

<h3>Choosing the area</h3>
<p>Use the draw tools (rectangle, circle, or polygon, at the top-left of the
map) to trace the field boundary, or upload a GeoJSON polygon. The grid is
sampled over the shape's bounding box and <strong>clipped to the shape</strong>
— pixels outside a circle or polygon are dropped.</p>

<h3>Reading the map</h3>
<p>Choose a variable and drag the day slider. Daily variables (Kcb, available
water, depletion, ETc, the stress coefficient Ks) animate; season summaries and
the soil limits are a single map. Click any pixel for three stacked daily plots
— reference vs crop ET (ETo, ETc), available water and precipitation, and crop
coefficients (Kcb, Kcb+Ke). Pixels with no soil data, no clear satellite
observation, or outside the drawn boundary are left blank. The
<strong>GeoTIFF</strong> button downloads the layer currently shown (variable
and day) as a georeferenced raster.</p>
`,
};
