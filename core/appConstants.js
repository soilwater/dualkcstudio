/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * appConstants.js — Small shared lookup tables that don't belong in either
 * cropSettings.js or soilSettings.js.
 */

export const IRRIG_METHODS = {
  "Sprinkler / basin (full cover)": 1.00,
  "Furrow": 0.70,
  "Drip": 0.35
};
export const IRRIG_METHOD_NAMES = Object.keys(IRRIG_METHODS);

export const ANALOG_METHODS = {
  "nse": "Nash-Sutcliffe Efficiency (NSE)",
  "cumulative": "Cumulative Difference",
  "pearson": "Pearson Correlation",
  "cosine": "Cosine Similarity"
};

export const ANALOG_VARS = {
  "eto": "Reference ET (ETo)",
  "prcp": "Precipitation"
};
