import { Platform, View } from 'react-native'

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
import { cn } from '@/lib/utils'

type SwapResumeDialogProps = {
  open: boolean
  targetModelName: string
  onResume: () => void
  onCancelSwap: () => void
  /** Dismiss without deciding. Both other actions can fail, so the modal needs
   *  an exit that cannot — the memory state it reports stays visible on the pill. */
  onLater: () => void
}

export function SwapResumeDialog({
  open,
  targetModelName,
  onResume,
  onCancelSwap,
  onLater,
}: SwapResumeDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onLater()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('storySettings:swap.resumeTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('storySettings:swap.resumeBody', { model: targetModelName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className={Platform.select({ web: 'sm:justify-between' })}>
          <Button testID="swap-resume-later" variant="ghost" onPress={onLater}>
            <Text>{t('storySettings:swap.resumeLater')}</Text>
          </Button>
          <View
            className={cn('flex flex-col-reverse gap-2', Platform.select({ web: 'sm:flex-row' }))}
          >
            <Button testID="swap-cancel-swap" variant="destructive" onPress={onCancelSwap}>
              <Text>{t('storySettings:swap.cancelSwap')}</Text>
            </Button>
            <Button testID="swap-resume" variant="primary" onPress={onResume}>
              <Text>{t('storySettings:swap.resume')}</Text>
            </Button>
          </View>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export type { SwapResumeDialogProps }
