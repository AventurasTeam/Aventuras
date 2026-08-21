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

type AiAssistDiscardDialogProps = {
  open: boolean
  onKeep: () => void
  onDiscard: () => void
}

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
          <Button variant="secondary" onPress={onKeep}>
            <Text>{t('wizard:aiAssist.discardConfirm.keep')}</Text>
          </Button>
          <Button variant="destructive" onPress={onDiscard}>
            <Text>{t('wizard:aiAssist.discardConfirm.discard')}</Text>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
