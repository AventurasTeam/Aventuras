/**
 * The writers whose result the reader shows in place. Each tags its entry delta, so undo can name
 * the target and skip the confirm an unseen one takes (data-model.md → Entry mutability &
 * rollback). A writer that doesn't tag reads as unseen.
 */
export const UNDO_KINDS = ['entryText', 'entryScene', 'entryTime', 'suggestionRefresh'] as const
export type UndoKind = (typeof UNDO_KINDS)[number]

/** Payload metadata on a tagged writer's entry delta: its `UndoKind`. A `$` key, skipped by walks. */
export const UNDO_KIND_KEY = '$undoKind' as const

export function isUndoKind(value: unknown): value is UndoKind {
  return typeof value === 'string' && (UNDO_KINDS as readonly string[]).includes(value)
}
