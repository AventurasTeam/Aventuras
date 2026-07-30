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

type ReindexConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Rows a full re-index will re-embed; null when the count couldn't be taken. */
  rowCount: number | null
  modelLabel: string
  onConfirm: () => void
}

export function ReindexConfirmDialog({
  open,
  onOpenChange,
  rowCount,
  modelLabel,
  onConfirm,
}: ReindexConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent testID="reindex-confirm">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('storySettings:reindexConfirm.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {rowCount == null
              ? t('storySettings:reindexConfirm.bodyUnknownCount', { model: modelLabel })
              : t('storySettings:reindexConfirm.body', { count: rowCount, model: modelLabel })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Text size="sm">{t('storySettings:reindexConfirm.cancelSemantics')}</Text>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">
              <Text>{t('cancel')}</Text>
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button testID="reindex-confirm-start" onPress={onConfirm}>
              <Text>{t('storySettings:reindexConfirm.confirm')}</Text>
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export type { ReindexConfirmDialogProps }
