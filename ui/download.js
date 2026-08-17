/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * download.js — file save + CSV/JSON serialization helpers (one blob-anchor
 * implementation for the whole app, object URLs revoked after use).
 */

/** Save an already-built Blob or ArrayBuffer (e.g. a GeoTIFF). */
export function downloadBlob(filename, blobOrBuffer, mime = 'application/octet-stream') {
  const blob = blobOrBuffer instanceof Blob ? blobOrBuffer : new Blob([blobOrBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(filename, text, mime = 'text/plain') {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

export function downloadJson(filename, obj) {
  downloadText(filename, JSON.stringify(obj, null, 2), 'application/json');
}

/**
 * rows → CSV text. `cols` is an array of {key, label?, digits?}; values are
 * pulled from each row by key and formatted to `digits` decimals when given.
 */
function rowsToCsv(cols, rows) {
  const head = cols.map(c => c.label || c.key).join(',');
  const lines = rows.map(r => cols.map(c => {
    const v = r[c.key];
    if (v === undefined || v === null) return '';
    if (typeof v === 'number') return isFinite(v) ? (c.digits !== undefined ? v.toFixed(c.digits) : String(v)) : '';
    return String(v).includes(',') ? `"${v}"` : String(v);
  }).join(','));
  return [head, ...lines].join('\n');
}

export function downloadCsv(filename, cols, rows) {
  downloadText(filename, rowsToCsv(cols, rows), 'text/csv');
}

/** Opens a file picker (or receives a dropped File) and resolves its text. */
export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsText(file);
  });
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}
