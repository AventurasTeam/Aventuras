// Squared, so the check costs no sqrt. Float32 round-trips through vec0, and
// truncated Matryoshka vectors are re-normalized after the cut, so the window
// has to absorb ordinary drift rather than pin an exact 1.
const NORM_SQ_TOLERANCE = 1e-3

/**
 * Dot product; equals cosine because every vector in play is unit-norm. That
 * invariant is enforced on write by lib/embedder, and re-checked here because
 * this is where a violation stops being detectable: a non-unit vector yields an
 * out-of-range dot product that the clamp below turns into a plausible perfect
 * score, top-ranking that row against every query on every turn.
 */
export function cosine(a: Float32Array, b: Float32Array): number {
  // Every vector reaching this function shares one dim per pass (the story's
  // model + effective dim are locked); a mismatch means upstream data is
  // corrupt, so fail loudly instead of scoring a truncated prefix or a
  // silent NaN.
  if (a.length !== b.length) {
    throw new RangeError(`cosine: dimension mismatch (${a.length} vs ${b.length})`)
  }
  let sum = 0
  let aSq = 0
  let bSq = 0
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i]
    aSq += a[i] * a[i]
    bSq += b[i] * b[i]
  }
  // Negated <=, not >: NaN fails every comparison, so `Math.abs(NaN - 1) > tol`
  // is FALSE and would wave a NaN component through — which MMR then propagates
  // via Math.max into every remaining candidate, dropping a whole type's pool as
  // below-threshold. Inverting makes the non-finite cases fail the check.
  if (!(Math.abs(aSq - 1) <= NORM_SQ_TOLERANCE) || !(Math.abs(bSq - 1) <= NORM_SQ_TOLERANCE)) {
    throw new RangeError(
      `cosine: vector is not unit-norm (|a|²=${aSq.toFixed(6)}, |b|²=${bSq.toFixed(6)})`,
    )
  }
  return Math.min(1, Math.max(-1, sum))
}
