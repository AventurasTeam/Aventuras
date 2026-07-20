import type { VaultCharacter, VaultScenario } from '$lib/types'

/**
 * Merge array changes from `prevArr` → `dataArr` onto `baseArr`.
 *
 * Detects three types of changes:
 * 1. **Genuine replacements**: Same index, different content, and the new value
 *    doesn't exist elsewhere in prev (not a shift from an insertion/deletion)
 * 2. **Removals**: Items that disappeared between previous and data
 * 3. **Additions**: Items that appeared between previous and data
 *
 * Uses count-based multiset tracking for removals so duplicate values are
 * handled correctly (removing one of two "John"s only removes one copy).
 * Positional differences that are actually shifts (the value at data[i]
 * exists elsewhere in prev) are NOT treated as replacements, preventing
 * duplication when deletions cause items to shift left.
 *
 * Unused replacements are inserted at their original index in descending
 * order to avoid index shift from prior insertions.
 *
 * **Known limitation**: When a string array element is renamed (e.g. NPC "Bob"
 * → "Robert") and a prior approval has shifted indices, the rename is treated
 * as a remove + append rather than an in-place modification, so the renamed
 * item may end up at the end of the array. This is cosmetic for NPC/tag lists.
 * For structured objects (lorebook entries), matching by stable key is preferable
 * but not yet implemented.
 */
export function mergeArrayLists(
  dataArr: unknown[],
  prevArr: unknown[],
  baseArr: unknown[],
): unknown[] {
  // 1. Detect genuine positional replacements (same index, different content)
  // A positional difference is only a genuine replacement if the new value
  // doesn't exist elsewhere in prevArr — otherwise it's a shift caused by
  // insertions/deletions, not a true replacement.
  const replacements: Record<number, unknown> = {}
  const replacementIndices: number[] = []
  const minLen = Math.min(dataArr.length, prevArr.length)

  // Build a multiset of prevArr values for shift detection
  const prevValueCounts = new Map<string, number>()
  for (const p of prevArr) {
    const s = JSON.stringify(p)
    prevValueCounts.set(s, (prevValueCounts.get(s) ?? 0) + 1)
  }

  for (let i = 0; i < minLen; i++) {
    if (JSON.stringify(dataArr[i]) !== JSON.stringify(prevArr[i])) {
      const dataStr = JSON.stringify(dataArr[i])
      // Check if this value exists elsewhere in prevArr (it's a shift, not a replacement)
      const prevCount = prevValueCounts.get(dataStr) ?? 0
      const sameIndexCount = JSON.stringify(prevArr[i]) === dataStr ? 1 : 0
      const existsElsewhereInPrev = prevCount > sameIndexCount

      if (!existsElsewhereInPrev) {
        // Genuine replacement: new value that doesn't appear elsewhere in prev
        replacements[i] = dataArr[i]
        replacementIndices.push(i)
      }
    }
  }

  // 2. Detect appended items (beyond previous length), skipping any that were
  // already added to baseArr by an earlier sibling change in this same
  // composition pass. Without this, composing multiple sibling pending
  // changes for the same entity (e.g. two update_character calls proposed
  // back-to-back, before either is approved) re-appends the same "new" items
  // every time: each change independently diffs against the same stale,
  // not-yet-approved `previous`, so from its own perspective the item is
  // genuinely new even though an earlier sibling already added it to baseArr.
  //
  // baseArr can contain a value for two different reasons: it was already
  // there (accounted for by prevArr) or an earlier sibling appended it. Only
  // the latter should suppress a duplicate appended item — so prevArr's own
  // counts are subtracted out first, leaving only the "extra" copies a
  // sibling is responsible for. Otherwise a genuinely-intended duplicate in
  // `data` (already present once in `previous`, intentionally added again)
  // would be silently dropped.
  const baseValueCounts = new Map<string, number>()
  for (const b of baseArr) {
    const s = JSON.stringify(b)
    baseValueCounts.set(s, (baseValueCounts.get(s) ?? 0) + 1)
  }
  for (const p of prevArr) {
    const s = JSON.stringify(p)
    const count = baseValueCounts.get(s)
    if (count) baseValueCounts.set(s, count - 1)
  }
  const appended: unknown[] = []
  for (let i = prevArr.length; i < dataArr.length; i++) {
    const item = dataArr[i]
    const s = JSON.stringify(item)
    const remaining = baseValueCounts.get(s) ?? 0
    if (remaining > 0) {
      baseValueCounts.set(s, remaining - 1)
      continue
    }
    appended.push(item)
  }

  // 3. Compute removals using count-based multiset
  // Count occurrences in dataArr to determine how many copies were removed
  const dataCounts = new Map<string, number>()
  for (const d of dataArr) {
    const s = JSON.stringify(d)
    dataCounts.set(s, (dataCounts.get(s) ?? 0) + 1)
  }
  const prevCounts = new Map<string, number>()
  for (const p of prevArr) {
    const s = JSON.stringify(p)
    prevCounts.set(s, (prevCounts.get(s) ?? 0) + 1)
  }

  // removedCounts tracks how many copies of each value should be removed
  const removedCounts = new Map<string, number>()
  for (const [key, prevCount] of prevCounts) {
    const dataCount = dataCounts.get(key) ?? 0
    const removed = prevCount - dataCount
    if (removed > 0) {
      removedCounts.set(key, removed)
    }
  }

  // 4. Walk baseArr, replacing removed items with their replacement or dropping them
  const usedReplacements = new Set<number>()
  const remainingRemoved = new Map(removedCounts)
  const result: unknown[] = []

  for (const item of baseArr) {
    const s = JSON.stringify(item)
    const stillNeedsRemoval = remainingRemoved.get(s)

    if (stillNeedsRemoval && stillNeedsRemoval > 0) {
      // This item is marked for removal — consume one count
      remainingRemoved.set(s, stillNeedsRemoval - 1)
      // Check if this removed items maps to a positional replacement
      const repIdx = findReplacementIndex(item, prevArr, replacementIndices)
      if (repIdx !== null && repIdx in replacements && !usedReplacements.has(repIdx)) {
        result.push(replacements[repIdx])
        usedReplacements.add(repIdx)
      }
      // If no replacement, the item is simply removed (or replaced above)
    } else {
      result.push(item)
    }
  }

  // 5. Insert unused replacements at their original indices (descending to avoid shift)
  const unusedDescending = replacementIndices
    .filter((idx) => !usedReplacements.has(idx))
    .sort((a, b) => b - a)
  for (const idx of unusedDescending) {
    result.splice(idx, 0, replacements[idx])
  }

  // 6. Append new items that weren't in previous
  for (const item of appended) {
    result.push(item)
  }

  return result
}

