/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * main.js — application entry: builds the top bar, mounts the docs drawer,
 * and runs the hash router. Modes are lazy-loaded ES modules; each is
 * created once and kept alive when the user switches modes, so loaded
 * weather data and results survive navigation.
 *
 * A mode module's default export:
 *   {
 *     title:    string shown in the tab title,
 *     docs:     { title, html } for the documentation drawer,
 *     create(): builds and returns the mode's root element (called once),
 *     onShow(): optional, called every time the mode becomes visible,
 *   }
 */

import { APP_NAME, APP_TAGLINE, APP_VERSION, APP_REPO, brandMark } from './brand.js';
import { el, clear } from '../ui/dom.js';

/* GitHub "mark" icon, injected as inline SVG on the top-bar source link. */
const GH_ICON = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>`;
import { initDocs, setDocs, toggleDocs } from './docs.js';
import { openModal } from '../ui/components.js';
import { ABOUT_HTML } from './about.js';
import { trackTool } from './analytics.js';

const ROUTES = [
  { path: '', label: 'Home', loader: () => import('../tools/home.js') },
  { path: 'single-season', label: 'Single Season', loader: () => import('../tools/single-season/index.js') },
  { path: 'probabilistic', label: 'Probabilistic & Scenario', loader: () => import('../tools/probabilistic/index.js') },
  { path: 'rotation', label: 'Crop Rotation', loader: () => import('../tools/rotation/index.js') },
  { path: 'cover-crop-termination', label: 'Cover Crop Termination', loader: () => import('../tools/cover-crop-termination/index.js') },
  { path: 'eto-calculator', label: 'ETo Calculator', loader: () => import('../tools/eto-calculator/index.js') },
  { path: 'soil-limits', label: 'Soil Water Limits', loader: () => import('../tools/soil-limits/index.js') },
  { path: 'gee-collector', label: 'GEE Data Collector', loader: () => import('../tools/gee-collector/index.js') },
  { path: 'open-meteo', label: 'Open-Meteo Weather', loader: () => import('../tools/open-meteo/index.js') },
  { path: 'field-scale', label: 'Field Scale', loader: () => import('../tools/field-scale/index.js') },
  { path: 'mesoscale', label: 'Mesoscale', loader: () => import('../tools/mesoscale/index.js') },
];

const views = new Map();   /* path → { mod, el } */
let outlet;

function currentPath() {
  const h = location.hash.replace(/^#\/?/, '').replace(/\/$/, '');
  return ROUTES.some(r => r.path === h) ? h : '';
}

async function showRoute() {
  const path = currentPath();
  const route = ROUTES.find(r => r.path === path);

  homeLink.hidden = path === '';         /* Home link only on a mode page */
  referenceLink.hidden = path !== '';    /* Reference button only on the landing page */

  let view = views.get(path);
  if (!view) {
    let mod;
    try {
      mod = (await route.loader()).default;
    } catch (err) {
      console.error(err);
      outlet.append(el('div', { class: 'view view--doc' },
        el('div', { class: 'callout callout--error' }, `This mode failed to load: ${err.message}`)));
      return;
    }
    view = { mod, el: mod.create() };
    views.set(path, view);
    outlet.append(view.el);
  }

  for (const [, v] of views) v.el.hidden = v !== view;
  toolTitle.textContent = path ? view.mod.title : '';
  document.title = path ? `${view.mod.title} · ${APP_NAME}` : `${APP_NAME} — ${APP_TAGLINE}`;
  setDocs(view.mod.docs?.title ?? view.mod.title, view.mod.docs?.html ?? '');
  view.mod.onShow && view.mod.onShow();
  trackTool(path, path ? view.mod.title : 'Home');
  window.scrollTo(0, 0);
  /* Charts rendered while a view was hidden (or resized while hidden) keep
     stale dimensions; Plotly re-fits on window resize. */
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

/* One Home link, shown only on a mode page — the tools are reachable from
   the landing cards, so a per-mode nav would wrongly imply shared inputs
   (switching tools does NOT carry weather/soil over; the user needs to return Home). */
const homeLink = el('a', { class: 'navlink', href: '#/' }, '← Home');
/* The current tool's name, so the user always sees which tool they're in. */
const toolTitle = el('span', { class: 'topbar__tool' });
/* The FAO-56 model reference — a standalone page (reference.html), opened in a
   new tab. Shown only on the landing page. */
const referenceLink = el('a', { class: 'btn btn--sm', href: 'reference.html', target: '_blank', rel: 'noopener', title: 'Open the FAO-56 model reference in a new tab' }, 'Reference');

function buildShell(root) {
  const bar = el('header', { class: 'topbar' },
    el('div', { class: 'topbar__inner' },
      el('a', { class: 'topbar__brand', href: '#/' },
        el('span', { class: 'topbar__name' }, brandMark()),
        el('span', { class: 'topbar__tag' }, APP_TAGLINE),
      ),
      homeLink,
      toolTitle,
      el('div', { class: 'topbar__actions grow', style: { justifyContent: 'flex-end' } },
        referenceLink,
        el('button', { class: 'btn btn--sm', type: 'button', onclick: openAbout, title: 'About this project' }, 'About'),
        el('button', { class: 'btn btn--sm', type: 'button', onclick: toggleDocs, title: 'Open documentation for this screen' }, '? Docs'),
        el('a', { class: 'btn btn--sm topbar__icon-btn', href: APP_REPO, target: '_blank', rel: 'noopener', title: 'View source on GitHub', 'aria-label': 'View source on GitHub', html: GH_ICON }),
      ),
    ),
  );

  outlet = el('div', { class: 'outlet' });
  root.append(bar, outlet);
  initDocs(root);
}

function openAbout() {
  const body = el('div', { class: 'docs__body', html: ABOUT_HTML });
  openModal('About', body);
}

const root = document.getElementById('app');
clear(root);
buildShell(root);
window.addEventListener('hashchange', showRoute);
showRoute();

/* Progressive Web App: register the service worker (offline + installable).
   The version rides in the query string so a bump swaps the SW and clears the
   old cache. No-op on insecure origins (all but localhost) during dev. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`sw.js?v=${APP_VERSION}`).catch(() => {});
  });
}
