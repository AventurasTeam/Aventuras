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
import { t } from '@/lib/i18n'

type UndoConfirmProps = {
  open: boolean
  /** `Undo <target>?` (undo-copy.ts → undoConfirmTitle). */
  title: string
  /** What the undo reverses: a close's impact lines, or the group's rows as History names them. */
  lines: readonly string[]
  onConfirm: () => void
  onCancel: () => void
}

/**
 * reader-composer.md → Undo and redo: an undo whose target the reader can't show asks first.
 * Undo is the default; Esc and Cancel close it with nothing undone.
 */
export function UndoConfirm({ open, title, lines, onConfirm, onCancel }: UndoConfirmProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {lines.map((line, index) => (
              <Text key={`${index}:${line}`} size="sm">
                {`${index === 0 ? '' : '\n'}• ${line}`}
              </Text>
            ))}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">
              <Text>{t('cancel')}</Text>
            </Button>
          </AlertDialogCancel>
          {/* A plain button: AlertDialogAction would also request close, running onCancel beside
              the undo. The owner closes this once it confirms. */}
          <Button variant="primary" onPress={onConfirm}>
            <Text>{t('reader:undo.confirm')}</Text>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export type { UndoConfirmProps }
