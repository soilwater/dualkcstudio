/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * weatherSchema.js — the ONE place that defines the app's standard weather
 * column names, plus a single check + modal. Every tool that loads a file
 * validates against this, so nothing downstream ever has to guess at or map
 * alternate header spellings: a file either uses the standard names or the
 * user is shown exactly what to rename.
 *
 * The required set for the full water-balance tools is core's REQUIRED_COLS
 * (single source of truth); a tool that needs less (e.g. the ETo calculator,
 * which only needs a date) passes its own smaller required list.
 */

import { REQUIRED_COLS } from '../core/weather.js';
import { el } from './dom.js';
import { openModal, callout } from './components.js';

/** Every column name the app recognises (lowercase), in display order. */
const KNOWN_COLUMNS = [
  { key: 'date', label: 'Date', unit: 'YYYY-MM-DD' },
  { key: 'tmin', label: 'Min air temperature', unit: '°C' },
  { key: 'tmax', label: 'Max air temperature', unit: '°C' },
  { key: 'rmin', label: 'Min relative humidity', unit: '%' },
  { key: 'rmax', label: 'Max relative humidity', unit: '%' },
  { key: 'srad', label: 'Solar radiation', unit: 'MJ m⁻² d⁻¹' },
  { key: 'wspd', label: 'Wind speed at 2 m', unit: 'm s⁻¹' },
  { key: 'prcp', label: 'Precipitation', unit: 'mm' },
  { key: 'eto', label: 'Reference ET — supply to skip computing it', unit: 'mm d⁻¹' },
  { key: 'vpd', label: 'Vapour-pressure deficit', unit: 'kPa' },
  { key: 'rn', label: 'Net radiation', unit: 'MJ m⁻² d⁻¹' },
  { key: 'kcb_obs', label: 'Observed basal crop coefficient', unit: '–' },
  { key: 'latitude', label: 'Latitude', unit: '°N' },
  { key: 'longitude', label: 'Longitude', unit: '°E' },
  { key: 'elevation', label: 'Elevation', unit: 'm' },
];

const KNOWN_KEYS = new Set(KNOWN_COLUMNS.map(c => c.key));

/** First non-empty line's comma-split header cells, lowercased & trimmed. */
function headerKeys(csvText) {
  const first = csvText.split(/\r?\n/).find(l => l.trim().length) || '';
  return first.split(',').map(h => h.trim().toLowerCase());
}

/**
 * Checks a file's headers against the standard vocabulary.
 * @returns {{ok, missing, unknown, keys}} — `missing` = required names absent,
 *   `unknown` = header names outside the vocabulary.
 */
export function checkColumns(csvText, requiredKeys = REQUIRED_COLS) {
  const keys = headerKeys(csvText);
  const present = new Set(keys);
  const missing = requiredKeys.filter(k => !present.has(k));
  const unknown = keys.filter(k => k && !KNOWN_KEYS.has(k));
  return { ok: missing.length === 0 && unknown.length === 0, missing, unknown, keys };
}

function referenceTable(requiredKeys) {
  const req = new Set(requiredKeys);
  return el('div', { class: 'tablewrap', style: { maxHeight: '20rem' } },
    el('table', { class: 'table' },
      el('thead', {}, el('tr', {}, el('th', {}, 'column'), el('th', {}, 'meaning'), el('th', {}, ''))),
      el('tbody', {}, KNOWN_COLUMNS.map(c => el('tr', {},
        el('td', {}, el('code', {}, c.key)),
        el('td', {}, `${c.label}${c.unit ? ` · ${c.unit}` : ''}`),
        el('td', {}, req.has(c.key) ? el('span', { class: 'tag tag--ok' }, 'req') : el('span', { class: 'hint' }, 'opt')),
      ))),
    ),
  );
}

/** Opens the shared "here are the standard names" modal for a failed check. */
export function showColumnModal(result, requiredKeys = REQUIRED_COLS) {
  const body = el('div', {});
  if (result.missing.length) {
    body.append(callout('error', `Missing required column${result.missing.length > 1 ? 's' : ''}: ${result.missing.join(', ')}. The file can't be used until these are present.`));
  }
  if (result.unknown.length) {
    body.append(callout('warn', `Not a standard column name: ${result.unknown.join(', ')}. If one is a renamed weather variable (say a temperature column not called “tmin”/“tmax”), rename it to match the list below so the tools recognise it.`));
  }
  if (result.missing.includes('eto')) {
    const tip = callout('warn', '');
    tip.textContent = '';
    tip.append('Have raw weather but no ETo? Compute it in the ', el('a', { href: '#/eto-calculator' }, 'ETo Calculator'), ', then upload the file it gives you back.');
    body.append(tip);
  }
  body.append(
    el('p', { class: 'hint', style: { margin: '0.7rem 0 0.4rem' } },
      'The app uses these exact lowercase column names. Rename your file’s headers to match — no other spellings are recognised.'),
    referenceTable(requiredKeys),
  );
  return openModal('Weather CSV columns', body);
}
