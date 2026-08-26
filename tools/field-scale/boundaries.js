/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * tools/field-scale/boundaries.js — pick a US county / state / ASD as the AOI.
 *
 * A self-contained add-on for the spatial tools (Field Scale + Mesoscale): it
 * lazily fetches the boundary GeoJSONs in assets/, offers a Level → State →
 * Feature picker, and hands the chosen feature's outer rings + bounding box
 * back to the tool, which loads them exactly like a drawn or uploaded polygon.
 *
 * Deliberately isolated so the whole feature can be removed by deleting this
 * file plus the small "Region boundary" block in index.js. No Earth Engine and
 * no model code here — only geometry and a tiny picker UI.
 *
 * NOTE on size: the sampled grid is always the AOI *bounding box* (that is what
 * Earth Engine receives), so a large county/state/ASD is a large request; the
 * grid-resolution selector trades detail for area to keep it under the pixel
 * budget. The polygon itself only masks output pixels after the data returns.
 */

import { el } from '../../ui/dom.js';
import { ctrl, selectInput, callout } from '../../ui/components.js';

/* Numeric state FIPS → USPS abbreviation (counties carry STATEFP, ASDs STATE). */
const FIPS = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT',
  '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL',
  '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD',
  '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE',
  '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
  '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV',
  '55': 'WI', '56': 'WY',
};

const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const abbr = (fips) => FIPS[String(fips).padStart(2, '0')] || String(fips);

/**
 * Level registry. Each level knows its asset URL and how to read one feature
 * into { group, label, sort } — `group` is the state a feature filters under
 * (null for the States level, which needs no filter). Adding a level is a new
 * entry here plus (optionally) an id in a tool's boundaryLevels.
 */
const LEVELS = {
  counties: {
    id: 'counties',
    label: 'County',
    filterLabel: 'State',
    url: new URL('../../assets/conus_counties.geojson', import.meta.url),
    read(p) {
      const km2 = p.ALAND ? Math.round(p.ALAND / 1e6) : null;   /* land area for spotting big ones */
      return {
        group: abbr(p.STATEFP),
        label: `${p.NAMELSAD || p.NAME}${km2 != null ? ` — ${km2.toLocaleString()} km²` : ''}`,
        sort: (p.NAME || p.NAMELSAD || '').toLowerCase(),
      };
    },
  },
  asd: {
    id: 'asd',
    label: 'Ag. Statistics District',
    filterLabel: 'State',
    url: new URL('../../assets/asd_2012_500K.geojson', import.meta.url),
    read(p) {
      const code = String(p.STASD_A || '').padStart(4, '0');
      const district = code.slice(2) || String(p.STASD_N || '');
      return { group: abbr(p.STATE), label: `ASD ${district}`, sort: district };
    },
  },
  states: {
    id: 'states',
    label: 'State',
    filterLabel: null,                                     /* the feature IS the state */
    url: new URL('../../assets/conus_states.geojson', import.meta.url),
    read(p) {
      const name = titleCase(p.State_Name);
      return { group: null, label: `${name} (${p.State_Code})`, sort: name.toLowerCase() };
    },
  },
};

/* One outer ring per polygon (holes dropped), as Leaflet [lat,lng] pairs. */
function outerRings(geom) {
  const polys = geom.type === 'MultiPolygon' ? geom.coordinates
    : geom.type === 'Polygon' ? [geom.coordinates] : [];
  const rings = [];
  for (const poly of polys) {
    const outer = poly[0];
    if (outer && outer.length >= 3) rings.push(outer.map(([lng, lat]) => [lat, lng]));
  }
  return rings;
}

function bboxOfRings(rings) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const r of rings) for (const [lat, lng] of r) {
    if (lng < west) west = lng; if (lng > east) east = lng;
    if (lat < south) south = lat; if (lat > north) north = lat;
  }
  return { west, south, east, north };
}

/* Fetch + parse a level's GeoJSON once, then index its features by state group.
   Cached on the level object so re-opening the dropdown is instant. */
