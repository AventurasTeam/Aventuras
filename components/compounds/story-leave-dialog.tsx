import { type JSX } from 'react'

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

type StoryLeaveDialogProps = {
  open: boolean
  /** Waiting for the story to go idle: both actions are inert and Escape / back can't stay. */
  leaving: boolean
  onStay: () => void
  onConfirmLeave: () => void
}

/** Canon copy (principles.md → Affordance loci), which departs from the AlertDialog copy contract. */
export function StoryLeaveDialog({
  open,
  leaving,
  onStay,
  onConfirmLeave,
}: StoryLeaveDialogProps): JSX.Element {
  function handleOpenChange(next: boolean) {
    // Escape and Android back land here too; a cancel in flight can't be answered with Stay.
    if (next || leaving) return
    onStay()
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('storyLeave.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('storyLeave.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary" disabled={leaving}>
              <Text>{t('storyLeave.stay')}</Text>
            </Button>
          </AlertDialogCancel>
          {/* Plain button: AlertDialogAction also requests close, which would answer Stay. */}
          <Button variant="destructive" loading={leaving} onPress={onConfirmLeave}>
            <Text>{t('storyLeave.cancelAndLeave')}</Text>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export type { StoryLeaveDialogProps }
