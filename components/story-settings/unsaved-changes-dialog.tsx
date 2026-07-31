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

type UnsavedChangesDialogProps = {
  open: boolean
  saving?: boolean
  /** Mirrors the save bar: an invalid section leaves Discard and Cancel as the only exits. */
  saveDisabled?: boolean
  /** Why Save is unavailable. Rendered under the body when a section reports an invalid draft. */
  reason?: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

export function UnsavedChangesDialog({
  open,
  saving = false,
  saveDisabled = false,
  reason,
  onSave,
  onDiscard,
  onCancel,
}: UnsavedChangesDialogProps) {
  function handleOpenChange(next: boolean) {
    // Escape and the Android back button also land here; a commit in flight
    // must not resolve the leave as a cancel behind it.
    if (next || saving) return
    onCancel()
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('storySettings:save.unsavedTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('storySettings:save.unsavedBody')}
            {reason != null ? (
              <Text size="sm" variant="muted">
                {'\n\n'}
                {reason}
              </Text>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary" disabled={saving}>
              <Text>{t('cancel')}</Text>
            </Button>
          </AlertDialogCancel>
          {/* Plain buttons: an AlertDialogAction wrapper would also request
              close, firing onCancel alongside the chosen action. The owner
              closes this once the pending leave resolves. */}
          <Button variant="secondary" onPress={onDiscard} disabled={saving}>
            <Text>{t('storySettings:save.unsavedDiscard')}</Text>
          </Button>
          <Button variant="primary" onPress={onSave} disabled={saving || saveDisabled}>
            <Text>{t('storySettings:save.unsavedSave')}</Text>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export type { UnsavedChangesDialogProps }
