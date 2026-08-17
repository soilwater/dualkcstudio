/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * modes/eto-calculator/docs.js — documentation for the ETo Calculator mode.
 */

export const DOCS = {
  title: 'ETo Calculator',
  html: `
<p>Computes daily <strong>reference evapotranspiration (ETo)</strong> from a
weather CSV and hands the file back with one <code>eto</code> column
appended — ready to feed the other tools, which expect an ETo-complete
record. Pick the method your available variables support.</p>

<h3>Workflow</h3>
<ol>
  <li><strong>Upload</strong> a CSV. Any columns are accepted; only a
      <code>date</code> column is required. Recognised weather columns use
      the same names as the rest of the app: <code>tmin, tmax, rmin, rmax,
      srad, wspd, prcp</code>, plus optional <code>vpd</code> and
      <code>rn</code> (net radiation).</li>
  <li><strong>Site</strong> — latitude and elevation. Latitude drives the
      solar-geometry term; elevation sets air pressure. Not every method
      needs both (see the table).</li>
  <li><strong>Method</strong> — the tool shows which methods your data
      supports; unsupported ones say what's missing.</li>
  <li><strong>Compute</strong>, review the plot, then <strong>Download
      CSV</strong> — your original file, unchanged, with <code>eto</code>
      appended (or replaced, if the file already had one).</li>
</ol>

<h3>Methods</h3>
<table>
  <tr><th>method</th><th>needs</th><th>notes</th></tr>
  <tr><td>Penman-Monteith (FAO-56)</td><td>Tmin, Tmax, humidity, solar
      radiation, wind, latitude, elevation</td><td>The standard. Use it
      whenever the full set exists — the others are fallbacks.</td></tr>
  <tr><td>Priestley-Taylor</td><td>net radiation (or solar radiation +
      humidity), temperature, elevation</td><td>Radiation-driven
      (α = 1.26); no wind needed.</td></tr>
  <tr><td>Makkink</td><td>solar radiation, temperature, elevation</td>
      <td>Radiation-based; well suited to humid climates, tends to
      under-estimate in dry/advective ones.</td></tr>
  <tr><td>Hargreaves-Samani</td><td>Tmin, Tmax, latitude</td><td>Temperature
      only — the robust fallback when little else is measured.</td></tr>
  <tr><td>Mass transfer (Penman aerodynamic)</td><td>VPD (or RH + temp),
      wind, temperature, elevation</td><td>The Penman drying-power term,
      psychrometric-weighted. Omits radiation, so it under-estimates where
      radiation drives ET — a rough approximation.</td></tr>
</table>

<div class="docs-note">The reduced-data methods can differ from
Penman-Monteith by a lot, especially in windy, advective climates where the
aerodynamic term matters. Use them when you have to, and prefer
Penman-Monteith when the data allow it.</div>

<h3>Missing values</h3>
<p>Before ETo is computed, gaps are filled: <strong>precipitation → 0</strong>,
<strong>wind → 2 m/s</strong> (the FAO-56 default), and every other variable
by <strong>PCHIP</strong> (monotone cubic) interpolation. There is
<strong>no extrapolation</strong>: gaps before the first or after the last
real value of a variable are left unfilled, and any day still missing a
required input gets a blank <code>eto</code>. The downloaded file keeps your
original values as-is; only the <code>eto</code> column is added.</p>

<p>Reference: Allen et al. (1998) FAO-56; Priestley &amp; Taylor (1972);
Makkink (1957); Hargreaves &amp; Samani (1985).</p>
`,
};
