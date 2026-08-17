/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * engine.js — FAO-56 dual crop coefficient daily soil water balance.
 *
 * Allen, R.G., Pereira, L.S., Raes, D., Smith, M. (1998). Crop
 * evapotranspiration: Guidelines for computing crop water requirements.
 * FAO Irrigation and Drainage Paper 56.
 *
 * ONE function in ONE file, laid out so it can be read against the manual.
 * Every equation carries its number. The daily loop is only the water
 * balance: all the crop and canopy series (Kcb, Zr, h, Kc_max, fc) are
 * built up front in PART 1, because none of them depend on the soil water
 * state, and separating them keeps PART 2 down to the hydrology.
 *
 * ── What is always on ──────────────────────────────────────────────────────
 *
 * Three-compartment profile (rootZone.js). FAO-56 does not define the water
 * content of the soil below the root zone. This engine tracks it. See that
 * file for why the usual alternatives make Ks invariant to root growth.
 *
 * Full ETc in the root-zone balance (Eq. 85). Soil evaporation depletes the
 * profile, not just the surface book. This is the manual.
 *
 * Residue cover reduces TEW by 5% per 10% of soil surface covered, REW
 * capped at TEW (p. 208). This is the manual's own guidance, not a
 * departure from it.
 *
 * One departure from the manual, always on: SCS Curve Number runoff (the
 * manual leaves runoff to the caller). See presets.js.
 *
 * ── What is optional ──────────────────────────────────────────────────────
 *
 * See presets.js. Every flag defaults to the manual's own behaviour, so
 * `runModel(soil, crop, mgmt, wx)` with no options is strict FAO-56.
 *
 * ── Contract ──────────────────────────────────────────────────────────────
 *
 * This function does no data preparation. The caller supplies:
 *   - weatherDf already windowed to the exact simulated period
 *     (weather.js's sliceWeatherWindow) — no date arithmetic happens here
 *   - every row's ETo already computed (eto.js's ensureEToComputed)
 *   - prcp / irrig / kcb_obs gaps already resolved (weather.js's preprocess)
 *
 * That is what lets the same function drive a single season, a
 * probabilistic ensemble, a multi-year rotation, or one pixel of a
 * gridded run without ever knowing which it is.
 *
 * ── Rotations ─────────────────────────────────────────────────────────────
 *
 * crop.Kcb, crop.Zr, crop.h and crop.fc may each be supplied as an array of
 * at least weatherDf.length values, used verbatim instead of being
 * generated. A rotation builder stitches each stage's series — crop or
 * fallow — into one run-length array. Zr may both grow and shrink, so a
 * stage transition is just another day on which Zr changed.
 *
 * management.residue_cover, management.curve_number, crop.p_tab, crop.h_max,
 * crop.Kcb_full and crop.Kc_min may each be a scalar (constant) or an array
 * (per day). Bare fallow genuinely has a different curve number, residue
 * cover and canopy from a crop, so these have to be able to vary.
 *
 * Nothing about the rotation path is a second code path: whatever the
 * engine would generate, curves.js exports so a caller can generate it too.
 *
 * ── Yield ─────────────────────────────────────────────────────────────────
 *
 * Not computed here. A run may span several crops, and one T/Tx ratio
 * averaged across them is meaningless. Slice the rows for one crop's window
 * and call curves.js's estimateYield.
 */

import { canopyHeightArray, fcFromKcb, kcMax, resolveKcbFn, rootDepthArray, adjustCropForClimate } from './curves.js';
import { makeSoilProfile, rootWater } from './rootZone.js';
import { resolveOptions } from './presets.js';

// Scalar-or-array access.
function at(v, i) { return Array.isArray(v) ? v[i] : v; }
function isNum(v) { return typeof v === 'number' && isFinite(v); }

// FAO-56 Eq. 73 — total and readily evaporable water.
function evaporableWater(soil, residueCover) {
  let TEWbare = Math.max(1000.0 * (soil.surface_fc - 0.5 * soil.surface_wp) * soil.Ze, 1.0);
  let TEW = TEWbare * Math.max(1.0 - 0.5 * residueCover, 0.1);
  let REW = Math.min(soil.REW_frac * TEW, TEW);
  return { TEW, REW };
}

// SCS Curve Number runoff, mm (lambda = 0.2).
function curveNumberRunoff(prcp, CN) {
  let S = 25400.0 / CN - 254.0;
  let Ia = 0.2 * S;
  if (prcp <= Ia) return 0.0;
  return Math.pow(prcp - Ia, 2) / (prcp - Ia + S);
}

// Input validation.
function validate(soil, crop, management, df, options) {
  let err = [];
  let N = df.length;

  let needSoil = ['surface_fc', 'surface_wp', 'surface_ini', 'rootzone_fc', 'rootzone_wp',
    'rootzone_ini', 'Ze', 'REW_frac', 'Zr_profile', 'subsoil_ini'];
  for (let i = 0; i < needSoil.length; i++) {
    let k = needSoil[i];
    if (!isNum(soil[k])) err.push(`soil.${k} is required and must be a finite number.`);
  }
  if (isNum(soil.rootzone_fc) && isNum(soil.rootzone_wp) && soil.rootzone_fc <= soil.rootzone_wp) {
    err.push('soil.rootzone_fc must exceed soil.rootzone_wp.');
  }
  if (isNum(soil.subsoil_ini) && isNum(soil.rootzone_fc) && soil.subsoil_ini > soil.rootzone_fc + 1e-9) {
    err.push('soil.subsoil_ini cannot exceed soil.rootzone_fc.');
  }

  function arrOk(v, name) {
    if (v === undefined) return false;
    if (!Array.isArray(v)) { err.push(`crop.${name}, when supplied, must be an array of at least ${N} values.`); return false; }
    if (v.length < N) { err.push(`crop.${name} has ${v.length} values but the run is ${N} days.`); return false; }
    return true;
  }
  let hasKcbArr = arrOk(crop.Kcb, 'Kcb');
  let hasFcArr = arrOk(crop.fc, 'fc');
  arrOk(crop.Zr, 'Zr');
  if (crop.h !== undefined && Array.isArray(crop.h)) arrOk(crop.h, 'h');

  if (!hasKcbArr) {
    let needCrop = ['Kcb_ini', 'Kcb_mid', 'Kcb_end', 'L_ini', 'L_dev', 'L_mid', 'L_late'];
    for (let i = 0; i < needCrop.length; i++) {
      let k = needCrop[i];
      if (!isNum(crop[k])) err.push(`crop.${k} is required unless crop.Kcb is supplied as an array.`);
    }
  }
  if (!Array.isArray(crop.Zr) && !isNum(crop.Zr_max)) {
    err.push('crop.Zr_max is required unless crop.Zr is supplied as an array.');
  }

  if (crop.h === undefined) {
    let hMaxOk = isNum(crop.h_max) || Array.isArray(crop.h_max);
    let fullOk = isNum(crop.Kcb_full) || Array.isArray(crop.Kcb_full) || isNum(crop.Kcb_mid);
    if (!hMaxOk) {
      err.push('crop.h_max (scalar or per-day array) is required unless crop.h is supplied directly.');
    } else if (!fullOk) {
      err.push('Canopy height cannot be derived: supply crop.Kcb_full (the Kcb at which the canopy '
        + 'reaches h_max, scalar or per-day array), or crop.Kcb_mid, or supply crop.h directly. '
        + 'A stitched rotation has no single Kcb_mid, so it must pass Kcb_full or h.');
    }
  }

  if (!hasFcArr && options.fcModel === 'height' && crop.h === undefined
      && !(isNum(crop.h_max) || Array.isArray(crop.h_max))) {
    err.push('options.fcModel "height" needs a canopy height: supply crop.h, or crop.h_max, '
      + 'or switch to options.fcModel "kcb", or supply crop.fc directly.');
  }

  if (management.curve_number === undefined) err.push('management.curve_number is required (scalar or per-day array).');
  if (!isNum(at(crop.p_tab, 0))) err.push('crop.p_tab is required (scalar or per-day array).');

  let cols = ['ETo', 'prcp', 'wspd', 'rmin'];
  for (let c = 0; c < cols.length; c++) {
    let k = cols[c];
    for (let n = 0; n < N; n++) {
      if (!isNum(df[n][k])) {
        err.push(`weatherDf[${n}].${k} is missing or not finite; the engine does no gap filling (see weather.js).`);
        break;
      }
    }
  }

  if (err.length) throw new Error('runModel input problems:\n  - ' + err.join('\n  - '));
}

export function runModel(soil, cropInput, management, weatherDf, userOptions) {
  let options = resolveOptions(userOptions);
  let N = weatherDf.length;
  if (N === 0) throw new Error('weatherDf must contain at least one day.');
  validate(soil, cropInput, management, weatherDf, options);

  let df = new Array(N);
  for (let n = 0; n < N; n++) df[n] = { ...weatherDf[n] };
  let warnings = [];

  // PART 1 — Crop and canopy series
  let rz_fc = soil.rootzone_fc;
  let rz_wp = soil.rootzone_wp;
  let Zr_profile = soil.Zr_profile;
  let Ze = soil.Ze;

  let kcbIsArray = Array.isArray(cropInput.Kcb);

  let crop = cropInput;
  if (options.climateAdjustKcb) {
    if (kcbIsArray) {
      warnings.push('options.climateAdjustKcb was ignored: crop.Kcb is an array, so there is no '
        + 'tabulated Kcb_mid/Kcb_end to adjust. Apply curves.js\'s adjustKcbForClimate per stage instead.');
    } else if (Array.isArray(cropInput.h_max)) {
      warnings.push('options.climateAdjustKcb was ignored: crop.h_max is an array, so Eq. 70 has no '
        + 'single canopy height to use. Apply curves.js\'s adjustKcbForClimate per stage instead.');
    } else {
      crop = adjustCropForClimate(cropInput, df);
    }
  }
  if (options.kcbStartsAtZero && kcbIsArray) {
    warnings.push('options.kcbStartsAtZero was ignored: crop.Kcb is an array, so the engine generated '
      + 'no curve. Build the array with curves.js\'s kcbRampFromZero instead.');
  }

  let kcbFn = resolveKcbFn(options);
  let Kcb = new Array(N);
  for (let n = 0; n < N; n++) {
    let obs = df[n].kcb_obs;
    Kcb[n] = isNum(obs) ? Math.max(obs, 0) : (kcbIsArray ? crop.Kcb[n] : kcbFn(n, crop));
  }
  if (!kcbIsArray) {
    let seasonLen = crop.L_ini + crop.L_dev + crop.L_mid + crop.L_late;
    if (N > seasonLen) warnings.push(`Run is ${N} days but the crop's stages total ${seasonLen}; Kcb is held at Kcb_end for the remaining ${N - seasonLen} day(s).`);
    if (N < seasonLen) warnings.push(`Run is ${N} days but the crop's stages total ${seasonLen}; the season is truncated.`);
  }

  let Zr_min = isNum(soil.Zr_min) ? Math.max(soil.Zr_min, Ze) : Ze;
  let ZrRaw = Array.isArray(crop.Zr) ? crop.Zr.slice(0, N) : rootDepthArray(N, crop);
  let cappedDays = 0;
  let Zr = new Array(N);
  for (let n = 0; n < N; n++) {
    let z = ZrRaw[n];
    if (z > Zr_profile) cappedDays++;
    Zr[n] = Math.min(Math.max(z, Zr_min), Zr_profile);
  }
  if (cappedDays) warnings.push(`Root depth exceeded soil.Zr_profile (${Zr_profile} m) on ${cappedDays} day(s) and was capped.`);

  let Kc_min = crop.Kc_min !== undefined ? crop.Kc_min : 0.15;
  let h = new Array(N);
  if (crop.h !== undefined) {
    for (let n = 0; n < N; n++) h[n] = at(crop.h, n);
  } else {
    let hArr = canopyHeightArray(Kcb, {
      h_max: crop.h_max,
      Kcb_full: crop.Kcb_full !== undefined ? crop.Kcb_full : crop.Kcb_mid,
      Kc_min,
    });
    for (let n = 0; n < N; n++) h[n] = hArr[n];
  }

  let fcIsArray = Array.isArray(crop.fc);
  let fc_max = crop.fc_max !== undefined ? crop.fc_max : 0.99;
  let Kc_maxArr = new Array(N);
  let fc = new Array(N);
  for (let n = 0; n < N; n++) {
    Kc_maxArr[n] = kcMax(Kcb[n], { u2: df[n].wspd, rhmin: df[n].rmin, h: h[n] });
    fc[n] = fcIsArray
      ? crop.fc[n]
      : fcFromKcb(Kcb[n], { Kc_min: at(Kc_min, n), Kc_max: Kc_maxArr[n], h: h[n], model: options.fcModel, fc_max });
  }

  // PART 2 — Daily soil water balance (FAO-56 Ch. 7 and Ch. 8)
  let profile = makeSoilProfile();
  let state = profile.init({
    rz_fc, rz_ini: soil.rootzone_ini, Zr0: Zr[0], Zr_profile, subsoil_ini: soil.subsoil_ini,
  });
  let De = 1000.0 * (soil.surface_fc - soil.surface_ini) * Ze;

  let Ke = new Array(N);
  let Ks = new Array(N);
  let Kr = new Array(N);
  let few = new Array(N);
  let E = new Array(N);
  let T = new Array(N);
  let T_ew = new Array(N);
  let E_diff = new Array(N);
  let ETc = new Array(N);
  let DeOut = new Array(N);
  let DrOut = new Array(N);
  let SsOut = new Array(N);
  let TAWout = new Array(N);
  let RAWout = new Array(N);
  let TEWout = new Array(N);
  let REWout = new Array(N);
  let p_used = new Array(N);
  let runoff = new Array(N);
  let irrig_applied = new Array(N);
  let deep_percolation = new Array(N);
  let ETc_unmet = new Array(N);

  let fw_irrig = management.fw !== undefined ? management.fw : 1.0;
  let irrig_eff = management.irrig_efficiency !== undefined ? management.irrig_efficiency : 1.0;
  let irrig_delay = parseInt(management.irrig_delay || 0, 10);
  let irrig_allocation = isNum(management.irrig_allocation) ? management.irrig_allocation : null;
  let fw_event = 1.0;
  let last_irrig_day = -irrig_delay;
  let cum_irrig = 0.0;

  let storage0 = rootWater(state.Dr, Zr[0], rz_fc) + state.Ss;
  let prevStorage = storage0;
  let maxDailyResidual = 0;

  for (let n = 0; n < N; n++) {
    let ETo = df[n].ETo;
    let prcp = df[n].prcp;
    let residue_cover = at(management.residue_cover, n) || 0;
    let CN = at(management.curve_number, n);
    let p_tab = at(crop.p_tab, n);

    // Step 1: track the root/subsoil boundary as Zr moves.
    if (n > 0) {
      let dZr = Zr[n] - Zr[n - 1];
      let Zs_prev = Math.max(Zr_profile - Zr[n - 1], 0.0);
      if (dZr > 0) profile.grow(state, dZr, { rz_fc, rz_wp, Zs_prev });
      else if (dZr < 0) profile.shrink(state, dZr, { rz_fc, Zr_prev: Zr[n - 1], Zr_new: Zr[n] });
    }
    let Zs = Math.max(Zr_profile - Zr[n], 0.0);

    let TAW = 1000.0 * (rz_fc - rz_wp) * Zr[n];
    let Dr_prev = Math.min(Math.max(state.Dr, 0.0), TAW);
    let De_prev = De;

    let ew = evaporableWater(soil, residue_cover);
    let TEW = ew.TEW;
    let REW = ew.REW;

    // Step 2: runoff and net infiltration (Pnet), then irrigation.
    let RO = curveNumberRunoff(prcp, CN);
    let Pnet = prcp - RO;

    let I_input = df[n].irrig || 0;
    let I = I_input;
    let canIrrigate = (n - last_irrig_day) >= irrig_delay;
    let remainingAlloc = irrig_allocation === null
      ? Infinity
      : Math.max(irrig_allocation - cum_irrig - I, 0.0);

    if (management.irrigation_mode === 'auto' && canIrrigate) {
      if (Dr_prev >= management.mad * TAW) I += Math.min(Dr_prev, management.irrig_amount, remainingAlloc);
    } else if (management.irrigation_mode === 'scheduled') {
      let sched = management.irrig_schedule || [];
      if (canIrrigate && sched.includes(n)) I += Math.min(management.irrig_amount, remainingAlloc);
    } else if (management.irrigation_mode === 'rainfed') {
      I = 0.0;
    }

    if (I > I_input) last_irrig_day = n;
    cum_irrig += I;
    let I_net = I * irrig_eff;

    if (Pnet > 0.0 || I_net > 0.0) fw_event = (Pnet >= I_net) ? 1.0 : fw_irrig;

    // Step 3: soil evaporation (Eq. 71, 72, 74, 75).
    let KrToday = (De_prev <= REW) ? 1.0 : Math.max((TEW - De_prev) / (TEW - REW), 0.0);
    let fewToday = Math.max(Math.min(1.0 - fc[n], fw_event), 1e-6);
    let KeToday = Math.max(Math.min(KrToday * (Kc_maxArr[n] - Kcb[n]), fewToday * Kc_maxArr[n]), 0.0);
    let EToday = KeToday * ETo;

    // Step 4: root-zone depletion threshold (Eq. 82, 83) and transpiration (Eq. 71, 84).
    let ETc_ns = (Kcb[n] + KeToday) * ETo;
    let p = Math.min(Math.max(p_tab + 0.04 * (5.0 - ETc_ns), 0.1), 0.8);
    let RAW = p * TAW;

    let KsToday = (Dr_prev < RAW) ? 1.0 : Math.max((TAW - Dr_prev) / (TAW - RAW), 0.0);
    let TToday = KsToday * Kcb[n] * ETo;

    // Step 5: Eq. 77's surface transpiration term, T_ew — diagnostic only,
    // feeds only next day's Kr via the De book, excluded from the root-zone
    // and profile mass balances below.
    let T_ewToday = 0.0;
    if (options.surfaceTranspiration) {
      let share = Math.min(Ze / Math.max(Zr[n], 1e-9), 1.0);
      let RAW_surf = p * TEW;
      let Ks_surf = (De_prev < RAW_surf)
        ? 1.0
        : Math.max((TEW - De_prev) / Math.max(TEW - RAW_surf, 1e-9), 0.0);
      T_ewToday = TToday * share * Ks_surf;
    }

    // Step 6: optional deep diffusive/vapour loss (Lollato et al. 2016).
    let belowZeIsRootZone = Zr[n] > Ze + 1e-9;
    let E_diffToday = 0.0;
    if (options.deepDiffusiveLoss) {
      let wetness = belowZeIsRootZone
        ? Math.max(1.0 - Dr_prev / Math.max(TAW, 1e-9), 0.0)
        : profile.subsoilWetness(state, { rz_fc, rz_wp, Zs_n: Zs });
      E_diffToday = options.deepDiffusiveCoeff * (De_prev / TEW) * wetness * ETo;
    }
    let E_diff_root = 0.0;
    if (E_diffToday > 0) {
      if (belowZeIsRootZone) E_diff_root = E_diffToday;
      else E_diffToday = profile.drawFromSubsoil(state, E_diffToday, { rz_wp, Zs_n: Zs });
    }

    // Step 7: cap today's demand at what the root zone can actually supply,
    // scale T, E, Ke, E_diff_root and E_diff back together. T_ew is left
    // alone — see Step 5.
    let netIn = Pnet + I_net;
    let demanded = TToday + EToday + E_diff_root;
    let supply = Math.max(TAW - Dr_prev + netIn, 0.0);
    let unmet = 0.0;
    if (demanded > supply) {
      unmet = demanded - supply;
      let scale = demanded > 1e-12 ? supply / demanded : 0.0;
      TToday *= scale; EToday *= scale; KeToday *= scale; E_diff_root *= scale; E_diffToday *= scale;
    }

    // Step 8: surface book, De (Eq. 74/75 rollover) — post-cap E, pre-cap T_ew.
    let DPe = Math.max(Pnet + I_net / fw_irrig - De_prev, 0.0);
    De = Math.min(Math.max(De_prev - Pnet - I_net / fw_irrig + EToday / fewToday + T_ewToday + DPe, 0.0), TEW);

    // Step 9: root-zone book, Dr (Eq. 85/86) — full ETc, not just T.
    let ETcToday = TToday + EToday;
    let DPr = Math.max(netIn - ETcToday - E_diff_root - Dr_prev, 0.0);
    state.Dr = Math.min(Math.max(Dr_prev - netIn + ETcToday + E_diff_root + DPr, 0.0), TAW);

    let deepPercToday = profile.receivePercolation(state, DPr, { rz_fc, Zs_n: Zs });

    // Step 10: mass-conservation audit for this day.
    let storageNow = rootWater(state.Dr, Zr[n], rz_fc) + state.Ss;
    let expected = netIn - TToday - EToday - E_diffToday - deepPercToday;
    maxDailyResidual = Math.max(maxDailyResidual, Math.abs((storageNow - prevStorage) - expected));
    prevStorage = storageNow;

    Ke[n] = KeToday; Ks[n] = KsToday; Kr[n] = KrToday; few[n] = fewToday;
    E[n] = EToday; T[n] = TToday; T_ew[n] = T_ewToday; E_diff[n] = E_diffToday;
    ETc[n] = TToday + EToday + E_diffToday;
    DeOut[n] = De; DrOut[n] = state.Dr; SsOut[n] = state.Ss;
    TAWout[n] = TAW; RAWout[n] = RAW; TEWout[n] = TEW; REWout[n] = REW;
    p_used[n] = p; runoff[n] = RO; irrig_applied[n] = I;
    deep_percolation[n] = deepPercToday; ETc_unmet[n] = unmet;
  }

  // PART 3 — Derived quantities, output rows, and the balance audit
  for (let n = 0; n < N; n++) {
    let r = df[n];
    r.Kcb = Kcb[n]; r.Ke = Ke[n]; r.Ks = Ks[n]; r.Kr = Kr[n];
    r.Kc_max = Kc_maxArr[n]; r.fc = fc[n]; r.few = few[n]; r.h = h[n]; r.Zr = Zr[n];
    r.E = E[n]; r.T = T[n]; r.T_ew = T_ew[n]; r.E_diff = E_diff[n];
    r.ETc = ETc[n]; r.T_potential = Kcb[n] * r.ETo;
    r.De = DeOut[n]; r.Dr = DrOut[n]; r.Ss = SsOut[n];
    r.TEW = TEWout[n]; r.REW = REWout[n]; r.TAW = TAWout[n]; r.RAW = RAWout[n];
    r.p_used = p_used[n];
    r.Se = 1000.0 * soil.surface_fc * Ze - DeOut[n];
    r.Sr = rootWater(DrOut[n], Zr[n], rz_fc);
    r.Sr_paw = Math.max(r.Sr - 1000.0 * rz_wp * Zr[n], 0.0);
    let Zs_n = Math.max(Zr_profile - Zr[n], 0.0);
    r.Ss_paw = Math.max(SsOut[n] - 1000.0 * rz_wp * Zs_n, 0.0);
    r.Ds = Math.max(1000.0 * rz_fc * Zs_n - SsOut[n], 0.0);
    r.S_profile = r.Sr + SsOut[n];
    r.runoff = runoff[n]; r.irrig_applied = irrig_applied[n];
    r.irrig_net = irrig_applied[n] * irrig_eff;
    r.deep_percolation = deep_percolation[n]; r.ETc_unmet = ETc_unmet[n];
  }

  function sum(a) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i];
    return s;
  }

  let sumPrcpMinusRunoff = 0;
  let sumIrrigNet = 0;
  let sumPrcp = 0;
  for (let n = 0; n < N; n++) {
    sumPrcpMinusRunoff += df[n].prcp - df[n].runoff;
    sumIrrigNet += df[n].irrig_net;
    sumPrcp += df[n].prcp;
  }

  let storageFinal = df[N - 1].S_profile;
  let inflow = sumPrcpMinusRunoff + sumIrrigNet;
  let outflow = sum(T) + sum(E) + sum(E_diff) + sum(deep_percolation);
  let balance = {
    precipitation: sumPrcp, runoff: sum(runoff),
    irrigation_gross: sum(irrig_applied), irrigation_net: sumIrrigNet,
    irrigation_loss: sum(irrig_applied) * (1 - irrig_eff),
    transpiration: sum(T), evaporation: sum(E), diffusive_loss: sum(E_diff),
    deep_percolation: sum(deep_percolation), ETc_unmet: sum(ETc_unmet),
    storage_initial: storage0, storage_final: storageFinal,
    storage_change: storageFinal - storage0,
    residual: (storageFinal - storage0) - (inflow - outflow),
    max_daily_residual: maxDailyResidual,
  };

  let tol = Math.max(1e-6 * Math.max(inflow, 1), 1e-6);
  if (Math.abs(balance.residual) > tol) {
    warnings.push(`Water balance did not close: residual ${balance.residual.toFixed(6)} mm over the run `
      + `(largest single day ${maxDailyResidual.toFixed(6)} mm). This is a bug — please report it.`);
  }
  let totalET = balance.transpiration + balance.evaporation + balance.diffusive_loss;
  if (balance.ETc_unmet > Math.max(1.0, 0.01 * totalET)) {
    let days = 0;
    for (let n = 0; n < N; n++) if (ETc_unmet[n] > 0) days++;
    warnings.push(`Evaporative demand exceeded what the root zone could supply on ${days} day(s), `
      + `totalling ${balance.ETc_unmet.toFixed(1)} mm (${(100 * balance.ETc_unmet / Math.max(totalET, 1e-9)).toFixed(1)}% of ET). `
      + `Reported E and T were scaled back accordingly. This usually means the root zone is very `
      + `shallow (Zr at or near Ze) — consider raising soil.Zr_min or the fallow root depth.`);
  }

  return { df, options, warnings, balance };
}
