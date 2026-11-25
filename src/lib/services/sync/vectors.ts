import type { SyncStatus, SyncVector } from '#lib/types/sync.ts'

type Comparison = Extract<SyncStatus, 'inSync' | 'newerHere' | 'newerThere' | 'changedOnBoth'>

export function compareVectors(mine: SyncVector, theirs: SyncVector): Comparison {
  let ahead = false
  let behind = false
  for (const device of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    const here = mine[device] ?? 0
    const there = theirs[device] ?? 0
    if (here > there) ahead = true
    if (there > here) behind = true
  }
  if (ahead && behind) return 'changedOnBoth'
  if (ahead) return 'newerHere'
  if (behind) return 'newerThere'
  return 'inSync'
}

export function mergeVectors(a: SyncVector, b: SyncVector): SyncVector {
  const merged: SyncVector = { ...a }
  for (const [device, counter] of Object.entries(b)) {
    merged[device] = Math.max(merged[device] ?? 0, counter)
  }
  return merged
}

/** Outranks both inputs, so neither discarded version can later read as newer. */
export function resolveVector(mine: SyncVector, theirs: SyncVector, device: string): SyncVector {
  const merged = mergeVectors(mine, theirs)
  merged[device] = (merged[device] ?? 0) + 1
  return merged
}

/** The vector a device ends with after taking `incoming` over `local`. */
export function vectorAfterApplying(
  local: SyncVector | null,
  incoming: SyncVector,
  device: string,
): SyncVector {
  if (!local) return incoming
  const comparison = compareVectors(local, incoming)
  return comparison === 'inSync' || comparison === 'newerThere'
    ? incoming
    : resolveVector(local, incoming, device)
}
