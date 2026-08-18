/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/cover-crop-termination/docs.js — documentation for the Cover Crop
 * Termination Timing mode.
 */

export const DOCS = {
  title: 'Cover Crop Termination',
  html: `
<p>Answers one question: <strong>when should a cover crop be terminated</strong>
so the following cash crop has enough soil water at planting? Cover-crop and
cash-crop planting dates stay fixed for a run; only the termination date
changes between the options being compared.</p>

<h3>Workflow</h3>
<ol>
  <li><strong>Weather &amp; site</strong> — the standard daily CSV, same as
      every other mode.</li>
  <li><strong>Cover crop</strong> — pick a preset (or drag its Kcb curve) and
      its planting date.</li>
  <li><strong>Scenarios to compare</strong> — up to three termination dates,
      plus an optional "no cover crop" baseline, and the fixed cash-crop
      planting date.</li>
  <li><strong>Fallow after termination</strong> — the residue cover (a percent,
      0–100, that lowers evaporation) and curve number (runoff) for the gap
      between termination and cash planting (and for the baseline's full fallow
      window).</li>
  <li><strong>Run comparison</strong> — every historical occurrence of the
      cover crop's planting month/day is replayed once per option.</li>
</ol>

<h3>Dates are month-day only</h3>
<p>Every date here is a <em>month and day</em> with no year — the year is
meaningless in a historical replay, so the pickers don't carry one. Ordering
is resolved relationally: the cover-crop planting is the anchor, and for
each option the tool finds every historical year the record contains that
planting month-day, then walks forward to the next occurrence of the
termination month-day, then the next occurrence of the cash-planting
month-day. The cash crop is therefore always after termination, which is
always after cover planting — and an overwintering cover crop (planted in
September, terminated the following April) rolls into the next calendar year
automatically, with nothing extra to set.</p>

<h3>What's being compared</h3>
<p>For each option and each historical year, the tool stitches a cover-crop
block (terminated on the chosen date, Kcb ramping to zero over 5 days) with
a fallow block covering the rest of the gap to cash planting, and runs it
through the same engine as every other mode — one continuous water balance,
no separate "cover crop" physics. The baseline option replaces the cover
crop entirely with bare/residue fallow for the same window, so the
comparison is apples-to-apples.</p>

<p>The result reported per year is the <strong>whole-profile available
water</strong> (root zone + subsoil, as a fraction of total available water)
on the cash-planting date — the number that determines whether the cash
crop starts with a full profile or a depleted one.</p>

<h3>Reading the dashboard</h3>
<table>
  <tr><th>chart</th><th>shows</th></tr>
  <tr><td>Probability by option</td><td>share of historical years each option
      reached the chosen available-water threshold by cash planting.</td></tr>
  <tr><td>Full risk comparison</td><td>the complete exceedance curve for each
      option — not just one threshold, the whole distribution of outcomes.</td></tr>
  <tr><td>Inspect an option</td><td>every simulated year for one option (faint
      background lines), with the driest (P10), typical (P50), and wettest
      (P90) years highlighted so you can see how a dry vs. wet year actually
      played out.</td></tr>
</table>

<div class="docs-note">Sample size matters: an option needs a reasonable
number of historical years (10+) before its probability is more than a rough
guide. A warning appears when fewer years are available, or when a
termination/cash-planting combination runs some years past the end of the
weather record (those years are silently excluded, and the count is shown).</div>

<p>Reference: Allen et al. (1998) FAO-56.</p>
`,
};
