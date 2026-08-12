/**
 * Duplicate entities, across every pool that has them.
 *
 * Its own service rather than a corner of the lorebook's, because two unrelated callers
 * need it and neither should import the other's barrel — `ai/lorebook`'s pulls in the SDK
 * and, through it, a rune store, which no plain module can be imported alongside.
 *
 * The name comparison lives in `./names`. The **world state** had no detector at all and is
 * where duplicates accumulate: the classifier mints a new `Character` whenever the story
 * calls someone by a different title, which on a measured save left thirty-eight rows for
 * about thirty-one people. Some of that is now fixed at the source (see
 * `ClassifierService.formatExistingCharacters`); this is for the rest, and for the rows
 * already written. Only the user can say whether two of them are one person.
 *
 * **A dismissal is remembered**, or the same groups come back every time the window is
 * opened — see `keptSeparateKey`.
 *
 * Plain TypeScript: no store, no database, no SDK.
 */

import { findDuplicateGroups, normalizeName, type DuplicateGroup } from './names'

/** Which pool a group belongs to. Groups never span pools: they are different records. */
export type DuplicatePool = 'character' | 'location' | 'item' | 'lorebook'

/** The minimum this module needs to compare two records of any pool. */
export interface DuplicateEntity {
  id: string
  name: string
  aliases?: string[]
  /** Sub-kind within the pool. Lorebook entries have one; world-state records do not. */
  type?: string
}

export interface EntityDuplicateGroup {
  pool: DuplicatePool
  /** The records, in the order the detector grouped them. */
  entities: DuplicateEntity[]
  reason: DuplicateGroup['reason']
  /**
   * Stable identity of this group within the whole worklist.
   *
   * Pool-qualified: the worklist concatenates every pool and the names repeat across them
   * by design — a `Character` row and the lorebook `Entry` for one person drift the same
   * way — and two groups sharing a key collide in the window's keyed `{#each}`.
   */
  key: string
}

/**
 * The stored form of "these are not the same subject".
 *
 * Normalized names rather than ids, because a rename must not resurrect a decision the
 * user already made, and a merge elsewhere must not either. Sorted, so the pair is the
 * same key whichever order it was seen in.
 */
export function keptSeparateKey(names: string[]): string {
  return [...new Set(names.map(normalizeName))].filter(Boolean).sort().join('|')
}

/**
 * Every pairwise dismissal a group implies.
 *
 * Stored per pair, not per group: the detector is transitive, so a group of three can
 * later show up as a group of two once one member is merged away, and a whole-group key
 * would no longer match. Dismissing {A,B,C} therefore stores {A,B}, {A,C}, {B,C}.
 *
 * **A group whose names all normalize to one key still gets one**, `name|name`. A pairwise
 * loop over a single distinct name produces nothing, which reads as "every pair already
 * dismissed" — so two rows both called `Kaelen` were dropped before being shown.
 */
export function pairKeys(names: string[]): string[] {
  const normalized = names.map(normalizeName).filter(Boolean)
  const counts = new Map<string, number>()
  for (const name of normalized) {
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }

  const unique = [...counts.keys()].sort()
  const pairs: string[] = []

  // Add self-pairs for names that appear multiple times in the group
  for (const [name, count] of counts.entries()) {
    if (count > 1) {
      pairs.push(`${name}|${name}`)
    }
  }

  // Add cross-pairs for distinct names
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      pairs.push(`${unique[i]}|${unique[j]}`)
    }
  }

  return pairs.sort()
}

/**
 * How a stored dismissal is qualified by pool, and how it is read back.
 *
 * The database keeps one row per `(pool, pair)` and hands back a flat `pool:pair` set, so
 * every caller had to know the separator: two wrote the prefix, two stripped it, one with
 * a hardcoded `'lorebook:'`. A pool added later would have had to find all four.
 */
export function scopeToPool(keys: ReadonlySet<string>, pool: DuplicatePool): Set<string> {
  const prefix = `${pool}:`
  return new Set([...keys].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)))
}

/** A group survives only while at least one of its pairs has not been dismissed. */
function isOpen(names: string[], dismissed: ReadonlySet<string>): boolean {
  return pairKeys(names).some((pair) => !dismissed.has(pair))
}

/**
 * Group one pool's records.
 *
 * World-state records carry no sub-kind, so they are all given the same one: within a
 * pool every record is already the same kind of thing, and the detector only uses `type`
 * to keep a location from being compared fuzzily against a character.
 */
export function findEntityDuplicates(
  pool: DuplicatePool,
  entities: DuplicateEntity[],
  dismissed: ReadonlySet<string> = new Set(),
): EntityDuplicateGroup[] {
  const groups = findDuplicateGroups(
    entities.map((e) => ({ name: e.name, aliases: e.aliases, type: e.type ?? pool })),
  )

  return groups
    .map((group) => ({
      pool,
      entities: group.indices.map((i) => entities[i]),
      reason: group.reason,
      key: `${pool}:${keptSeparateKey(group.names)}`,
    }))
    .filter((group) =>
      isOpen(
        group.entities.map((e) => e.name),
        dismissed,
      ),
    )
}

export {
  findDuplicateGroups,
  formatDuplicateGroup,
  normalizeName,
  editDistance,
  type DuplicateGroup,
  type DuplicateReason,
  type DuplicateCandidateInput,
} from './names'
