import { useEffect, useRef, type ReactElement } from 'react'
import { Platform, type View } from 'react-native'

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
import type { ChapterDeleteMode, ChapterDeletePreview } from '@/lib/actions'
import type { ChapterDeleteAfter } from '@/lib/chapters'
import { t } from '@/lib/i18n'

const AFTER_COPY = {
  'closes-next-send': 'chapters:deleteConfirm.after.closesNextSend',
  waits: 'chapters:deleteConfirm.after.waits',
  'stays-open': 'chapters:deleteConfirm.after.staysOpen',
} as const satisfies Record<ChapterDeleteAfter, string>

export type ChapterDeleteConfirmProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  preview: ChapterDeletePreview
  /**
   * Set while a run holds the gate; both actions disable with it. Hidden while `pending`: the
   * removal trips the gate itself, and the reason would read as some other run.
   */
  blockedReason?: string
  /**
   * A removal is running (`useChapterDeleteConfirm().pending`); every button disables, Cancel
   * included.
   */
  pending?: boolean
  onDelete: (mode: ChapterDeleteMode) => void
}

// A count line at zero is left out: a close can land with no agent writes.
function countLines({ createdLore, otherChanges, turnsSince }: ChapterDeletePreview): string[] {
  const lines: string[] = []
  if (createdLore.count > 0)
    lines.push(
      createdLore.userEdited
        ? t('chapters:deleteConfirm.loreEdited', { count: createdLore.count })
        : t('chapters:deleteConfirm.lore', { count: createdLore.count }),
    )
  if (otherChanges > 0)
    lines.push(t('chapters:deleteConfirm.otherChanges', { count: otherChanges }))
  if (turnsSince > 0) lines.push(t('chapters:deleteConfirm.turnsSince', { count: turnsSince }))
  return lines
}

export function ChapterDeleteConfirm({
  open,
  onOpenChange,
  preview,
  blockedReason,
  pending = false,
  onDelete,
}: ChapterDeleteConfirmProps): ReactElement {
  const reason = pending ? undefined : blockedReason
  const actionsDisabled = pending || reason != null
  const contentRef = useRef<View>(null)
  // Chromium blurs a button the moment it disables; the dialog takes focus so Tab stays inside.
  useEffect(() => {
    if (Platform.OS !== 'web' || !open || !actionsDisabled) return
    const content = contentRef.current as unknown as HTMLElement | null
    if (content != null && !content.contains(document.activeElement)) content.focus()
  }, [open, actionsDisabled])
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent ref={contentRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('chapters:deleteConfirm.title', { number: preview.chapterNumber })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('chapters:deleteConfirm.body')}
            {countLines(preview).map((line, index) => (
              <Text key={line} size="sm">
                {`${index === 0 ? '\n\n' : '\n'}• ${line}`}
              </Text>
            ))}
            <Text size="sm">{`\n\n${t(AFTER_COPY[preview.after])}`}</Text>
            {preview.after === 'closes-next-send' ? (
              <Text size="sm">{`\n${t('chapters:deleteConfirm.dividerLine')}`}</Text>
            ) : null}
            <Text size="sm" className="font-bold">
              {`\n\n${t('chapters:deleteConfirm.irreversible')}`}
            </Text>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary" disabled={pending}>
              <Text>{t('cancel')}</Text>
            </Button>
          </AlertDialogCancel>
          {/* Plain buttons: AlertDialogAction would also request close, dismissing the confirm
              before the removal settles. The owner closes it on the result. */}
          <Button
            variant="secondary"
            disabled={actionsDisabled}
            disabledReason={reason}
            onPress={() => onDelete('divider-only')}
          >
            <Text>{t('chapters:deleteConfirm.removeDivider')}</Text>
          </Button>
          <Button
            variant="destructive"
            disabled={actionsDisabled}
            disabledReason={reason}
            onPress={() => onDelete('whole')}
          >
            <Text>{t('chapters:deleteConfirm.confirm')}</Text>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
