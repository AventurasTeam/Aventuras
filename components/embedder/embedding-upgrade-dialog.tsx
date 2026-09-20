import { Platform, View } from 'react-native'

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
import { cn } from '@/lib/utils'

type EmbeddingUpgradeDialogProps = {
  open: boolean
  currentModelId: string
  targetModelId: string
  onUpgrade: () => void
  onKeep: () => void
  /** Dismiss without deciding: Esc (web), hardware back (native) and the Later button. */
  onLater: () => void
}

/** retrieval.md → The story-open upgrade prompt. Same three-action shape as the resume prompt. */
export function EmbeddingUpgradeDialog({
  open,
  currentModelId,
  targetModelId,
  onUpgrade,
  onKeep,
  onLater,
}: EmbeddingUpgradeDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onLater()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('storySettings:upgrade.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('storySettings:upgrade.body', { current: currentModelId, target: targetModelId })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className={Platform.select({ web: 'sm:justify-between' })}>
          <AlertDialogCancel asChild>
            <Button testID="upgrade-later" variant="ghost">
              <Text>{t('storySettings:upgrade.later')}</Text>
            </Button>
          </AlertDialogCancel>
          <View
            className={cn('flex flex-col-reverse gap-2', Platform.select({ web: 'sm:flex-row' }))}
          >
            <Button testID="upgrade-keep" variant="secondary" onPress={onKeep}>
              <Text>{t('storySettings:upgrade.keep')}</Text>
            </Button>
            <Button testID="upgrade-upgrade" variant="primary" onPress={onUpgrade}>
              <Text>{t('storySettings:upgrade.upgrade')}</Text>
            </Button>
          </View>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export type { EmbeddingUpgradeDialogProps }
