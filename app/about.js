/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * about.js — the About modal's content (trusted static HTML). Rendered by
 * app/main.js's openAbout() inside the shared modal, styled like the docs.
 * The version is interpolated from brand.js so it is set in one place.
 */

import { APP_NAME, APP_VERSION } from './brand.js';

export const ABOUT_HTML = `
<p>A browser-based implementation of the FAO-56 dual crop coefficient soil
water balance (Allen et al., 1998) for research and extension. Every mode
runs the same tested engine locally in JavaScript — your weather files never
leave your machine.</p>

<p style="color:var(--ink-2)"><strong>${APP_NAME}</strong> version
${APP_VERSION}</p>

<h3>Developed by</h3>
<p>The <strong>Soil Water Process Lab</strong>, Department of Agronomy,
<strong>Kansas State University</strong>.</p>

<h3>License</h3>
<p>Released under the <strong>MIT License</strong>.</p>
<p style="font-size:0.72rem; color:var(--muted); line-height:1.5;">
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the “Software”), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:</p>
<p style="font-size:0.72rem; color:var(--muted); line-height:1.5;">
The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.</p>
<p style="font-size:0.72rem; color:var(--muted); line-height:1.5;">
THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.</p>

<h3>Reference</h3>
<p>Allen, R. G., Pereira, L. S., Raes, D., &amp; Smith, M. (1998). Crop
evapotranspiration — Guidelines for computing crop water requirements. FAO
Irrigation and Drainage Paper 56. Food and Agriculture Organization of the
United Nations, Rome.</p>
`;
