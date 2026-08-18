<!-- Copyright (c) August 2026 Andres Patrignani. -->
# DualKc Studio

**DualKc Studio** is a free, browser-based suite of tools for modeling the soil
water balance with the FAO-56 dual crop coefficient method (Allen et al., 1998).
Everything runs locally in your browser — no install, no accounts, and your
weather data never leaves your machine.

🌐 **[dualkc.studio](https://dualkc.studio)**

## Tools

### Time series
- **Single Season** — One crop, one site, one season: the daily water balance, stress, and a water-limited yield estimate for a chosen planting date.
- **Probabilistic & Scenario** — Run the same season through every historical year — or blend this year's observed weather with historical continuations — to see the range of likely outcomes.
- **Crop Rotation** — Stitch crops, cover crops, and fallow periods into one continuous multi-year water balance with fallow-efficiency diagnostics.
- **Cover Crop Termination** — Compare termination dates for a cover crop against a fixed cash-crop planting date, across every historical year, to see how much soil water each option leaves behind.

### Spatial
- **Field Scale** — The engine run per pixel across a field at 30 m. Trace the boundary, pull POLARIS soil, Landsat canopy and GRIDMET weather from Earth Engine, then map available water, ETc and stress day by day.
- **Mesoscale** — The same per-pixel engine on a 4 km grid for large watersheds and regions — VIIRS canopy over SoilGrids soil, with per-pixel GRIDMET weather.

### Data & Inputs
- **ETo Calculator** — Compute daily reference ET from a weather file by whichever method your variables support (Penman-Monteith, Hargreaves, and more), then download the CSV with an ETo column appended.
- **Soil Water Limits** — Estimate wilting point and field capacity from texture and organic matter by several methods (FAO-56, Saxton-Rawls, van Genuchten), and compare how much they disagree.
- **GEE Data Collector** — Pick a point on a map and pull GRIDMET weather plus a MODIS vegetation index from Google Earth Engine into a ready-to-use CSV — column names and all.
- **Open-Meteo Weather** — Download a ready-to-use daily weather file for any point on Earth from the free Open-Meteo archive — precipitation and FAO-56 reference ET included, no account needed.

## For developers

This is a plain static website — no build step, no framework. Serve the folder
with any static file server and open it in a browser:

```bash
npx http-server -p 8123 -c-1 .
```

See **[TOOLS.md](TOOLS.md)** for how the app is put together and a step-by-step
guide to adding a new tool.

---

Built by the Soil Water Process Lab, Department of Agronomy, Kansas State
University. Released under the MIT License.
