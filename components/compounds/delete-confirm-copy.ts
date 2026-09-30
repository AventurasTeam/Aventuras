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

/** Every domain's delete confirm shares this undo hint, naming the reader's own undo label. */
export function deleteUndoHint(): string {
  return t('common:deleteUndoHint', { action: t('reader:actions.undo') })
}
