import { cosine } from '@/lib/retrieval'

/** chapter-close.md → 3e: the embedding similarity every pair of a cluster meets. */
export const CLUSTER_COSINE_MIN = 0.8
/** The cast every pair shares, over the smaller of its two casts. */
export const CLUSTER_CAST_OVERLAP_MIN = 0.5
/** The most non-system entries apart every pair's anchors sit. */
export const CLUSTER_ENTRY_SPAN_MAX = 3

export type ClusterInput = {
  id: string
  vector: Float32Array
  cast: ReadonlySet<string>
  /** Index of its occurred_at entry among the range's non-system entries; null never clusters. */
  anchorIndex: number | null
}

type Anchored = ClusterInput & { anchorIndex: number }

// An empty cast shares nothing, so a row with no involvements clusters with nothing.
function castOverlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a]
  if (smaller.size === 0) return 0
  let shared = 0
  for (const id of smaller) if (larger.has(id)) shared++
  return shared / smaller.size
}

// Cheapest first: the cosine reads every dim.
function belongTogether(a: Anchored, b: Anchored): boolean {
  return (
    Math.abs(a.anchorIndex - b.anchorIndex) <= CLUSTER_ENTRY_SPAN_MAX &&
    castOverlap(a.cast, b.cast) >= CLUSTER_CAST_OVERLAP_MIN &&
    cosine(a.vector, b.vector) >= CLUSTER_COSINE_MIN
  )
}

const byAnchorThenId = (a: Anchored, b: Anchored): number =>
  a.anchorIndex - b.anchorIndex || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * chapter-close.md → 3e's candidates. Greedy in anchor order: each unassigned row opens a cluster
 * that a later unassigned row joins only when it meets every member, so no chain drifts. A row
 * sits in one cluster at most; clusters of two or more return, each in anchor order.
 */
export function findClusters(rows: readonly ClusterInput[]): string[][] {
  const anchored = rows
    .filter((row): row is Anchored => row.anchorIndex !== null)
    .sort(byAnchorThenId)
  const assigned = new Set<string>()
  const clusters: string[][] = []
  for (const [at, seed] of anchored.entries()) {
    if (assigned.has(seed.id)) continue
    assigned.add(seed.id)
    const members = [seed]
    for (const candidate of anchored.slice(at + 1)) {
      if (assigned.has(candidate.id)) continue
      if (!members.every((member) => belongTogether(member, candidate))) continue
      members.push(candidate)
      assigned.add(candidate.id)
    }
    if (members.length >= 2) clusters.push(members.map(({ id }) => id))
  }
  return clusters
}
