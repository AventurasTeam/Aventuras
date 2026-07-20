// L2-normalize a vector to unit length. A zero vector returns as-is (no 0/0 NaN),
// and an already-unit vector is returned untouched — the tolerance makes the facade's
// universal re-normalize an idempotent guard rather than a redundant copy.
export function l2Normalize(vec: Float32Array): Float32Array {
  let sumSquares = 0
  for (let d = 0; d < vec.length; d++) sumSquares += vec[d] * vec[d]

  const norm = Math.sqrt(sumSquares)
  if (norm === 0 || Math.abs(1 - norm) < 1e-6) return vec

  const out = new Float32Array(vec.length)
  for (let d = 0; d < vec.length; d++) out[d] = vec[d] / norm
  return out
}

// Mean-pool a [tokens × dim] row-major hidden-state matrix over attended tokens
// only, then L2-normalize. All-masked inputs return zeros rather than propagating
// NaN from a 0/0 divide.
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

  for (let d = 0; d < dim; d++) pooled[d] /= attended
  return l2Normalize(pooled)
}
