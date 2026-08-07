import { cosine } from './vector'

export type MmrInput = { id: string; score: number; vector: Float32Array }
export type MmrRanked<T extends MmrInput = MmrInput> = T & { mmrScore: number }

/**
 * Maximal Marginal Relevance, retrieval.md → Diversity — MMR.
 *
 *   mmr(c, S) = λ_div * score(c) - (1 - λ_div) * max(sim(c, c') for c' in S)
 *
 * S starts empty and max(...) is 0 there, so the first pick is pure score.
 * Incremental maxSim per candidate rather than rescanning S each round.
 */
export function mmrRank<T extends MmrInput>(
  candidates: readonly T[],
  lambdaDiv: number,
): MmrRanked<T>[] {
  const remaining = [...candidates]
  // Keyed by id: a pool holds one Candidate per id (Q1/Q2/Q3 hits are merged
  // into a single row before ranking), so ids don't collide here.
  const maxSim = new Map<string, number>()
  const out: MmrRanked<T>[] = []

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
      const similarity = cosine(c.vector, picked.vector)
      const prior = maxSim.get(c.id)
      maxSim.set(c.id, prior === undefined ? similarity : Math.max(prior, similarity))
    }
  }
  return out
}
