/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/soil-limits/docs.js — documentation for the Soil Water Limits lookup.
 */

export const DOCS = {
  title: 'Soil Water Limits',
  html: `
<p>A lookup for the two limits of plant-available water — the <strong>lower
limit (wilting point)</strong> and the <strong>upper limit (field
capacity)</strong> — by USDA texture class and by source. Pick a class and a
source; the note under the values says exactly how they were derived. The
water balance is very sensitive to these two numbers, so it's worth seeing how
the sources differ.</p>

<p>Every source reports the same three numbers: one wilting point
(θ at −1500 kPa), one field capacity, and the available water capacity between
them (FC − WP). How field capacity is defined depends on the source — shown in
the note under the values. The retention-curve sources (Scott, Parker, Rosetta)
use the water held at −10 kPa, which recent evidence finds a better proxy for
field capacity than the traditional −33 kPa (Krueger &amp; Ochsner, 2024).</p>

<h3>Sources</h3>
<table>
  <tr><th>source</th><th>values</th></tr>
  <tr><td>FAO-56 Table 19</td><td>Class-mean FC and WP (Allen et al. 1998),
      mid-range of the tabulated bands. Nine classes.</td></tr>
  <tr><td>Saxton &amp; Rawls 2006</td><td>Pedotransfer regressions at the class
      centroid texture (2% organic matter).</td></tr>
  <tr><td>Scott et al. 2013</td><td>van Genuchten retention, Oklahoma Mesonet
      class averages. No sand/silt.</td></tr>
  <tr><td>Parker et al. 2022</td><td>van Genuchten retention, Kansas Mesonet
      class averages. Eight classes.</td></tr>
  <tr><td>Rosetta class average</td><td>van Genuchten retention, national
      Rosetta averages (Schaap et al. 2001). All 12 classes.</td></tr>
  <tr><td>Unit gradient 1 mm/day</td><td>A drainage-based alternative: field
      capacity where unit-gradient drainage K(θ) = 1 mm/day (van
      Genuchten-Mualem, Rosetta parameters).</td></tr>
</table>

<div class="docs-note">A source only lists the texture classes it sampled;
where it didn't, no value is shown (Rosetta covers all 12). These are mean /
class-representative values — for a specific field, measured retention data
beat any of them.</div>

<p>References: Allen et al. (1998) FAO-56; Saxton &amp; Rawls (2006); Scott
et al. (2013); Parker et al. (2022); Schaap et al. (2001); van Genuchten
(1980); Krueger &amp; Ochsner (2024), Soil Sci. Soc. Am. J.,
doi:10.1002/saj2.20733.</p>
`,
};
