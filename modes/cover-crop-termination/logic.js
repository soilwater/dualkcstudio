/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * modes/cover-crop-termination/logic.js — pure orchestration, no DOM. Finds
 * every historical occurrence of a cover crop's planting month/day in the
 * loaded weather record, and for each termination-date option (plus an
 * optional "no cover crop" baseline) stitches [cover-crop block, terminated
 * early] + [fallow gap to cash planting] and runs it once through the
 * engine — reusing the rotation mode's block builders and `runRotation`
 * (one runModel call per stitched window, with the mass-conserving root-zone
 * handoff at the block boundary). No water-balance physics lives here.
 *
 * Dates are always real calendar dates (YYYY-MM-DD): a user picks familiar
 * dates, but every historical occurrence of that month/day is replayed —
 * termination and cash-planting dates roll into the following calendar
 * year automatically when they fall earlier than what came before them, so
 * an overwintering cover crop (planted Sept, terminated the following
 * April) is handled with no special-casing.
 */

import { toUtcTimestamp, parseUtcParts } from '../../core/index.js';
import { makeCropBlock, makeFallowBlock, runRotation, TERMINATION_RAMP_DAYS } from '../rotation/blocks.js';

function pad2(n) { return String(n).padStart(2, '0'); }

/** Next date on/after `fromIso` with the given calendar month (1–12) / day. */
export function nextOccurrence(fromIso, month, day) {
  const { year } = parseUtcParts(fromIso);
  const candidate = `${year}-${pad2(month)}-${pad2(day)}`;
  if (toUtcTimestamp(candidate) >= toUtcTimestamp(fromIso)) return candidate;
  return `${year + 1}-${pad2(month)}-${pad2(day)}`;
}

function daysBetween(aIso, bIso) {
  return Math.round((toUtcTimestamp(bIso) - toUtcTimestamp(aIso)) / 86400000);
}

/**
 * Every historical occurrence of `coverMonth/coverDay` in the weather
 * record, paired with the termination and cash-planting dates that follow
 * for THIS option (each the next occurrence after the previous one, so
 * cross-year gaps resolve on their own). Occurrences whose cash-planting
 * date runs past the end of the weather record are dropped — there isn't
 * a real year to compare yet.
 */
export function findOccurrences(weatherDf, coverMonth, coverDay, termMonth, termDay, cashMonth, cashDay) {
  const out = [];
  const lastDate = weatherDf[weatherDf.length - 1].date;
  for (const row of weatherDf) {
    const { monthIndex, day } = parseUtcParts(row.date);
    if (monthIndex + 1 !== coverMonth || day !== coverDay) continue;
    const coverPlantDate = row.date;
    const termDate = nextOccurrence(coverPlantDate, termMonth, termDay);
    const cashPlantDate = nextOccurrence(termDate, cashMonth, cashDay);
    if (toUtcTimestamp(cashPlantDate) > toUtcTimestamp(lastDate)) continue;
    out.push({
      coverPlantDate, termDate, cashPlantDate,
      coverDays: daysBetween(coverPlantDate, termDate),
      fallowDays: daysBetween(termDate, cashPlantDate),
    });
  }
  return out;
}

/**
 * Runs one historical occurrence of one option. Returns null for a
 * degenerate window (termination on/before planting, or the weather record
 * ran out before the stitched window's own end — a truncated run would
 * under-report how much water is actually at cash planting, so it's
 * dropped rather than counted as a real year).
 */
