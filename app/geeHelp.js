/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * app/geeHelp.js — a small "How do I get a project ID?" link + modal, shared by
 * every Earth Engine tool so the instructions live in one place.
 */

import { el } from '../ui/dom.js';
import { openModal } from '../ui/components.js';

const REGISTER_URL = 'https://code.earthengine.google.com/register';
const ACCENT = '#86dd52';

/** A subtle inline link that opens the project-ID help modal. */
export function geeProjectHelp() {
  return el('button', {
    type: 'button',
    style: { background: 'none', border: 'none', padding: '0', margin: '0.35rem 0 0', font: 'inherit', color: ACCENT, textDecoration: 'underline', cursor: 'pointer' },
    onclick: openHelp,
  }, 'How do I get a project ID?');
}

function openHelp() {
  const content = el('div', { class: 'stack', style: { maxWidth: '34rem', lineHeight: '1.5' } },
    el('p', {}, 'Earth Engine runs each request inside a Google Cloud project that has the Earth Engine API enabled. It is free for noncommercial and research use, and you sign in with your own Google account.'),
    el('ol', { style: { paddingLeft: '1.2rem', display: 'grid', gap: '0.45rem', margin: '0' } },
      el('li', {}, 'Register for Earth Engine and create (or choose) a Cloud project using the button below.'),
      el('li', {}, 'Once registered, the project’s ID appears in the Earth Engine / Google Cloud console — it looks like ', el('code', {}, 'my-ee-project-123456'), '.'),
      el('li', {}, 'Paste that Project ID into the field, then click “Sign in with Google” with the same account.'),
    ),
    el('a', { href: REGISTER_URL, target: '_blank', rel: 'noopener noreferrer',
      style: { justifySelf: 'start', color: ACCENT, fontWeight: '600', textDecoration: 'underline' } },
      'Register a project for Earth Engine →'),
  );
  openModal('Getting an Earth Engine project ID', content);
}
