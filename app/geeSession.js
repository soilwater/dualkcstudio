/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * app/geeSession.js — remember the Earth Engine sign-in across app reloads.
 *
 * Google Identity Services hands back a short-lived (~1 h) access token and no
 * long-lived refresh token, so this can't keep you signed in forever. What it
 * does: stash the token (and your project id) in localStorage, so reloading the
 * app within that hour reconnects to Earth Engine silently — no popup. Once the
 * token expires you sign in once more. Shared by every GEE tool, so signing in
 * on one restores the session on all of them (same origin).
 *
 * The token is stored in plain localStorage. That's a deliberate, common
 * tradeoff for a browser-only tool: the token is short-lived and scoped to
 * Earth Engine read access. clearGeeSession() removes it.
 */

const K = { token: 'gee.token', exp: 'gee.exp', project: 'gee.project' };

/** Save the token after a successful sign-in. */
export function saveGeeSession(token, expiresInSec, project) {
  try {
    localStorage.setItem(K.token, token);
    localStorage.setItem(K.exp, String(Date.now() + (expiresInSec || 3600) * 1000));
    if (project) localStorage.setItem(K.project, project);
  } catch (e) { /* storage disabled — the session just won't persist */ }
}

/**
 * A still-valid stored session, or null. Requires ≥2 min of remaining life so a
 * restored token doesn't expire mid-request.
 */
export function loadGeeSession() {
  try {
    const token = localStorage.getItem(K.token);
    const exp = +localStorage.getItem(K.exp);
    const project = localStorage.getItem(K.project) || '';
    if (token && exp && Date.now() < exp - 120000) {
      return { token, project, expiresInSec: Math.floor((exp - Date.now()) / 1000) };
    }
  } catch (e) { /* ignore */ }
  return null;
}

export function clearGeeSession() {
  try { [K.token, K.exp].forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
}

/** The last project id used, to pre-fill the field even before reconnecting. */
export function savedProject() {
  try { return localStorage.getItem(K.project) || ''; } catch (e) { return ''; }
}

/** Remember the project id as soon as it's typed, so it pre-fills next time. */
export function saveProject(project) {
  try {
    if (project) localStorage.setItem(K.project, project);
    else localStorage.removeItem(K.project);
  } catch (e) { /* storage disabled — the field just won't persist */ }
}