function findReplacementIndex(
  removedItem: unknown,
  prevArr: unknown[],
  replacementIndices: number[],
): number | null {
  const serialized = JSON.stringify(removedItem)
  for (const idx of replacementIndices) {
    if (idx < prevArr.length && JSON.stringify(prevArr[idx]) === serialized) {
      return idx
    }
  }
  return null
}

/**
 * Compute a delta by determining what `data` intends to change relative to
 * `previous`, then merging that intent onto `live`.
 *
 * For scalar fields: if the change modifies a value, use data's value.
 * For array fields: compute additions/removals/replacements relative to
 * `previous`, then apply those to the live array.
 */
export function mergeIntent(
  data: Record<string, unknown> | undefined,
  previous: Record<string, unknown> | undefined,
  live: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!data) return {}
  if (!previous) return { ...data }
  if (!live) return { ...data }

  const delta: Record<string, unknown> = {}
  for (const key of Object.keys(data)) {
    const dataVal = data[key]
    const prevVal = previous[key]

    if (JSON.stringify(dataVal) === JSON.stringify(prevVal)) continue

    if (Array.isArray(dataVal) && Array.isArray(prevVal) && Array.isArray(live[key])) {
      delta[key] = mergeArrayLists(
        dataVal as unknown[],
        prevVal as unknown[],
        live[key] as unknown[],
      )
    } else {
      delta[key] = dataVal
    }
  }
  return delta
}

/**
 * Compute a partial update by comparing data against previous.
 * Only includes fields that actually changed.
 */
export function computeDelta(
  data: Record<string, unknown>,
  previous: Record<string, unknown>,
): Record<string, unknown> {
  const delta: Record<string, unknown> = {}
  for (const key of Object.keys(data)) {
    if (JSON.stringify(data[key]) !== JSON.stringify(previous[key])) {
      delta[key] = data[key]
    }
  }
  return delta
}

/**
 * Apply pending changes onto a base record, using intent-based merging
 * for array fields so additions/removals accumulate correctly.
 */
export function composePendingOnto(
  base: Record<string, unknown>,
  changes: Array<{ data: Record<string, unknown>; previous: Record<string, unknown> }>,
): Record<string, unknown> {
  const result = JSON.parse(JSON.stringify(base)) as Record<string, unknown>
  for (const c of changes) {
    const delta = mergeIntent(c.data, c.previous, result)
    Object.assign(result, delta)
  }
  return result
}

export function scenarioToRecord(s: VaultScenario): Record<string, unknown> {
  return {
    name: s.name,
    description: s.description,
    settingSeed: s.settingSeed,
    npcs: s.npcs,
    primaryCharacterName: s.primaryCharacterName,
    firstMessage: s.firstMessage,
    alternateGreetings: s.alternateGreetings ?? [],
    tags: s.tags,
    favorite: s.favorite,
  }
}

export function characterToRecord(c: VaultCharacter): Record<string, unknown> {
  return {
    name: c.name,
    description: c.description,
    traits: c.traits,
    visualDescriptors: c.visualDescriptors,
    portrait: c.portrait,
    tags: c.tags,
    favorite: c.favorite,
  }
}
