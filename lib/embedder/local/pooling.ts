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
  // A mask longer than the tensor reads past the end as undefined, which pools
  // to NaN. vec0 stores the bytes without complaint and the stale flag is
  // cleared, so a poisoned row would never re-embed itself.
  const requiredLength = attentionMask.length * dim
  if (tokenEmbeddings.length < requiredLength) {
    throw new Error(
      `hidden-state tensor too small: need ${requiredLength} floats for ${attentionMask.length} tokens × ${dim}, got ${tokenEmbeddings.length}`,
    )
  }

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

  // NaN/Infinity survives normalization (norm === 0 is false for NaN, so the
  // divide runs anyway) and nothing downstream inspects finiteness.
  for (let d = 0; d < dim; d++) {
    if (!Number.isFinite(pooled[d])) {
      throw new Error('pooled embedding contains a non-finite value')
    }
  }

  return l2Normalize(pooled)
}
