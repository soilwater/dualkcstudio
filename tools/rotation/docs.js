/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/rotation/docs.js — documentation for the Crop Rotation mode.
 */

export const DOCS = {
  title: 'Crop Rotation',
  html: `
<p>Runs a multi-year sequence of crops, cover crops, fallow periods and
alfalfa stands as <strong>one continuous soil water balance</strong>. Nothing
is reset at a block boundary: the water left by one crop is what the next
one (or the fallow) starts with, and roots grow or shrink day by day. This is
the mode for asking how much rain a fallow actually stores, or what a cover
crop costs the following cash crop.</p>

<h3>Workflow</h3>
<ol>
  <li><strong>Weather</strong> — the same ETo-complete CSV as the other model
      tools: <code>date, prcp, eto</code> required, with <code class="var">wspd</code> and
      <code class="var">rmin</code> optional for the wind/humidity corrections. Only raw
      weather? Run it through the ETo Calculator first.</li>
  <li><strong>Build the rotation</strong> — load a preset or add components.
      Drag rows to reorder, click a row to edit it, × removes it. The list
      defines <em>one cycle</em>; the simulation repeats it.</li>
  <li><strong>Simulation window</strong> — a start date and the number of
      cycles. The panel shows how many full cycles fit the record.</li>
  <li><strong>Run rotation</strong> — the whole run is a single engine call.</li>
</ol>

<h3>Block types</h3>
<table>
  <tr><th>type</th><th>what it is</th></tr>
  <tr><td>Crop</td><td>FAO-56 four-stage Kcb curve (drag the handles), root
      growth to Zr max, canopy height, depletion p, residue cover and curve
      number. <em>Terminate before maturity</em> turns a crop into a cover
      crop: Kcb ramps to zero at the termination day, then the block ends
      with a residue period.</td></tr>
  <tr><td>Fallow</td><td>Bare (Kcb 0) or weedy (small Kcb) soil for a fixed
      duration. A shallow standing root zone (evaporation layer + 0.20 m)
      lets evaporation and any weeds draw on the topsoil. Residue cover
      reduces evaporation; the fallow's own curve number governs runoff.</td></tr>
  <tr><td>Alfalfa</td><td>Perennial multi-cut stand: within each cutting
      interval Kcb lags, rises linearly to the peak, holds, then is cut. Roots
      grow only in the establishment year; an optional rest period follows the
      last cut at a low but non-zero Kcb.</td></tr>
</table>

<h3>Rainfed by design</h3>
<p>Rotation runs are rainfed: the analysis is about how the sequence uses
precipitation, and irrigation would mask exactly that. Use Single Season for
irrigation scheduling questions.</p>

<h3>Summary indices</h3>
<table>
  <tr><th>index</th><th>formula</th><th>reads as</th></tr>
  <tr><td>SPSI</td><td>1 − E<sub>fallow</sub> / P<sub>fallow</sub></td>
      <td>share of fallow-period rain not lost to evaporation (fallow storage
      efficiency; Farahani et al. 1998, Eq. 1)</td></tr>
  <tr><td>SPUI</td><td>1 − E<sub>fallow</sub> / P<sub>total</sub></td>
      <td>share of all rain not lost during fallow (system-level; Eq. 2)</td></tr>
  <tr><td>PPUE</td><td>T / P<sub>total</sub></td>
      <td>share of rain converted to transpiration — the productive part</td></tr>
  <tr><td>E / P</td><td>E / P<sub>total</sub></td><td>share of rain lost to soil evaporation</td></tr>
</table>
<p>Typical dryland Great Plains fallow storage efficiencies are 15–35 %; a
long summer fallow after wheat sits at the low end.</p>

<h3>Charts</h3>
<ul>
  <li><strong>Cycle timeline</strong> — the stitched Kcb curve of one cycle,
      colored by block. It updates live as you edit.</li>
  <li><strong>Rotation wheel</strong> — one revolution is one cycle: the
      outer ring shows the components (block colours), the middle ring the
      calendar months from the start date, the inner ring the rotation year.
      The centre shows the share of the cycle under a crop.</li>
  <li>The daily result charts are the same set as Single Season, over the
      whole run — drag to zoom into any season; all charts pan together.</li>
</ul>

<div class="docs-note">Yield is not reported for rotations: a single T/Tx
ratio across several crops is meaningless. Export the daily CSV (it carries a
<code>block</code> column) and compute per-crop yield from each crop's own
window if needed.</div>

<p>References: Allen et al. (1998) FAO-56; Farahani, Peterson &amp; Westfall
(1998) Dryland cropping intensification: a fundamental solution to efficient
use of precipitation. Adv. Agron. 64:197–223.</p>
`,
};
