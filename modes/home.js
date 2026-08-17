/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * modes/home.js — landing view: what the app is, and the mode cards.
 */

import { APP_TAGLINE, brandMark } from '../app/brand.js';
import { isReleased } from '../app/release.js';
import { el } from '../ui/dom.js';

const glyph = {
  season: `<svg viewBox="0 0 120 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M6 44 L28 44 L48 14 L82 14 L114 40" fill="none" stroke="#2a78d6" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="28" cy="44" r="4" fill="#fff" stroke="#2a78d6" stroke-width="2"/>
    <circle cx="48" cy="14" r="4" fill="#fff" stroke="#2a78d6" stroke-width="2"/>
    <circle cx="82" cy="14" r="4" fill="#fff" stroke="#2a78d6" stroke-width="2"/>
    <circle cx="114" cy="40" r="4" fill="#fff" stroke="#2a78d6" stroke-width="2"/>
  </svg>`,
  prob: `<svg viewBox="0 0 120 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M6 46 C40 44 70 34 114 8 L114 28 C80 44 40 50 6 50 Z" fill="#cde2fb"/>
    <path d="M6 48 C42 46 74 40 114 18" fill="none" stroke="#1c5cab" stroke-width="2.5"/>
  </svg>`,
  rot: `<svg viewBox="0 0 120 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M4 44 L14 44 L22 20 L38 20 L46 44 L58 44 L66 28 L80 28 L88 44 L96 44 L102 32 L112 32 L116 44" fill="none" stroke="#1baf7a" stroke-width="2.5" stroke-linejoin="round"/>
    <rect x="14" y="50" width="32" height="3" rx="1.5" fill="#eda100"/>
    <rect x="58" y="50" width="30" height="3" rx="1.5" fill="#1baf7a"/>
    <rect x="96" y="50" width="20" height="3" rx="1.5" fill="#e87ba4"/>
  </svg>`,
  spatial: `<svg viewBox="0 0 120 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    ${[0, 1, 2, 3, 4, 5, 6, 7].map(i => {
      const c = ['#cde2fb', '#9ec5f4', '#6da7ec', '#2a78d6', '#9ec5f4', '#1c5cab', '#6da7ec', '#cde2fb'][i];
      const x = 8 + (i % 4) * 27, y = 4 + Math.floor(i / 4) * 25;
      return `<rect x="${x}" y="${y}" width="24" height="22" rx="3" fill="${c}"/>`;
    }).join('')}
  </svg>`,
  /* Cover crop Kcb rising, cut short by an earlier (dashed) or later (solid)
     termination, then the cash crop starting on its fixed planting date. */
  termination: `<svg viewBox="0 0 120 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M6 48 C14 46 22 34 34 24 C40 19 46 17 52 16" fill="none" stroke="#1baf7a" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="30" y1="10" x2="30" y2="48" stroke="#eda100" stroke-width="2" stroke-dasharray="4 3"/>
    <line x1="52" y1="10" x2="52" y2="48" stroke="#e87ba4" stroke-width="2.5"/>
    <path d="M52 48 L70 48" fill="none" stroke="#9aa2ae" stroke-width="2.5" stroke-dasharray="1 5" stroke-linecap="round"/>
    <path d="M70 48 C78 46 86 32 100 24 C106 21 110 20 114 20" fill="none" stroke="#2a78d6" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="70" cy="48" r="3.5" fill="#2a78d6"/>
  </svg>`,
  /* Sun above a crop canopy, water vapour rising: reference ET. */
  eto: `<svg viewBox="0 0 120 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="26" cy="18" r="8" fill="#eda100"/>
    <g stroke="#eda100" stroke-width="2" stroke-linecap="round">
      <line x1="26" y1="4" x2="26" y2="7"/><line x1="26" y1="29" x2="26" y2="32"/>
      <line x1="12" y1="18" x2="15" y2="18"/><line x1="37" y1="18" x2="40" y2="18"/>
      <line x1="16" y1="8" x2="18" y2="10"/><line x1="34" y1="26" x2="36" y2="28"/>
      <line x1="36" y1="8" x2="34" y2="10"/><line x1="18" y1="26" x2="16" y2="28"/>
    </g>
    <path d="M52 50 C58 44 62 44 66 50 C70 44 74 44 78 50 C82 44 86 44 90 50 C94 44 98 44 102 50 C106 44 110 44 114 50" fill="none" stroke="#1baf7a" stroke-width="2.5" stroke-linecap="round"/>
    <g fill="none" stroke="#6da7ec" stroke-width="2" stroke-linecap="round">
      <path d="M66 38 C63 34 69 30 66 26 C63 22 69 18 66 14"/>
      <path d="M84 38 C81 34 87 30 84 26 C81 22 87 18 84 14"/>
      <path d="M102 38 C99 34 105 30 102 26 C99 22 105 18 102 14"/>
    </g>
  </svg>`,
  soil: `<svg viewBox="0 0 120 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="16" y="8" width="88" height="40" rx="3" fill="none" stroke="#7a5c3e" stroke-width="2"/>
    <rect x="16" y="30" width="88" height="18" rx="0" fill="#cbb089" opacity="0.5"/>
    <line x1="16" y1="30" x2="104" y2="30" stroke="#1baf7a" stroke-width="2" stroke-dasharray="5 3"/>
    <line x1="16" y1="42" x2="104" y2="42" stroke="#e0663a" stroke-width="2" stroke-dasharray="5 3"/>
    <text x="108" y="33" font-size="7" fill="#1baf7a">FC</text>
    <text x="108" y="45" font-size="7" fill="#e0663a">WP</text>
  </svg>`,
  /* A globe and an arrow into a table: point data pulled from Earth Engine
     to CSV. */
  gee: `<svg viewBox="0 0 120 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="32" cy="28" r="20" fill="none" stroke="#2a78d6" stroke-width="2"/>
    <ellipse cx="32" cy="28" rx="9" ry="20" fill="none" stroke="#6da7ec" stroke-width="1.5"/>
    <line x1="12" y1="28" x2="52" y2="28" stroke="#6da7ec" stroke-width="1.5"/>
    <path d="M62 28 L80 28 M74 22 L80 28 L74 34" fill="none" stroke="#9aa2ae" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="86" y="12" width="28" height="32" rx="3" fill="#cde2fb" stroke="#2a78d6" stroke-width="2"/>
    <g stroke="#2a78d6" stroke-width="1.5">
      <line x1="86" y1="21" x2="114" y2="21"/><line x1="86" y1="29" x2="114" y2="29"/><line x1="86" y1="37" x2="114" y2="37"/>
      <line x1="97" y1="12" x2="97" y2="44"/>
    </g>
  </svg>`,
  /* A fine pixel grid trimmed to an irregular field outline: per-pixel
     modelling at field scale (finer tiles than Mesoscale). */
  field: `<svg viewBox="0 0 120 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    ${(() => {
      /* Each row: [firstCol, lastCol] of tiles present — a solid, hole-free
         shape with ragged edges and clipped corners. */
      const rows = [[3, 7], [2, 8], [1, 9], [1, 9], [2, 8]];
      const shades = ['#cde2fb', '#9ec5f4', '#6da7ec', '#9ec5f4', '#cde2fb', '#2a78d6'];
      const out = [];
      rows.forEach(([a, b], r) => {
        for (let c = a; c <= b; c++) {
          const x = 8 + c * 10.6, y = 3 + r * 10.4;
          out.push(`<rect x="${x}" y="${y}" width="9" height="9" rx="1" fill="${shades[(c * 5 + r * 3) % shades.length]}"/>`);
        }
      });
      return out.join('');
    })()}
  </svg>`,
};