export function runOneOccurrence({ weatherDf, occurrence, isBaseline, cropPreset, cropOverrides, soil, fallowResiduePct, fallowCN, options }) {
  const { coverPlantDate, coverDays, fallowDays } = occurrence;
  if (!isBaseline && coverDays < 1) return null;

  let blocks;
  if (isBaseline) {
    blocks = [makeFallowBlock({ name: 'No cover crop', duration: coverDays + fallowDays, residue_pct: 0, CN: fallowCN })];
  } else {
    /* The termination ramp (TERMINATION_RAMP_DAYS) is spent inside the crop
       block itself; the fallow block only needs to cover whatever's left of
       the requested gap so the whole window still lands on the actual
       cash-planting date. A very short gap (< the ramp) is simply absorbed
       by the ramp — no separate fallow block needed. */
    const coverBlock = makeCropBlock(cropPreset, { ...cropOverrides, terminate: true, termDay: coverDays, residueDays: 0 });
    const fallowAdj = Math.max(0, fallowDays - TERMINATION_RAMP_DAYS);
    blocks = fallowAdj > 0
      ? [coverBlock, makeFallowBlock({ name: 'Fallow', duration: fallowAdj, residue_pct: fallowResiduePct, CN: fallowCN })]
      : [coverBlock];
  }

  let result;
  try {
    result = runRotation({ weatherDf, startDate: coverPlantDate, blocks, numCycles: 1, soil, options });
  } catch {
    return null;
  }
  if (result.truncated) return null;

  const rows = result.rows;
  const last = rows[rows.length - 1];
  const wholeTAW = 1000 * (soil.rootzone_fc - soil.rootzone_wp) * soil.Zr_profile;
  const wholePaw = (r) => r.Sr_paw + r.Ss_paw;
  const finalPawFraction = wholeTAW > 0 ? Math.max(0, Math.min(1, wholePaw(last) / wholeTAW)) : 0;

  return {
    startYear: parseUtcParts(coverPlantDate).year,
    coverPlantDate,
    termDate: isBaseline ? null : occurrence.termDate,
    cashPlantDate: occurrence.cashPlantDate,
    finalPawFraction,
    rootDepthReached: isBaseline ? 0 : rows[Math.max(0, Math.min(coverDays, rows.length) - 1)].Zr,
    totalPrecip: result.balance.precipitation,
    totalETc: result.balance.transpiration + result.balance.evaporation + result.balance.diffusive_loss,
    totalRunoff: result.balance.runoff,
    days: rows.map((r, i) => ({ dap: i, pawFraction: wholeTAW > 0 ? wholePaw(r) / wholeTAW : 0 })),
  };
}

/**
 * Runs and compares every termination-date option (plus the baseline, if
 * requested) across every historical year available. Returns one entry per
 * option: { id, label, isBaseline, termMonth, termDay, runs, yearsFound,
 * yearsUsed }. `runs` is only the years that actually completed — a run
 * dropped for a degenerate or truncated window is silently excluded from
 * `runs` but counted in `yearsFound` vs `yearsUsed` so the caller can warn
 * if too few years came through.
 */
export function runComparisonSimulation({ weatherDf, scenarios, includeBaseline, cropPreset, cropOverrides, soil, coverMonth, coverDay, cashMonth, cashDay, fallowResiduePct, fallowCN, options }) {
  const optionSets = scenarios.map((sc, i) => ({
    id: `term_${i}`, label: `Terminate ${sc.termMonth}/${sc.termDay}`, isBaseline: false,
    termMonth: sc.termMonth, termDay: sc.termDay,
  }));
  if (includeBaseline) {
    optionSets.push({ id: 'baseline', label: 'No cover crop', isBaseline: true, termMonth: cashMonth, termDay: cashDay });
  }

  return optionSets.map((opt) => {
    const occurrences = findOccurrences(weatherDf, coverMonth, coverDay, opt.termMonth, opt.termDay, cashMonth, cashDay);
    const runs = [];
    for (const occ of occurrences) {
      const r = runOneOccurrence({ weatherDf, occurrence: occ, isBaseline: opt.isBaseline, cropPreset, cropOverrides, soil, fallowResiduePct, fallowCN, options });
      if (r) runs.push(r);
    }
    let label = opt.label;
    if (runs.length) {
      label = opt.isBaseline
        ? `No cover → ${runs[0].cashPlantDate.slice(5)}`
        : `Terminate ${runs[0].termDate.slice(5)} → ${runs[0].cashPlantDate.slice(5)}`;
    }
    return { ...opt, label, runs, yearsFound: occurrences.length, yearsUsed: runs.length };
  });
}

/** Fraction of an option's years that reached at least `thresholdFraction` (0–1) whole-profile available water at cash planting. */
export function probabilityAtThreshold(runs, thresholdFraction) {
  if (!runs.length) return 0;
  return runs.filter(r => r.finalPawFraction >= thresholdFraction).length / runs.length;
}
