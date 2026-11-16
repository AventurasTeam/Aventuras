import { t } from '@/lib/i18n'

export type DeleteConfirmCopy = {
  /** Ends with `?` (alert-dialog.md → Copy contract). */
  title: string
  description: string
  /** What goes with the row, one line each. */
  impacts: readonly string[]
  /** Verb-shaped: `Delete character`, never `OK`. */
  confirmLabel: string
}

/**
 * Every domain's delete confirm shares this undo hint. It quotes no menu label: the reader's Undo
 * names its target, and a quoted label would drift from it in other languages (world.md → Delete).
 */
export function deleteUndoHint(): string {
  return t('common:deleteUndoHint')
}
