/** Dot product; equals cosine because every vector in play is unit-norm. */
export function cosine(a: Float32Array, b: Float32Array): number {
  // Every vector reaching this function shares one dim per pass (the story's
  // model + effective dim are locked); a mismatch means upstream data is
  // corrupt, so fail loudly instead of scoring a truncated prefix or a
  // silent NaN.
  if (a.length !== b.length) {
    throw new RangeError(`cosine: dimension mismatch (${a.length} vs ${b.length})`)
  }
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return Math.min(1, Math.max(-1, sum))
}
