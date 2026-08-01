import { cosine } from './vector'

export type MmrInput = { id: string; score: number; vector: Float32Array }
export type MmrRanked = MmrInput & { mmrScore: number }

/**
 * Maximal Marginal Relevance, retrieval.md → Diversity — MMR.
 *
 *   mmr(c, S) = λ_div * score(c) - (1 - λ_div) * max(sim(c, c') for c' in S)
 *
 * S starts empty and max(...) is 0 there, so the first pick is pure score.
 * Incremental maxSim per candidate rather than rescanning S each round —
 * retrieval.md's PoC found the naive full-rescan MMR at ~280 ms regardless
 * of pool size, dropping to ~15-18 ms once rescanning was replaced with this
 * incremental approach.
 */
export function mmrRank(candidates: readonly MmrInput[], lambdaDiv: number): MmrRanked[] {
  const remaining = [...candidates]
  // Keyed by id: a pool holds one Candidate per id (Q1/Q2/Q3 hits are merged
  // into a single row before ranking), so ids don't collide here.
  const maxSim = new Map<string, number>(remaining.map((c) => [c.id, 0]))
  const out: MmrRanked[] = []

  while (remaining.length > 0) {
    let bestIdx = 0
    let bestScore = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i]
      const score = lambdaDiv * c.score - (1 - lambdaDiv) * (maxSim.get(c.id) ?? 0)
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }
    const [picked] = remaining.splice(bestIdx, 1)
    out.push({ ...picked, mmrScore: bestScore })
    for (const c of remaining) {
      maxSim.set(c.id, Math.max(maxSim.get(c.id) ?? 0, cosine(c.vector, picked.vector)))
    }
  }
  return out
}
