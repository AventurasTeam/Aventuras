// Mean-pool a [tokens × dim] row-major hidden-state matrix over attended tokens
// only, then L2-normalize. Zero-vector inputs (all tokens masked, or a genuine
// zero pooled vector) return zeros rather than propagating NaN from a 0/0 divide.
export function meanPoolAndNormalize(
  tokenEmbeddings: Float32Array,
  attentionMask: ArrayLike<number>,
  dim: number,
): Float32Array {
  const pooled = new Float32Array(dim)
  let attended = 0

  for (let t = 0; t < attentionMask.length; t++) {
    if (!attentionMask[t]) continue
    attended++
    const base = t * dim
    for (let d = 0; d < dim; d++) pooled[d] += tokenEmbeddings[base + d]
  }

  if (attended === 0) return pooled

  let sumSquares = 0
  for (let d = 0; d < dim; d++) {
    const mean = pooled[d] / attended
    pooled[d] = mean
    sumSquares += mean * mean
  }

  const norm = Math.sqrt(sumSquares)
  if (norm === 0) return pooled

  for (let d = 0; d < dim; d++) pooled[d] /= norm
  return pooled
}
