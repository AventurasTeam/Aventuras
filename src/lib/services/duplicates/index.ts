/**
 * Duplicate entities, across every pool that has them.
 *
 * Its own service rather than a corner of the lorebook's, because two unrelated callers
 * need it and neither should import the other's barrel — `ai/lorebook`'s pulls in the SDK
 * and, through it, a rune store, which no plain module can be imported alongside.
 *
 * The name comparison itself lives in `./names`, written when the lore agent needed a
 * worklist. The **world state** had no detector at all, and it is where duplicates actually
 * accumulate: the classifier mints a
 * new `Character` whenever the story calls someone by a different title, so one save held
 * `Baron Kaelen` and `Forge-Master Kaelen`, `Captain Vor'koth`, `General Vor'koth` and
 * `The Captain` — thirty-eight rows for about thirty-one people.
 *
 * Two of those causes are now fixed at the source (see
 * `ClassifierService.formatExistingCharacters`). This module is for the rest, and for the
 * rows already written: it groups what looks like one subject and hands the groups to the
 * user, who is the only one who can say whether `Kael` and `Baron Kaelen` are one person.
 *
 * **A dismissal is remembered.** Without that, the same groups come back every time the
 * window is opened, and the second visit is useless — see `keptSeparateKey`.
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
   * Pool-qualified, because the worklist concatenates every pool and the names repeat
   * across them by design — the classifier's `Character` row and the lore agent's `Entry`
   * for the same person drift the same way, so `Kael`/`Kaelen` shows up in both. Two
   * groups sharing a key collide in the window's keyed `{#each}`, which is a render error
   * rather than a wrong answer.
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
 * **A group whose names all normalize to one key still gets a key**, `name|name`. Two rows
 * called `Kaelen` are the commonest duplicate there is and the only one nobody has to
 * judge, and a pairwise loop over a single distinct name produces nothing — so the group
 * read as "every pair already dismissed" and was dropped before it was ever shown, in the
 * window and in the agent's worklist alike. The self-pair is a real dismissal: two rows
 * that share a name and are genuinely two subjects stay dismissed on the next pass.
 */
export function pairKeys(names: string[]): string[] {
  const unique = [...new Set(names.map(normalizeName))].filter(Boolean).sort()
  if (unique.length === 1) return [`${unique[0]}|${unique[0]}`]
  const pairs: string[] = []
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      pairs.push(`${unique[i]}|${unique[j]}`)
    }
  }
  return pairs
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
