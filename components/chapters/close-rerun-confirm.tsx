import type { ReactElement } from 'react'

import { ReasonButton } from '@/components/compounds/reason-button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import type { CloseRerunPreview } from '@/lib/actions'
import { t } from '@/lib/i18n'

import { chapterImpactLines } from './chapter-impact-lines'

type Shortcut = NonNullable<CloseRerunPreview['shortcut']>

export type CloseRerunConfirmProps = {
  open: boolean
  preview: CloseRerunPreview
  /**
   * Why the actions disable: a run's gate reason, a close owed, or an in-flight refusal's hold.
   * Hidden while `pending`: the start trips the gate itself, so it would read as some other run.
   */
  blockedReason?: string
  /** A start is in flight; every button disables, and an Esc does nothing. */
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}

function reversalLines(preview: CloseRerunPreview): string[] {
  const lines = chapterImpactLines(preview.reversal)
  return lines.length > 0 ? lines : [t('chapters:rerunConfirm.noChanges')]
}

function turnsLines(shortcut: Shortcut): string[] {
  return [
    t('chapters:rerunConfirm.entries', {
      count: shortcut.entries.count,
      first: shortcut.entries.first,
      last: shortcut.entries.last,
    }),
    t('chapters:rerunConfirm.worldChanges', { count: shortcut.counts.worldStateChanges }),
  ]
}

/**
 * chapter-timeline.md → Re-run a close. With turns since, the three-button footer departs from
 * alert-dialog.md as the delete's does; the fork renders held until Re-run on new branch is
 * wired (C16, M6.5).
 */
export function CloseRerunConfirm({
  open,
  preview,
  blockedReason,
  pending,
  onCancel,
  onConfirm,
}: CloseRerunConfirmProps): ReactElement {
  const reason = pending ? undefined : blockedReason
  const actionsDisabled = pending || reason != null
  const { shortcut } = preview
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel()
      }}
    >
      <AlertDialogContent busy={actionsDisabled}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('chapters:rerunConfirm.title', { number: preview.chapterNumber })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {preview.model != null
              ? t('chapters:rerunConfirm.framing', { model: preview.model })
              : t('chapters:rerunConfirm.framingNoModel')}
            {reversalLines(preview).map((line, index) => (
              <Text key={line} size="sm">
                {`${index === 0 ? '\n\n' : '\n'}• ${line}`}
              </Text>
            ))}
            {shortcut != null ? (
              <>
                <Text size="sm">
                  {`\n\n${t('chapters:rerunConfirm.turnsFollowed', { count: shortcut.turns })}`}
                </Text>
                {turnsLines(shortcut).map((line) => (
                  <Text key={line} size="sm">{`\n• ${line}`}</Text>
                ))}
                <Text size="sm">{`\n\n${t('chapters:rerunConfirm.rollbackWarning')}`}</Text>
              </>
            ) : null}
            <Text size="sm">
              {`\n\n${t('chapters:rerunConfirm.cost', { count: preview.tokens })}`}
            </Text>
            <Text size="sm">{`\n\n${t('chapters:rerunConfirm.undoLine')}`}</Text>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary" disabled={pending}>
              <Text>{t('chapters:rerunConfirm.cancel')}</Text>
            </Button>
          </AlertDialogCancel>
          {/* Plain buttons: AlertDialogAction would also request close, dismissing the confirm
              before the start settles; the host closes it as the chain starts or refuses. */}
          {shortcut != null ? (
            <>
              <ReasonButton
                layout="stretch"
                variant="destructive"
                disabled={actionsDisabled}
                disabledReason={reason}
                onPress={onConfirm}
              >
                <Text>{t('chapters:rerunConfirm.rollbackAndRerun')}</Text>
              </ReasonButton>
              <ReasonButton
                layout="stretch"
                variant="primary"
                disabled
                disabledReason={t('chapters:rerunConfirm.rerunOnBranchLater')}
              >
                <Text>{t('chapters:rerunConfirm.rerunOnBranch')}</Text>
              </ReasonButton>
            </>
          ) : (
            <ReasonButton
              layout="stretch"
              variant="primary"
              disabled={actionsDisabled}
              disabledReason={reason}
              onPress={onConfirm}
            >
              <Text>{t('chapters:rerunConfirm.rerun')}</Text>
            </ReasonButton>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
