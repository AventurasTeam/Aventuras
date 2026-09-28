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
import { t } from '@/lib/i18n'

export type DeleteConfirmCopy = {
  /** Ends with `?` (alert-dialog.md → Copy contract). */
  title: string
  description: string
  /** What goes with the row, one line each. */
  impacts: readonly string[]
  /** Verb-shaped: `Delete character`, never `OK`. */
  confirmLabel: string
}

type DeleteConfirmDialogProps = DeleteConfirmCopy & {
  open: boolean
  onOpenChange: (open: boolean) => void
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
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {impacts.length > 0 ? (
          <View className="gap-1" testID="delete-impacts">
            {impacts.map((line) => (
              <Text key={line} size="sm">
                {`• ${line}`}
              </Text>
            ))}
          </View>
        ) : null}
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