const CARDS = [
  {
    href: '#/single-season', glyph: glyph.season, name: 'Single Season',
    desc: 'One crop, one site, one season: the daily water balance, stress, and a water-limited yield estimate for a chosen planting date.',
  },
  {
    href: '#/probabilistic', glyph: glyph.prob, name: 'Probabilistic & Scenario',
    desc: 'Run the same season through every historical year — or blend this year’s observed weather with historical continuations — to see the range of likely outcomes.',
  },
  {
    href: '#/rotation', glyph: glyph.rot, name: 'Crop Rotation',
    desc: 'Stitch crops, cover crops, and fallow periods into one continuous multi-year water balance with fallow-efficiency diagnostics.',
  },
  {
    href: '#/cover-crop-termination', glyph: glyph.termination, name: 'Cover Crop Termination',
    desc: 'Compare termination dates for a cover crop against a fixed cash-crop planting date, across every historical year, to see how much soil water each option leaves behind.',
  },
  {
    href: '#/eto-calculator', glyph: glyph.eto, name: 'ETo Calculator',
    desc: 'Compute daily reference ET from a weather file by whichever method your variables support (Penman-Monteith, Hargreaves, and more), then download the CSV with an ETo column appended.',
  },
  {
    href: '#/soil-limits', glyph: glyph.soil, name: 'Soil Water Limits',
    desc: 'Estimate wilting point and field capacity from texture and organic matter by several methods (FAO-56, Saxton-Rawls, van Genuchten), and compare how much they disagree.',
  },
  {
    href: '#/gee-collector', glyph: glyph.gee, name: 'GEE Data Collector',
    desc: 'Pick a point on a map and pull GRIDMET weather plus a MODIS vegetation index from Google Earth Engine into a ready-to-use CSV — column names and all.',
  },
  {
    href: '#/spatial', glyph: glyph.field, name: 'Field Scale',
    desc: 'The engine run per pixel across a field at 30 m. Trace the boundary, pull POLARIS soil, Landsat canopy and GRIDMET weather from Earth Engine, then map available water, ETc and stress day by day.',
  },
  {
    href: '#/mesoscale', glyph: glyph.spatial, name: 'Mesoscale',
    desc: 'The same per-pixel engine on a 4 km grid for large watersheds and regions — VIIRS canopy over SoilGrids soil, with per-pixel GRIDMET weather.',
  },
];

