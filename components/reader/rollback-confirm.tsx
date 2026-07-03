import { View } from 'react-native'

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
import type { RollbackCounts } from '@/lib/actions'
import { t } from '@/lib/i18n'

type RollbackConfirmModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetEntryNumber: number
  counts: RollbackCounts
  onConfirm: () => void
}

export function RollbackConfirmModal({
  open,
  onOpenChange,
  targetEntryNumber,
  counts,
  onConfirm,
}: RollbackConfirmModalProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('reader:rollbackConfirm.title', { entryNumber: targetEntryNumber })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('reader:rollbackConfirm.body', { entryNumber: targetEntryNumber })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <View className="gap-1">
          <Text size="sm">
            {`• ${t('reader:rollbackConfirm.entries', { count: counts.entries })}`}
          </Text>
          {counts.chapters > 0 && (
            <Text size="sm" className="font-semibold">
              {`• ${t('reader:rollbackConfirm.chapters', { count: counts.chapters })}`}
            </Text>
          )}
          <Text size="sm">
            {`• ${t('reader:rollbackConfirm.worldState', { count: counts.worldStateChanges })}`}
          </Text>
        </View>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">
              <Text>{t('cancel')}</Text>
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant="destructive" onPress={onConfirm}>
              <Text>{t('reader:rollbackConfirm.confirm')}</Text>
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export type { RollbackConfirmModalProps }
