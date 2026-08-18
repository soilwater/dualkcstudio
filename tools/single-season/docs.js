/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/single-season/docs.js — documentation shown in the drawer while
 * the Single Season mode is active. Trusted static HTML.
 */

export const DOCS = {
  title: 'Single Season',
  html: `
<p>Simulates one crop's daily soil water balance with the FAO-56 dual crop
coefficient method: <code>ETc = (Ks·Kcb + Ke)·ETo</code>, tracked over a
three-layer soil profile (surface evaporation layer, root zone, subsoil).</p>

<h3>Workflow</h3>
<ol>
  <li><strong>Weather &amp; site</strong> — drop a daily CSV or load the example
      dataset. The file must already have an <code class="var">eto</code> column (see
      the format below).</li>
  <li><strong>Season</strong> — pick the planting date. Season length is the sum
      of the four crop stage lengths.</li>
  <li><strong>Soil / Crop / Management</strong> — start from presets and adjust.
      The Kcb curve is directly draggable: vertical moves set Kcb values,
      horizontal moves set stage lengths.</li>
  <li><strong>Run simulation</strong> — results render on the right: seasonal
      totals, daily charts (drag to zoom; all charts pan together), the daily
      table, and CSV export.</li>
</ol>

<h3>Weather CSV format</h3>
<p>The water balance runs on an <strong>ETo-complete</strong> file — one row
per day, comma-separated, with these columns:</p>
<table>
  <tr><th>column</th><th>meaning</th><th></th></tr>
  <tr><td><code class="var">date</code></td><td>YYYY-MM-DD</td><td>required</td></tr>
  <tr><td><code class="var">prcp</code></td><td>precipitation, mm</td><td>required</td></tr>
  <tr><td><code class="var">eto</code></td><td>reference ET, mm/day</td><td>required</td></tr>
  <tr><td><code class="var">wspd</code></td><td>wind speed at 2 m, m/s</td><td>optional</td></tr>
  <tr><td><code class="var">rmin</code></td><td>min relative humidity, %</td><td>optional</td></tr>
</table>
<p>Don't have <code class="var">eto</code>? Compute it from raw weather in the
<strong>ETo Calculator</strong>, then upload the file it hands back (your
data with an <code class="var">eto</code> column appended). <code class="var">wspd</code> and
<code class="var">rmin</code> feed the FAO-56 wind/humidity corrections (Kc_max Eq. 72,
the Eq. 70 Kcb adjustment); when absent, the standard climate
(2 m/s, 45 %) is used and the climate-adjust option is disabled.</p>
<p>Other optional columns: <code class="var">irrig</code> (applied irrigation, used by
the “Data” irrigation mode) and <code class="var">kcb_obs</code> (sparse observed
Kcb, e.g. from remote sensing — it overrides the curve where present and is
interpolated between observations). Short interior gaps in <code class="var">eto</code>,
<code class="var">wspd</code> and <code class="var">rmin</code> are filled without extrapolation.</p>

<h3>Irrigation modes</h3>
<table>
  <tr><th>mode</th><th>behaviour</th></tr>
  <tr><td>Rainfed</td><td>no irrigation, the CSV's irrig column is ignored</td></tr>
  <tr><td>Data</td><td>applies the CSV's <code class="var">irrig</code> column as-is</td></tr>
  <tr><td>Auto</td><td>irrigates when root-zone depletion reaches the MAD
      fraction of TAW, refilling up to the event amount</td></tr>
  <tr><td>Interval</td><td>a fixed amount every N days</td></tr>
</table>
<p>The wetted fraction fw comes from the method (sprinkler 1.0, furrow 0.7,
drip 0.35); efficiency scales gross to net water; the optional season
allocation caps total applied irrigation.</p>
<p><strong>Surface condition:</strong> residue cover (entered as a percent, 0–100) shades the soil and lowers evaporation, and the curve number sets rainfall runoff.</p>

<h3>Reading the charts</h3>
<ul>
  <li><strong>Crop coefficients</strong> — Kcb is the crop's basal curve; Kcb+Ke
      adds soil evaporation spikes after wetting events; Kc max is the energy
      ceiling; Ks drops below 1 under water stress.</li>
  <li><strong>Root-zone depletion</strong> — plotted downward: the red line is how
      much water the root zone is missing. Crossing RAW starts stress
      (Ks &lt; 1); reaching TAW is wilting point.</li>
  <li><strong>Profile storage</strong> — plant-available water held in the root
      zone and in the subsoil below it (roots can reach subsoil water by
      growing deeper).</li>
  <li><strong>Surface layer</strong> — the evaporation bookkeeping (Eq. 74/75):
      evaporation proceeds at the energy limit until REW is exhausted, then
      falls off toward TEW.</li>
</ul>

<h3>Model options</h3>
<p>Strict FAO-56 is the default. Each switch is a documented, optional
departure; “All on” turns everything on. The canopy-cover model
choice matters most for tall row crops under water stress (see Trout &amp;
DeJonge 2018 for the linear-in-Kcb evidence).</p>

<h3>Outputs glossary</h3>
<table>
  <tr><th>var</th><th>meaning (units)</th></tr>
  <tr><td>ETo</td><td>reference ET (mm/d)</td></tr>
  <tr><td>ETc</td><td>actual crop ET = T + E (mm/d)</td></tr>
  <tr><td>T, E</td><td>transpiration, soil evaporation (mm/d)</td></tr>
  <tr><td>Kcb, Ke, Ks</td><td>basal, evaporation, stress coefficients (–)</td></tr>
  <tr><td>Dr, De</td><td>root-zone / surface-layer depletion (mm)</td></tr>
  <tr><td>TAW, RAW</td><td>total / readily available water (mm)</td></tr>
  <tr><td>TEW, REW</td><td>totally / readily evaporable water (mm)</td></tr>
  <tr><td>Zr, fc, h</td><td>root depth (m), canopy cover (–), height (m)</td></tr>
  <tr><td>Sr, Ss</td><td>root-zone / subsoil water storage (mm)</td></tr>
</table>

<div class="docs-note">Yield is the FAO-33 water-production function
<code>Y = Ymax·(1 − Ky·(1 − T/Tx))</code> using the seasonal transpiration
ratio, which is a water-limited estimate, not a full yield reduction model.</div>

<p>Reference: Allen, Pereira, Raes &amp; Smith (1998), FAO Irrigation and
Drainage Paper 56.</p>
`,
};