function create() {
  return el('div', { class: 'view view--doc' },
    el('div', { class: 'doc-inner' },
      el('div', { style: { maxWidth: '46rem' } },
        el('h1', { class: 'home-hero' }, brandMark()),
        el('p', { class: 'home-hero__tag' }, APP_TAGLINE),
        el('p', { style: { color: 'var(--ink-2)', marginTop: '0.6rem' } },
          'Every mode below runs the same tested water-balance engine — strict FAO-56 by default, with optional documented refinements. Each mode is just a different way of feeding the engine inputs and reading its outputs. Data stays in your browser; nothing is uploaded.'),
      ),
      el('div', { class: 'mode-cards' },
        CARDS.map(c => {
          /* Not public yet → a greyed, non-clickable "coming soon" teaser
             (the roadmap doubles as a preview of what's coming). */
          const soon = !isReleased(c.href.replace('#/', ''));
          return el('a', { class: `mode-card${soon ? ' is-disabled' : ''}`, href: soon ? null : c.href },
            el('div', { class: 'mode-card__glyph', html: c.glyph }),
            el('div', { class: 'mode-card__name' }, c.name,
              soon ? el('span', { class: 'badge' }, 'coming soon') : null),
            el('div', { class: 'mode-card__desc' }, c.desc),
          );
        }),
      ),
      el('p', { class: 'hint', style: { marginTop: '2.5rem' } },
        'Soil Water Process Lab · Department of Agronomy · Kansas State University — see About for credits and license.'),
    ),
  );
}

export default {
  title: 'Home',
  docs: {
    title: 'About',
    html: `
<p>A daily FAO-56 dual crop coefficient soil water balance (Allen et al.,
1998) that runs entirely in your browser — nothing you load is uploaded.
Every tool uses the same engine; they differ in what you give it and what
you get back.</p>

<h3>Which tool do I need?</h3>
<ul>
<li><strong>Single Season</strong> — one crop, one site, one planting date:
daily water balance, stress and a water-limited yield estimate.</li>
<li><strong>Probabilistic &amp; Scenario</strong> — the same season through
every historical year to see the range of outcomes; or blend this year's
observed weather with historical continuations for an in-season outlook.</li>
<li><strong>Crop Rotation</strong> — crops, cover crops and fallow strung into
one continuous multi-year balance.</li>
<li><strong>Cover Crop Termination</strong> — how much soil water each
termination date leaves for the following cash crop, across all years.</li>
<li><strong>ETo Calculator</strong> — add a reference-ET column to a weather
file that lacks one.</li>
<li><strong>Soil Water Limits</strong> — estimate wilting point and field
capacity from texture, and compare methods.</li>
<li><strong>GEE Data Collector</strong> — pull weather and a vegetation index
for one point from Google Earth Engine into a ready-to-use CSV.</li>
<li><strong>Field Scale</strong> — the balance run per 30 m pixel across a
field, from satellite and soil-map data (needs an Earth Engine account).</li>
<li><strong>Mesoscale</strong> — the same per-pixel balance on a 4 km grid
for large watersheds and regions.</li>
</ul>

<h3>Weather files</h3>
<p>The first four tools need a daily CSV with <code>date</code>,
<code>prcp</code> and <code>eto</code> (mm). Use the bundled NW Kansas
example to try things out, and the ETo Calculator if your file has no
<code>eto</code> column.</p>

<h3>Help on every screen</h3>
<p>The “? Docs” button always shows help for the tool you are in.</p>`,
  },
  create,
};
