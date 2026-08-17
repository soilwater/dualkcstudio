/* Copyright (c) August 2026 Andres Patrignani. */
/**
 * rootZone.js — The moving boundary between the root zone and the soil
 * below it.
 *
 * FAO-56's soil water balance (Ch. 8) tracks one root-zone depletion Dr over
 * a root zone that deepens through the season, and says nothing about the
 * water content of the soil the roots have not reached yet. Implementations
 * usually assume that soil sits at field capacity, or at the root zone's own
 * average water content. Both assumptions have the same consequence: Dr and
 * TAW scale together with Zr, so Dr/TAW — and therefore Ks — is invariant to
 * root growth. A crop can never find water by rooting deeper.
 *
 * For a single irrigated season that hardly matters. For dryland systems it
 * is the whole mechanism: water banked during fallow, mined by deep roots.
 * So this module tracks a third compartment explicitly.
 *
 *   surface   0 .. Ze          De   (FAO-56's evaporating layer; a
 *                                    sub-volume of the root zone, used only
 *                                    to drive Kr — see engine.js)
 *   root      0 .. Zr          Dr   depletion below field capacity, mm
 *   subsoil   Zr .. Zr_profile Ss   water content, mm
 *
 * The root zone and the subsoil are two compartments of ONE homogeneous
 * body of soil below the surface layer, both characterised by rootzone_fc
 * and rootzone_wp. They are deliberately NOT given separate retention
 * properties: the boundary between them moves every day, and if the two
 * sides had different fc/wp the profile's total capacity would jump each
 * time it moved. Only the INITIAL water content differs (soil.subsoil_ini),
 * which is where the real information is anyway.
 *
 * Every transfer below is exactly mass-conserving. That is checked, not
 * asserted: engine.js audits the closure of the whole profile every run and
 * reports the residual.
 */

/** Water held in the root zone, mm. */
export function rootWater(Dr, Zr, rz_fc) {
  return 1000.0 * rz_fc * Zr - Dr;
}

export function makeSoilProfile() {
  return {
    name: 'threeCompartment',

    /**
     * ctx: { rz_fc, rz_ini, Zr0, Zr_profile, subsoil_ini }
     */
    init(ctx) {
      let Zs0 = Math.max(ctx.Zr_profile - ctx.Zr0, 0.0);
      return {
        Dr: 1000.0 * (ctx.rz_fc - ctx.rz_ini) * ctx.Zr0,
        Ss: 1000.0 * ctx.subsoil_ini * Zs0,
      };
    },

    /**
     * Roots deepen by dZr (> 0). The newly reached slice arrives carrying
     * the subsoil's actual tracked water, which is the entire point of
     * keeping Ss: if that slice is wetter than the current root zone, the
     * crop's relative depletion drops and Ks rises.
     *
     * ctx: { rz_fc, rz_wp, Zs_prev }
     */
    grow(state, dZr, ctx) {
      // Exact share of the subsoil's water in the slice being absorbed. No
      // clamping: Ss is bounded to [wp*Zs, fc*Zs] by the operations below,
      // so the implied water content is already physical, and a clamp here
      // would silently create or destroy water. If roots are already at the
      // bottom of the profile, there is nothing left to absorb, so the
      // increment is charged at wilting point instead.
      let waterMoved;
      if (ctx.Zs_prev > 1e-6) waterMoved = ctx.Zs_prev > dZr ? state.Ss * (dZr / ctx.Zs_prev) : state.Ss;
      else waterMoved = 1000.0 * ctx.rz_wp * dZr;

      state.Ss = Math.max(state.Ss - waterMoved, 0.0);
      state.Dr += 1000.0 * ctx.rz_fc * dZr - waterMoved;
    },

    /**
     * The root zone shrinks by |dZr| — a crop is harvested and the next one
     * starts shallower, or a stage transition resets the depth. The root
     * zone is treated as uniformly mixed, so the departing slice leaves at
     * the zone's current average water content and Dr simply scales with
     * depth. The water it carries is handed to the subsoil rather than
     * discarded, which is what lets water banked under one crop still be
     * there for the next.
     *
     * ctx: { Zr_prev, Zr_new }
     */
    shrink(state, dZr, ctx) {
      let Zr_prev = Math.max(ctx.Zr_prev, 1e-9);
      let shrinkAmount = -dZr;
      // W_root = 1000 fc Zr - Dr, and the departing fraction of it is
      // shrinkAmount / Zr_prev.
      let departing = (1000.0 * ctx.rz_fc * Zr_prev - state.Dr) * (shrinkAmount / Zr_prev);
      state.Ss += departing;
      state.Dr = state.Dr * (ctx.Zr_new / Zr_prev);
    },

    /**
     * Water percolating past the root zone (FAO-56 Eq. 86's DP) enters the
     * subsoil. Whatever the subsoil cannot hold at field capacity leaves the
     * profile entirely — that, and only that, is deep percolation in the
     * output.
     *
     * ctx: { rz_fc, Zs_n }
     */
    receivePercolation(state, DPr, ctx) {
      state.Ss += DPr;
      let capacity = 1000.0 * ctx.rz_fc * ctx.Zs_n;
      let beyondProfile = Math.max(state.Ss - capacity, 0.0);
      state.Ss -= beyondProfile;
      return beyondProfile;
    },

    /**
     * Diffusive/vapour loss drawn from the subsoil, used only when the root
     * zone does not itself extend below the evaporating layer. Floored at
     * wilting point: vapour transport cannot dry soil below it.
     *
     * ctx: { rz_wp, Zs_n }
     */
    drawFromSubsoil(state, amount, ctx) {
      let floor = 1000.0 * ctx.rz_wp * ctx.Zs_n;
      let available = Math.max(state.Ss - floor, 0.0);
      let drawn = Math.min(amount, available);
      state.Ss -= drawn;
      return drawn;
    },

    /**
     * Relative wetness of the subsoil, 0 at wilting point and 1 at field
     * capacity. Drives the diffusive loss term.
     *
     * ctx: { rz_fc, rz_wp, Zs_n }
     */
    subsoilWetness(state, ctx) {
      if (!(ctx.Zs_n > 0.0)) return 0.0;
      let wp_mm = 1000.0 * ctx.rz_wp * ctx.Zs_n;
      let taw_s = Math.max(1000.0 * (ctx.rz_fc - ctx.rz_wp) * ctx.Zs_n, 1e-9);
      return Math.min(Math.max((state.Ss - wp_mm) / taw_s, 0.0), 1.0);
    },
  };
}
