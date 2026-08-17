/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * analytics.js — the only module that talks to Google Analytics. The gtag base
 * snippet lives in index.html with automatic page views turned OFF; this sends
 * one page_view per tool as the hash router navigates, so GA's Pages report
 * breaks traffic down by tool. A no-op when gtag is absent (e.g. localhost, or
 * a blocker), so nothing here can break navigation.
 */

export function trackTool(path, title) {
  if (typeof window.gtag !== 'function') return;
  window.gtag('event', 'page_view', {
    page_path: '/' + path,
    page_title: title,
  });
}