async function loadLevel(level) {
  if (level._index) return level._index;
  const res = await fetch(level.url);
  if (!res.ok) throw new Error(`Could not load ${level.label} boundaries (${res.status}).`);
  const gj = await res.json();
  const byGroup = new Map();                               /* groupKey → [{label, sort, feature}] */
  for (const f of gj.features || []) {
    if (!f.geometry) continue;
    const meta = level.read(f.properties || {});
    const key = meta.group || '';                          /* '' = single implicit group (States) */
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push({ label: meta.label, sort: meta.sort, feature: f });
  }
  for (const list of byGroup.values()) list.sort((a, b) => String(a.sort).localeCompare(String(b.sort), undefined, { numeric: true }));
  level._index = byGroup;
  return byGroup;
}

/**
 * The picker UI. Renders Level, an optional State filter, and a Feature select
 * into `.el` (rows the caller drops into a group body). Calls
 * onPick({ rings, bbox, label }) when a feature is chosen.
 */
export function createBoundaryPicker({ onPick, levels = ['counties', 'asd', 'states'] } = {}) {
  const status = el('div', { class: 'hint', style: { marginTop: '0.4rem' } },
    'Pick a boundary to load it as the area of interest.');
  const setStatus = (msg, kind) => { status.innerHTML = ''; status.append(kind ? callout(kind, msg) : msg); };

  const levelSel = selectInput({
    options: levels.map((id) => ({ value: id, label: LEVELS[id].label })),
    value: levels[0], onChange: onLevel,
  });
  const stateSel = selectInput({ options: [{ value: '', label: '—' }], onChange: onState });
  const featureSel = selectInput({ options: [{ value: '', label: '—' }], onChange: onFeature });

  const stateRow = ctrl('State', stateSel.el);
  const featureRow = ctrl('Region', featureSel.el);

  let current = null;                                      /* the loaded level's index (Map) */
  let currentGroupList = [];                               /* features shown in featureSel */
  let loadSeq = 0;                                          /* guards against out-of-order level loads */

  async function onLevel(id) {
    const level = LEVELS[id];
    const seq = ++loadSeq;
    stateRow.hidden = !level.filterLabel;
    setStatus(`Loading ${level.label} boundaries…`);
    featureSel.setOptions([{ value: '', label: '—' }], '');
    let index;
    try {
      index = await loadLevel(level);
    } catch (e) { if (seq === loadSeq) { current = null; setStatus(e.message, 'error'); } return; }
    /* A slower earlier load (e.g. the 17 MB counties fetch) must not clobber a
       newer level the user has since selected. */
    if (seq !== loadSeq) return;
    current = index;

    if (level.filterLabel) {
      const groups = [...current.keys()].filter(Boolean).sort();
      stateSel.setOptions([{ value: '', label: 'Select a state…' }, ...groups.map((g) => ({ value: g, label: g }))], '');
      featureSel.setOptions([{ value: '', label: '—' }], '');
      currentGroupList = [];
      setStatus('Choose a state, then a region.');
    } else {
      currentGroupList = current.get('') || [];
      fillFeatures(currentGroupList, 'Select a state…');
      setStatus('Choose a region.');
    }
  }

  function onState(g) {
    currentGroupList = (current && current.get(g)) || [];
    fillFeatures(currentGroupList, currentGroupList.length ? 'Select a region…' : 'No regions');
  }

  function fillFeatures(list, placeholder) {
    featureSel.setOptions(
      [{ value: '', label: placeholder }, ...list.map((it, i) => ({ value: String(i), label: it.label }))], '');
  }

  function onFeature(v) {
    if (v === '' || !currentGroupList[+v]) return;
    const it = currentGroupList[+v];
    const rings = outerRings(it.feature.geometry);
    if (!rings.length) { setStatus('That feature has no usable polygon.', 'warn'); return; }
    const bbox = bboxOfRings(rings);
    setStatus(`Loaded ${it.label}.`);
    onPick && onPick({ rings, bbox, label: it.label });
  }

  const root = el('div', {}, ctrl('Level', levelSel.el), stateRow, featureRow, status);
  stateRow.hidden = true;                                  /* until a level is primed */

  /* Lazy: the boundary GeoJSONs are large, so nothing is fetched until the
     caller first reveals the picker (e.g. on opening the group). Idempotent. */
  let primed = false;
  function load() { if (primed) return; primed = true; onLevel(levelSel.get()); }

  return { el: root, load };
}
