<!-- Copyright (c) August 2026 Andres Patrignani. -->
# Building a new tool

How the app is put together, and the shortest path to adding a tool of your
own. Read this once; then copy `tools/single-season/` and start.

## The app in one paragraph

A single page (`index.html`) with no build step, plain ES modules, one design
system, one shared control library, and one **mode** (tool) per folder under
`tools/`. Every mode feeds the same water-balance engine in `core/` and shows
its results in the same shell. Nothing is bundled or transpiled — save a file,
reload the browser.

```
index.html               the only page; loads styles + app/main.js
core/                    the FAO-56 engine — tested, shared among all the tools
app/main.js              top bar, hash router, mode lifecycle  ← add your route here
app/brand.js             the app's display name
app/docs.js              the "? Docs" drawer
app/geeSession.js        Earth Engine sign-in persistence (only the GEE tools use it)
styles/tokens.css        every colour/size as a CSS variable
styles/base.css          reset + app frame (top bar, workbench, docs drawer)
styles/components.css    groups, control rows, buttons, cards, tables, etc.
ui/                      shared widgets
ui/panels/               shared input panels: weather, soil, crop, management, options
tools/<tool>/            one folder per tool
kansas_north_west*.csv   bundled 46-year example weather record (raw, and with ETo)
```

## Add a tool in six steps

1. **Make the folder.** `tools/my-tool/index.js` and `tools/my-tool/docs.js`.
   Split further (`logic.js`, `charts.js`) only when the file gets long; keep
   any pure calculation in its own module so it can be run under Node.

2. **Export the mode contract** from `index.js`:

   ```js
   import { DOCS } from './docs.js';
   export default {
     title: 'My Tool',   // top bar + browser tab
     docs: DOCS,         // { title, html } for the Docs drawer
     create,             // () => root element — called ONCE, kept alive
     onShow,             // optional; called every time the tool is shown
   };
   ```

   `create()` runs once; the element is hidden/shown as the user navigates,
   so loaded data and results survive. Keep state in the closure — there is
   no global store. Use `onShow` only for things that need a visible layout
   (fitting a map, resizing a chart).

3. **Build on the workbench.** Every analysis tool uses the same two-part
   frame from `ui/workbench.js`:

   ```js
   const wb = createWorkbench({ inputsLabel: 'Inputs', outputsLabel: 'Outputs' });
   wb.sidebar.append(gWeather.el, gSoil.el, …);   // collapsible group()s
   wb.foot.append(runBar);                        // Run button + status
   wb.inputs.append(inputCharts.el);              // left tab
   wb.outputs.append(resultsEl);                  // right tab
   return el('div', { class: 'view' }, wb.el);    // exactly one .view per tool
   ```

   Sidebar = compact controls; canvas = the room for charts. After a run:
   `wb.setOutputsEnabled(true); wb.showTab('outputs');`.

4. **Reuse the panels.** For a tool that takes weather/soil/crop/management,
   instantiate the shared panels (`ui/panels/*.js`) — each returns `{ el,
   get…() }` shaped exactly the way `core/engine.js` wants its inputs. Don't
   invent a parallel input format.

5. **Register the route** in `app/main.js` `ROUTES`:

   ```js
   { path: 'my-tool', label: 'My Tool', loader: () => import('../tools/my-tool/index.js') },
   ```

   and add a card in `tools/home.js` `CARDS` (href `#/my-tool`, an inline SVG
   glyph, one-sentence description). That is the entire wiring.

6. **Write the docs for the user, not for yourself.** `docs.js` exports
   `DOCS = { title, html }` (trusted static HTML). Say what the tool does,
   what it needs, what the outputs mean and their caveats. Implementation
   notes, TODOs and "verify this" belong in code comments or your notes.

## What you get for free (`ui/`)

| module | gives you |
|---|---|
| `dom.js` | `el(tag, attrs, …children)` — the element builder. Skips `null`/`false` children, so `cond ? el(…) : null` is fine **inside `el()`**. (Native `node.append(null)` renders the text "null" — use an `if`.) |
| `components.js` | `group`, `ctrl` (label→control row), `readout`, `numInput`/`textInput`/`dateInput`/`selectInput`, `checkbox`/`toggle`/`segmented`, `btn`, `metricsBar`, `dataTable`, `callout`, `openModal` |
| `workbench.js` | the sidebar + tabbed-canvas shell above |
| `plotly.js` | the ONLY module that talks to Plotly: `chartCard`, `plot`, `VIZ` palette, `linkZoom`. Never call `Plotly.*` directly. |
| `inputCharts.js` / `seasonCharts.js` | the standard weather-input charts and the standard chart set for one engine run |
| `curveEditor.js`, `multiSlider.js` | the draggable Kcb curve and the θ slider used by the crop/soil panels |
| `format.js`, `download.js`, `csv.js` | number/date formatting; CSV/JSON/binary download; CSV parsing |
| `weatherSchema.js` | the accepted weather column names + validation |

## Tools that need external libraries

Plotly is the only library loaded globally. Leaflet, Leaflet.draw, Google
Identity Services and the Earth Engine API are loaded **lazily, on first open,
by the tool that needs them** (see `ensureLibs()` in `tools/gee-collector/` and
`tools/field-scale/`). Follow that pattern: don't add `<script>` tags to
`index.html`, and don't add a library when a hundred lines of plain JavaScript
will do (`tools/field-scale/geotiff_writer.js` is a GeoTIFF writer for exactly
that reason).

If two tools are the same machinery with different data, write a factory:
`tools/field-scale/index.js` exports `createSpatialTool(config)`, and both Field
Scale and Mesoscale are one-line modules calling it.

## Rules that keep it maintainable

1. **Never fork `core/`.** If a tool needs something the engine computes
   internally, export it from `core/` so everyone gets it.
2. **Engine-shaped names everywhere.** UI state uses the exact field names
   `runModel` consumes (`Kcb_ini`, `L_dev`, `residue_cover` …). No mapping layers.
3. **Colours from `styles/tokens.css` and `VIZ` only.** The series order in
   `VIZ` is a colour-blind-safety property — append, never reshuffle.
4. **Charts through `ui/plotly.js` only**, so fonts, margins, hover and the
   modebar stay identical app-wide.
5. **Plain JavaScript.** `.map/.filter/.reduce` are welcome; deep
   optional-chaining chains, clever destructuring and ternary ladders are not
   when an `if` reads better. Comment the *why*, not the *what*.
6. **One `.view` per tool**, wrapping `wb.el` — the router toggles `hidden`
   on it. Charts and maps built while that view is hidden have no size:
   defer fitting until `onShow`/tab-show (both `ui/plotly.js` and the spatial
   results view already do this).
7. **The app's name lives in `app/brand.js` only.**

## Running locally

ES modules need http (not `file://`). Any static server works:

```bash
npx http-server -p 8123 -c-1 .
```

then open `http://localhost:8123`. There is no build step and no install.
Pure modules (`core/`, a tool's `logic.js`) can be exercised directly with
`node` for quick checks.
