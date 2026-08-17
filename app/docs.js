/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * docs.js — the slide-in documentation drawer, available on every screen.
 * Each mode registers its documentation (trusted static HTML authored in
 * the mode's docs.js file); the drawer shows whichever mode is active.
 */

import { el } from '../ui/dom.js';

let drawer, backdrop, titleEl, bodyEl;
let isOpen = false;

export function initDocs(parent) {
  backdrop = el('div', { class: 'docs-backdrop', onclick: closeDocs });
  titleEl = el('h2', {}, 'Documentation');
  bodyEl = el('div', { class: 'docs__body' });
  drawer = el('aside', { class: 'docs', role: 'complementary', 'aria-label': 'Documentation' },
    el('div', { class: 'docs__head' },
      titleEl,
      el('button', { class: 'btn btn--sm', type: 'button', onclick: closeDocs, 'aria-label': 'Close documentation' }, 'Close'),
    ),
    bodyEl,
  );
  parent.append(backdrop, drawer);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) closeDocs();
  });
}

export function setDocs(title, html) {
  titleEl.textContent = title;
  bodyEl.innerHTML = html || '<p>No documentation for this screen yet.</p>';
}

function openDocs() {
  isOpen = true;
  drawer.classList.add('is-open');
  backdrop.classList.add('is-open');
  bodyEl.scrollTop = 0;
}

function closeDocs() {
  isOpen = false;
  drawer.classList.remove('is-open');
  backdrop.classList.remove('is-open');
}

export function toggleDocs() {
  isOpen ? closeDocs() : openDocs();
}
