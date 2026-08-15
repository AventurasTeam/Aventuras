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
  variant?: 'rollback' | 'regenerate'
}

export function RollbackConfirmModal({
  open,
  onOpenChange,
  targetEntryNumber,
  counts,
  onConfirm,
  variant = 'rollback',
}: RollbackConfirmModalProps) {
  const copy =
    variant === 'regenerate'
      ? {
          title: t('reader:regenerateConfirm.title', { entryNumber: targetEntryNumber }),
          body: t('reader:regenerateConfirm.body', { entryNumber: targetEntryNumber }),
          confirm: t('reader:regenerateConfirm.confirm'),
        }
      : {
          title: t('reader:rollbackConfirm.title', { entryNumber: targetEntryNumber }),
          body: t('reader:rollbackConfirm.body', { entryNumber: targetEntryNumber }),
          confirm: t('reader:rollbackConfirm.confirm'),
        }
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.body}</AlertDialogDescription>
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
        <Text size="sm" className="font-bold">
          {t('reader:rollbackConfirm.irreversible')}
        </Text>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">
              <Text>{t('cancel')}</Text>
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant="destructive" onPress={onConfirm}>
              <Text>{copy.confirm}</Text>
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export type { RollbackConfirmModalProps }
