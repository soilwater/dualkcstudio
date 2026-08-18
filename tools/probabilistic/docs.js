/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/probabilistic/docs.js — documentation shown in the drawer while
 * the Probabilistic & Scenario mode is active. Trusted static HTML.
 */

export const DOCS = {
  title: 'Probabilistic & Scenario',
  html: `
<p>Runs the same FAO-56 season many times — once per historical year — and
summarizes the spread. Two questions, two analysis types:</p>

<h3>Probabilistic</h3>
<p><em>"Given my planting date, soil, crop, and management, what range of
outcomes does this climate produce?"</em> Pick a planting month and day; the
season is planted on that month-day in <strong>every</strong> year of the
loaded record, and each complete year becomes one ensemble member. Years
whose weather does not cover the full season are skipped. At least ten years
are recommended for percentiles to mean much.</p>

<h3>Scenario</h3>
<p><em>"My season is underway — how might it finish?"</em> Pick the real
planting date and the date weather has been observed until. Days from
planting to the cutoff are taken from the record as-is; the rest of the
season is filled in by each candidate year's weather for the same calendar
window, re-dated to follow the observed days, and the full stitched season
is re-run through the model (so soil water carries over the splice
correctly). Candidate years are either <strong>All years</strong> in the
record or the top-N <strong>Analog years</strong>.</p>

<h3>Analog ranking</h3>
<p>Each candidate year is scored by comparing its cumulative curve of the
chosen variable (ETo or precipitation) over the observed window against the
current season's. Higher score = more similar; the top N become the
ensemble. Methods:</p>
<table>
  <tr><th>method</th><th>one line</th></tr>
  <tr><td>NSE</td><td>Nash-Sutcliffe efficiency: 1 minus the error variance
      relative to the reference curve's own variance (1 = identical).</td></tr>
  <tr><td>Cumulative</td><td>negative mean absolute gap between the two
      cumulative curves (0 = identical, more negative = further apart).</td></tr>
  <tr><td>Pearson</td><td>linear correlation of the two curves — matches
      shape/timing, ignores offset and scale.</td></tr>
  <tr><td>Cosine</td><td>angle between the curves as vectors — matches
      proportional shape, insensitive to overall magnitude.</td></tr>
</table>

<h3>Reading the fan charts</h3>
<p>All ensemble charts share a <strong>days after planting</strong> axis,
because members span different calendar years (drag to zoom; the charts pan
together). In probabilistic mode the shaded bands are the P10–P90 (light)
and P25–P75 (darker) percentile envelopes computed day by day across
members, with the median line on top. A wide band means the outcome hinges
on the weather; a narrow band means it is largely decided by soil, crop, and
management. In scenario mode every member is drawn as a faint line, with the
P25–P75 band and median over them, and the <strong>observed</strong> portion
of the season overlaid as a thick dark line — members only diverge after the
cutoff.</p>

<h3>Yield distribution</h3>
<p>A histogram of the FAO-33 water-limited yield estimate
(<code>Y = Ymax·(1 − Ky·(1 − T/Tx))</code>) of each member, with the median
marked. It appears only when the crop preset defines an attainable yield
(Ymax); it is a water-limitation screen, not a full crop model.</p>

<h3>Ensemble CSV</h3>
<p>One row per member-day, long format: <code>year</code> (the member's
source year), <code>dap</code> (day after planting, 1-based),
<code class="var">date</code> (calendar date of that member's run; in scenario mode the
continuation is re-dated to follow the observed season), then daily
<code>ETo, ETc, T, E, prcp, irrig, Dr, Ks</code> in the model's usual units
(mm and dimensionless coefficients). Filter by <code>year</code> to recover
any single member's season.</p>

<div class="docs-note">The metric tiles report medians across members
(seasonal ETc, transpiration, precipitation, irrigation) plus the yield
median and interquartile range — a compact summary of the same spread the
charts show in full.</div>

<p>Reference: Allen, Pereira, Raes &amp; Smith (1998), FAO Irrigation and
Drainage Paper 56.</p>
`,
};
