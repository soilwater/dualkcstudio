/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * brand.js — the app's name and version. Everything the running app shows
 * derives from here. When these change, also update the three static files
 * browsers read before JS runs: index.html (<title> + apple-mobile-web-app-title),
 * manifest.webmanifest (name, short_name), and package.json (name, version).
 */

import { el } from '../ui/dom.js';

export const APP_NAME = 'DualKc Studio';
export const APP_TAGLINE = 'Soil water balance model';
export const APP_DOMAIN = 'dualkc.studio';
export const APP_REPO = 'https://github.com/soilwater/dualkcstudio';
export const APP_VERSION = '1.3.0';

/** The wordmark: "DualKc" in the neon accent, "Studio" muted. */
export function brandMark() {
  return el('span', { class: 'brandmark' },
    el('span', { class: 'brandmark__dualkc' }, 'DualKc'),
    ' ',
    el('span', { class: 'brandmark__studio' }, 'Studio'),
  );
}
