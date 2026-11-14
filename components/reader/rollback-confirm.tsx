import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import type { RollbackCounts } from '@/lib/actions'
import { t } from '@/lib/i18n'

import { chapterListLabel } from './chapter-list-label'
import { classifyRegenerateGate } from './regenerate-gate'

type RollbackConfirmModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetEntryNumber: number
  counts: RollbackCounts
  onConfirm: () => void
  variant?: 'rollback' | 'regenerate'
}

type CopyKind =
  | 'rollback'
  | 'regenerate'
  | 'regenerate-terminal'
  | 'regenerate-close'
  | 'regenerate-kept-work'

// Read from the counts at each render, never stored: a recount can move an open regenerate confirm
// between kinds, and an `immediate` one has nothing after the reply.
function copyKindOf(variant: 'rollback' | 'regenerate', counts: RollbackCounts): CopyKind {
  if (variant === 'rollback') return 'rollback'
  const gate = classifyRegenerateGate(counts)
  if (gate === 'immediate') return 'regenerate-terminal'
  if (gate === 'cascade-confirm') return 'regenerate'
  return counts.chapters > 0 ? 'regenerate-close' : 'regenerate-kept-work'
}

function bodyOf(kind: CopyKind, entryNumber: number): string {
  switch (kind) {
    case 'rollback':
      return t('reader:rollbackConfirm.body', { entryNumber })
    case 'regenerate':
      return t('reader:regenerateConfirm.body', { entryNumber })
    case 'regenerate-terminal':
      return t('reader:regenerateConfirm.terminalBody', { entryNumber })
    case 'regenerate-close':
      return t('reader:regenerateConfirm.closeBody', { entryNumber })
    case 'regenerate-kept-work':
      return t('reader:regenerateConfirm.keptWorkBody', { entryNumber })
  }
}

export function RollbackConfirmModal({
  open,
  onOpenChange,
  targetEntryNumber,
  counts,
  onConfirm,
  variant = 'rollback',
}: RollbackConfirmModalProps) {
  const kind = copyKindOf(variant, counts)
  const regenerate = variant === 'regenerate'
  const title = regenerate
    ? t('reader:regenerateConfirm.title', { entryNumber: targetEntryNumber })
    : t('reader:rollbackConfirm.title', { entryNumber: targetEntryNumber })
  const irreversible = regenerate
    ? t('reader:regenerateConfirm.irreversible')
    : t('reader:rollbackConfirm.irreversible')
  const confirmLabel = regenerate
    ? t('reader:regenerateConfirm.confirm')
    : t('reader:rollbackConfirm.confirm')
  // The close copy names its chapter in a line of its own.
  const chapterLines = kind !== 'regenerate-close'
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {bodyOf(kind, targetEntryNumber)}
            <Text size="sm">
              {`\n\n• ${t('reader:rollbackConfirm.entries', { count: counts.entries })}`}
            </Text>
            {chapterLines && counts.reopenedChapter != null ? (
              <Text size="sm" className="font-semibold">
                {`\n• ${t('reader:rollbackConfirm.chapterReopened', { number: counts.reopenedChapter })}`}
              </Text>
            ) : null}
            {chapterLines && counts.removedChapters.length > 0 ? (
              <Text size="sm" className="font-semibold">
                {`\n• ${t('reader:rollbackConfirm.chaptersRemoved', {
                  count: counts.removedChapters.length,
                  list: chapterListLabel(counts.removedChapters),
                })}`}
              </Text>
            ) : null}
            <Text size="sm">
              {`\n• ${t('reader:rollbackConfirm.worldState', { count: counts.worldStateChanges })}`}
            </Text>
            {kind === 'regenerate-close' ? (
              <Text size="sm" className="font-semibold">
                {`\n\n${t('reader:regenerateConfirm.closeReturns', {
                  number: counts.reopenedChapter ?? counts.removedChapters[0],
                })}`}
              </Text>
            ) : null}
            {kind === 'regenerate-close' ? (
              <Text size="sm">{`\n${t('reader:regenerateConfirm.closeRunsAgain')}`}</Text>
            ) : null}
            <Text size="sm" className="font-bold">
              {`\n\n${irreversible}`}
            </Text>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">
              <Text>{t('cancel')}</Text>
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant="destructive" onPress={onConfirm}>
              <Text>{confirmLabel}</Text>
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export type { RollbackConfirmModalProps }
