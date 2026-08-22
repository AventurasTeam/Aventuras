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

type AiAssistDiscardDialogProps = {
  open: boolean
  onKeep: () => void
  onDiscard: () => void
}

/**
 * Dismissing this confirm is the non-destructive answer — Escape and
 * outside-click resolve to Keep, and only the destructive button discards.
 */
export function AiAssistDiscardDialog({ open, onKeep, onDiscard }: AiAssistDiscardDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onKeep()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('wizard:aiAssist.discardConfirm.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('wizard:aiAssist.discardConfirm.body')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* AlertDialogCancel, not a bare Button: Radix focuses whatever registers as Cancel;
              without it nothing is focused, so Tab walks a keyboard user past the confirm. */}
          <AlertDialogCancel asChild>
            <Button variant="secondary">
              <Text>{t('wizard:aiAssist.discardConfirm.keep')}</Text>
            </Button>
          </AlertDialogCancel>
          <Button variant="destructive" onPress={onDiscard}>
            <Text>{t('wizard:aiAssist.discardConfirm.discard')}</Text>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
