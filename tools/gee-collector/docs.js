/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/gee-collector/docs.js — documentation for the GEE Data Collector.
 */

export const DOCS = {
  title: 'GEE Data Collector',
  html: `
<p>Pulls a ready-to-use weather + vegetation record for a single point from
<strong>Google Earth Engine</strong>: GRIDMET daily weather and a MODIS
16-day vegetation index, mapped into the exact column names the other tools
expect. Click a point, pick a period, sign in, collect, download.</p>

<h3>Signing in</h3>
<p>The app runs entirely in your browser and authenticates with Google
directly (no server). Click <strong>Sign in with Google</strong> with an
account that has Earth Engine access, then enter your Earth Engine
<strong>Project ID</strong>. The short-lived access token (about one hour) is
kept in the browser so a reload within that time reconnects without a popup;
after it expires you simply sign in again.</p>

<h3>What it collects</h3>
<table>
  <tr><th>source</th><th>bands → columns</th></tr>
  <tr><td>GRIDMET (<code>IDAHO_EPSCOR/GRIDMET</code>), daily ~4 km</td>
      <td><code>pr → prcp</code>, <code>eto → eto</code>,
      <code>rmin → rmin</code>, <code>vs → wspd</code> (10 m wind converted to
      2 m, FAO-56 Eq. 47).</td></tr>
  <tr><td>MODIS 16-day VI (<code>MOD13Q1</code> Terra ∪ <code>MYD13Q1</code>
      Aqua), 250 m</td><td>NDVI or EVI, kept only where the pixel is clear
      (SummaryQA ≤ marginal), scaled ×0.0001.</td></tr>
</table>

<h3>Vegetation index → kcb_obs</h3>
<p>The chosen index is linearly rescaled between a <strong>soil</strong> value
(→ 0) and a <strong>full-cover</strong> value (→ 1) and written to the
<code class="var">kcb_obs</code> column on the days a clear observation exists. Tick
<strong>Interpolate Kcb to daily</strong> to fill every day instead: gaps
between observations are linear, and beyond the first/last observation the
value is either held constant or extended along the end segment's slope
(<em>Beyond ends</em>). Changing the index, endpoints or interpolation
re-derives the output from the data already fetched. The model tools use
<code class="var">kcb_obs</code> in place of the tabulated Kcb curve.</p>

<div class="docs-note">The downloaded CSV uses the standard column names
(<code>date, prcp, eto, rmin, wspd, kcb_obs</code>), so it loads directly into
Single Season, Rotation, Probabilistic or Cover Crop Termination — it already
has <code class="var">eto</code>, so no ETo step is needed. Merging Terra and Aqua gives
roughly 8-day vegetation sampling.</div>

<p>Sources: Abatzoglou (2013) GRIDMET; Didan (2015) MODIS MOD13Q1/MYD13Q1;
Allen et al. (1998) FAO-56.</p>
`,
};
