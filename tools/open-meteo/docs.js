/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/open-meteo/docs.js — documentation for the Open-Meteo weather tool.
 */

export const DOCS = {
  title: 'Open-Meteo Weather',
  html: `
<p>Downloads a ready-to-use daily weather file for any point on Earth from the
free <strong>Open-Meteo</strong> archive, so you can run the model without
hunting for data. Open-Meteo computes FAO-56 reference ET for you, so the file
already has the <code class="var">date</code>, <code class="var">prcp</code> and <code class="var">eto</code>
columns the other tools require.</p>

<h3>Workflow</h3>
<ol>
  <li><strong>Location</strong> — type a latitude and longitude, or click
      <em>Use my location</em>.</li>
  <li><strong>Period</strong> — a start and end date. The archive covers 1940
      to about five days ago, up to roughly nine months per request (this tool
      suits a growing season, not a multi-decade pull).</li>
  <li><strong>Fetch from Open-Meteo</strong> — the daily series is pulled and
      previewed as charts and a table.</li>
  <li><strong>Download CSV</strong> — save the file, then load it in Single
      Season, Crop Rotation, or any other model tool.</li>
</ol>

<h3>Columns</h3>
<table>
  <tr><th>column</th><th>from Open-Meteo</th></tr>
  <tr><td><code class="var">date</code></td><td>day (UTC)</td></tr>
  <tr><td><code class="var">prcp</code></td><td>precipitation sum, mm</td></tr>
  <tr><td><code class="var">eto</code></td><td>FAO-56 reference ET, mm</td></tr>
  <tr><td><code class="var">wspd</code></td><td>mean wind speed at 2 m, m/s</td></tr>
  <tr><td><code class="var">rmin</code></td><td>minimum relative humidity, %</td></tr>
</table>
<p>Only the variables the model uses are downloaded. <code class="var">wspd</code> and
<code class="var">rmin</code> let the model apply its wind and humidity correction.</p>

<div class="docs-note">Requests are limited to one every 30 seconds to be
courteous to a free public service. Open-Meteo is reanalysis / interpolated
model data — convenient and global, but for a specific field a nearby weather
station is usually more accurate.</div>

<p>Source: Open-Meteo (open-meteo.com), Zippenfenig (2023),
doi:10.5281/zenodo.7970649. Weather data is licensed CC BY 4.0.</p>`,
};
