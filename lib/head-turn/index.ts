/** Structural, so a full `StoryEntry` row and a three-column projection both fit. */
export type TurnEntry = { id: string; kind: string; position: number }

export type HeadTurn<T extends TurnEntry> = {
  /** The narrative tail: the last entry that is not a `system` banner. */
  tail: T
  /** The entry before the tail, whatever its kind. */
  previous: T | null
  /** `previous` when the pair is a turn — an `ai_reply` tail over its `user_action`. */
  origin: T | null
}

/**
 * The one definition of the branch's head turn, so the action layer's invalidation scope
 * and the reader's edit affordances cannot drift apart
 * (data-model.md -> Entry mutability & rollback).
 *
 * Rows MUST be ordered ascending by position; only the tail end is read.
 */
export function resolveHeadTurn<T extends TurnEntry>(rows: readonly T[]): HeadTurn<T> | null {
  // A `system` entry is a diagnostic banner at MAX(position) + 1 carrying no delta of its
  // own, so every tail rule reads past it rather than letting it take the tail off the
  // real last entry.
  const narrative = rows.filter((r) => r.kind !== 'system')
  const tail = narrative.at(-1)
  if (!tail) return null
  const previous = narrative.at(-2) ?? null
  return {
    tail,
    previous,
    origin: tail.kind === 'ai_reply' && previous?.kind === 'user_action' ? previous : null,
  }
}
