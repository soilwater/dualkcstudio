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

import { APP_NAME, APP_TAGLINE, APP_VERSION, brandMark } from './brand.js';
import { el, clear } from '../ui/dom.js';
import { initDocs, setDocs, toggleDocs } from './docs.js';
import { openModal } from '../ui/components.js';
import { ABOUT_HTML } from './about.js';
import { isReleased } from './release.js';
import { trackTool } from './analytics.js';

const ROUTES = [
  { path: '', label: 'Home', loader: () => import('../modes/home.js') },
  { path: 'single-season', label: 'Single Season', loader: () => import('../modes/single-season/index.js') },
  { path: 'probabilistic', label: 'Probabilistic & Scenario', loader: () => import('../modes/probabilistic/index.js') },
  { path: 'rotation', label: 'Crop Rotation', loader: () => import('../modes/rotation/index.js') },
  { path: 'cover-crop-termination', label: 'Cover Crop Termination', loader: () => import('../modes/cover-crop-termination/index.js') },
  { path: 'eto-calculator', label: 'ETo Calculator', loader: () => import('../modes/eto-calculator/index.js') },
  { path: 'soil-limits', label: 'Soil Water Limits', loader: () => import('../modes/soil-limits/index.js') },
  { path: 'gee-collector', label: 'GEE Data Collector', loader: () => import('../modes/gee-collector/index.js') },
  { path: 'spatial', label: 'Field Scale', loader: () => import('../modes/spatial/index.js') },
  { path: 'mesoscale', label: 'Mesoscale', loader: () => import('../modes/mesoscale/index.js') },
];

const views = new Map();   /* path → { mod, el } */
let outlet;

function currentPath() {
  const h = location.hash.replace(/^#\/?/, '').replace(/\/$/, '');
  return ROUTES.some(r => r.path === h) ? h : '';
}

async function showRoute() {
  const path = currentPath();
  /* An unreleased tool is not public yet — send its direct link home rather
     than open a tool the announcement hasn't reached. */
  if (path && !isReleased(path)) { location.hash = '#/'; return; }
  const route = ROUTES.find(r => r.path === path);

  homeLink.hidden = path === '';   /* Home link only on a mode page */

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
        el('button', { class: 'btn btn--sm', type: 'button', onclick: openAbout, title: 'About this project' }, 'About'),
        el('button', { class: 'btn btn--sm', type: 'button', onclick: toggleDocs, title: 'Open documentation for this screen' }, '? Docs'),
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
