import type { VaultCharacter, VaultScenario } from '$lib/types'

/**
 * Merge array changes from `prevArr` → `dataArr` onto `baseArr`.
 *
 * Detects in-place replacements (same index, different content) and preserves
 * position, while appending pure additions and removing items that
 * disappeared between previous and data.
 */
export function mergeArrayLists(
  dataArr: unknown[],
  prevArr: unknown[],
  baseArr: unknown[],
): unknown[] {
  const replacements: Record<number, unknown> = {}
  const replacementIndices: number[] = []
  const minLen = Math.min(dataArr.length, prevArr.length)
  for (let i = 0; i < minLen; i++) {
    if (JSON.stringify(dataArr[i]) !== JSON.stringify(prevArr[i])) {
      replacements[i] = dataArr[i]
      replacementIndices.push(i)
    }
  }

  const appended: unknown[] = []
  for (let i = prevArr.length; i < dataArr.length; i++) {
    appended.push(dataArr[i])
  }

  const removedSerialized: Record<string, boolean> = {}
  for (const p of prevArr) {
    const s = JSON.stringify(p)
    if (!dataArr.some((d) => JSON.stringify(d) === s)) {
      removedSerialized[s] = true
    }
  }

  const usedReplacements: Record<number, boolean> = {}
  const result: unknown[] = []
  for (const item of baseArr) {
    const s = JSON.stringify(item)
    if (removedSerialized[s]) {
      const repIdx = findReplacementIndex(item, prevArr, replacementIndices)
      if (repIdx !== null && repIdx in replacements && !usedReplacements[repIdx]) {
        result.push(replacements[repIdx])
        usedReplacements[repIdx] = true
      }
    } else {
      result.push(item)
    }
  }

  for (const idx of replacementIndices) {
    if (!usedReplacements[idx]) {
      if (idx < result.length) {
        result.splice(idx, 0, replacements[idx])
      } else {
        result.push(replacements[idx])
      }
    }
  }

  for (const item of appended) {
    if (!result.some((r) => JSON.stringify(r) === JSON.stringify(item))) {
      result.push(item)
    }
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
  if (!live) return computeDelta(data, previous)

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
    for (const key of Object.keys(c.data)) {
      if (JSON.stringify(c.data[key]) !== JSON.stringify(c.previous[key])) {
        const dataVal = c.data[key]
        const prevVal = c.previous[key]
        const resultVal = result[key]
        if (Array.isArray(dataVal) && Array.isArray(prevVal) && Array.isArray(resultVal)) {
          result[key] = mergeArrayLists(
            dataVal as unknown[],
            prevVal as unknown[],
            resultVal as unknown[],
          )
        } else {
          result[key] = c.data[key]
        }
      }
    }
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
