import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

type DiscardDroppedRowsDialogProps = {
  open: boolean
  count: number
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Save replaces the draft row the dropped rows sit in — their last moment of existence.
 * Confirmed, not toasted: that toast auto-dismisses and shares a 3-slot queue with two siblings.
 */
export function DiscardDroppedRowsDialog({
  open,
  count,
  onCancel,
  onConfirm,
}: DiscardDroppedRowsDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('wizard:discardDropped.title', { count })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('wizard:discardDropped.body', { count })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="secondary" onPress={onCancel}>
            <Text>{t('wizard:discardDropped.cancel')}</Text>
          </Button>
          <Button variant="destructive" onPress={onConfirm}>
            <Text>{t('wizard:discardDropped.confirm')}</Text>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
