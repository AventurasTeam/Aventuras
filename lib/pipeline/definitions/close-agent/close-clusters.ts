import { cosine } from '@/lib/retrieval'

/** chapter-close.md → 3e: the embedding similarity every pair of a cluster meets. */
export const CLUSTER_COSINE_MIN = 0.8
/** The cast every pair shares, over the smaller of its two casts. */
export const CLUSTER_CAST_OVERLAP_MIN = 0.5
/** The most non-system entries apart every pair's anchors sit. */
export const CLUSTER_ENTRY_SPAN_MAX = 3

export type ClusterInput = {
  id: string
  /** Unit-norm, one dimension across all rows: `cosine` throws otherwise. */
  vector: Float32Array
  cast: ReadonlySet<string>
  /** Index of its occurred_at entry among the range's non-system entries. */
  anchorIndex: number
}

// An empty cast shares nothing, so a row with no involvements clusters with nothing.
function castOverlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a]
  if (smaller.size === 0) return 0
  let shared = 0
  for (const id of smaller) if (larger.has(id)) shared++
  return shared / smaller.size
}

// The pair's cosine when it meets all three criteria, else null. Cheapest first: the cosine reads
// every dim.
function qualifyingCosine(a: ClusterInput, b: ClusterInput): number | null {
  if (Math.abs(a.anchorIndex - b.anchorIndex) > CLUSTER_ENTRY_SPAN_MAX) return null
  if (castOverlap(a.cast, b.cast) < CLUSTER_CAST_OVERLAP_MIN) return null
  const similarity = cosine(a.vector, b.vector)
  return similarity >= CLUSTER_COSINE_MIN ? similarity : null
}

const byAnchorThenId = (a: ClusterInput, b: ClusterInput): number =>
  a.anchorIndex - b.anchorIndex || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

type Pair = { first: number; second: number; similarity: number }

/** Strongest first; a tie goes to the pair whose earlier member sorts first, then its later one. */
const strongestFirst = (a: Pair, b: Pair): number =>
  b.similarity - a.similarity || a.first - b.first || a.second - b.second

/**
 * chapter-close.md → 3e's candidates, by complete linkage from the strongest pair down: every
 * pair meeting all three criteria is walked in descending cosine, and two rows' clusters merge
 * only when every cross pair meets all three too, so no chain drifts. A row sits in one cluster
 * at most; clusters of two or more return, each in anchor order (then id), ordered by their
 * first row.
 */
export function findClusters(rows: readonly ClusterInput[]): string[][] {
  const ordered = [...rows].sort(byAnchorThenId)
  const pairs: Pair[] = []
  const qualifying = new Set<number>()
  const pairKey = (first: number, second: number): number => first * ordered.length + second
  for (let first = 0; first < ordered.length; first++) {
    for (let second = first + 1; second < ordered.length; second++) {
      const similarity = qualifyingCosine(ordered[first], ordered[second])
      if (similarity === null) continue
      pairs.push({ first, second, similarity })
      qualifying.add(pairKey(first, second))
    }
  }

  const clusterOf = ordered.map((_, index) => [index])
  for (const { first, second } of pairs.sort(strongestFirst)) {
    const left = clusterOf[first]
    const right = clusterOf[second]
    if (left === right) continue
    const everyCrossPairFits = left.every((l) =>
      right.every((r) => qualifying.has(pairKey(Math.min(l, r), Math.max(l, r)))),
    )
    if (!everyCrossPairFits) continue
    const merged = [...left, ...right]
    for (const member of merged) clusterOf[member] = merged
  }

  return [...new Set(clusterOf)]
    .filter((members) => members.length >= 2)
    .map((members) => [...members].sort((a, b) => a - b))
    .sort((a, b) => a[0] - b[0])
    .map((members) => members.map((index) => ordered[index].id))
}
