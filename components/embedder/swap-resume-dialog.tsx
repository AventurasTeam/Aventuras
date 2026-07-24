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

type SwapResumeDialogProps = {
  open: boolean
  targetModelName: string
  onResume: () => void
  onCancelSwap: () => void
}

export function SwapResumeDialog({
  open,
  targetModelName,
  onResume,
  onCancelSwap,
}: SwapResumeDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={() => undefined}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('storySettings:swap.resumeTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('storySettings:swap.resumeBody', { model: targetModelName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button testID="swap-cancel-swap" variant="destructive" onPress={onCancelSwap}>
            <Text>{t('storySettings:swap.cancelSwap')}</Text>
          </Button>
          <Button testID="swap-resume" variant="primary" onPress={onResume}>
            <Text>{t('storySettings:swap.resume')}</Text>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export type { SwapResumeDialogProps }
