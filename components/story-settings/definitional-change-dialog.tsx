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

import type { FlaggedField } from './save-session-state'

type DefinitionalChangeDialogProps = {
  open: boolean
  fields: readonly FlaggedField[]
  saving?: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** story-settings.md → Definitional-change confirmations: informs, never gatekeeps. */
export function DefinitionalChangeDialog({
  open,
  fields,
  saving = false,
  onCancel,
  onConfirm,
}: DefinitionalChangeDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Escape and Android back land here too; the confirmed commit owns the outcome.
        if (!next && !saving) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('storySettings:confirm.title')}</AlertDialogTitle>
          {/* Fields inside the description, so a screen reader announces them with the dialog. */}
          <AlertDialogDescription>
            {t('storySettings:confirm.body')}
            {fields.map((field, index) => (
              <Text key={field.key} size="sm" variant="muted">
                {index === 0 ? '\n\n• ' : '\n• '}
                <Text size="sm" className="font-medium text-fg-primary">
                  {field.label}
                </Text>
                {t('storySettings:confirm.fieldSeparator')}
                {field.consequence}
              </Text>
            ))}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary" disabled={saving}>
              <Text>{t('cancel')}</Text>
            </Button>
          </AlertDialogCancel>
          {/* Plain button: an AlertDialogAction would also request close,
              firing onCancel alongside the confirm. */}
          <Button
            testID="confirm-save-anyway"
            variant="primary"
            onPress={onConfirm}
            disabled={saving}
          >
            <Text>{t('storySettings:confirm.saveAnyway')}</Text>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export type { DefinitionalChangeDialogProps }
