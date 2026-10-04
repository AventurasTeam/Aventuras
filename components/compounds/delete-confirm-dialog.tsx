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
import { t } from '@/lib/i18n'

import type { DeleteConfirmCopy } from './delete-confirm-copy'

type DeleteConfirmDialogProps = DeleteConfirmCopy & {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Fires before the dialog's own `onOpenChange(false)` — hosts needn't close it; treat
   * that close as harmless.
   */
  onConfirm: () => void
}

/** patterns/alert-dialog.md → Destructive CTA via Button composition, with an impact list. */
export function DeleteConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  impacts,
  confirmLabel,
  onConfirm,
}: DeleteConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description}
            {impacts.map((line, index) => (
              <Text key={index} size="sm">
                {`${index === 0 ? '\n\n' : '\n'}• ${line}`}
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
