import type { FieldValues } from 'react-hook-form'

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
import type { RowSaveConfirm, RowSaveSession } from '@/hooks/use-row-save-session'
import { t } from '@/lib/i18n'

import { SaveBar } from './save-bar'
import { UnsavedChangesDialog } from './unsaved-changes-dialog'

type Gate = {
  /** `isUserEditBlocked` — Save disables with the principle-owned reason. */
  blocked?: boolean
  blockedReason?: string
}

type RowSaveBarProps<Draft extends FieldValues> = Gate & {
  session: RowSaveSession<Draft>
  /** The host screen's focus state, forwarded to the Cmd/Ctrl-S hotkey. */
  enabled?: boolean
}

/** The pane's save bar, mounted only while the session is dirty (DetailPane's `saveBar` slot). */
export function RowSaveBar<Draft extends FieldValues>({
  session,
  enabled = true,
  blocked = false,
  blockedReason,
}: RowSaveBarProps<Draft>) {
  if (!session.dirty) return null
  const invalid = session.invalidReason ?? undefined
  return (
    <SaveBar
      dirtyFields={session.dirtyFields}
      saving={session.saving}
      // Not gated on `blocked`: saveDisabled refuses the save while Ctrl-S stays claimed.
      enabled={enabled}
      notice={invalid ?? session.saveError ?? (blocked ? blockedReason : undefined)}
      saveDisabled={blocked || invalid != null}
      saveDisabledReason={blocked ? blockedReason : invalid}
      onSave={() => void session.save()}
      onDiscard={session.discard}
    />
  )
}

type RowLeaveDialogProps<Draft extends FieldValues> = Gate & { session: RowSaveSession<Draft> }

/** Save / Discard / Cancel for a queued leave (save-sessions.md → Navigate-away guard). */
export function RowLeaveDialog<Draft extends FieldValues>({
  session,
  blocked = false,
  blockedReason,
}: RowLeaveDialogProps<Draft>) {
  const invalid = session.invalidReason ?? undefined
  return (
    <UnsavedChangesDialog
      // A Save's question owns the screen until it is answered and its write settles.
      open={session.pendingLeave && session.pendingConfirm == null}
      saving={session.saving}
      saveDisabled={blocked || invalid != null}
      saveDisabledReason={blocked ? blockedReason : invalid}
      reason={invalid ?? session.saveError ?? (blocked ? blockedReason : undefined)}
      onSave={() => session.resolveLeave('save')}
      onDiscard={() => session.resolveLeave('discard')}
      onCancel={() => session.resolveLeave('cancel')}
    />
  )
}

function ConfirmDialog({
  ask,
  saving,
  onAnswer,
}: {
  ask: RowSaveConfirm
  saving: boolean
  onAnswer: (outcome: 'save' | 'cancel') => void
}) {
  const firstBullet = ask.lines.length > 0 ? '\n\n• ' : '• '
  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        // Escape and Android back land here too; the confirmed write owns the outcome.
        if (!next && !saving) onAnswer('cancel')
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{ask.title}</AlertDialogTitle>
          {/* Lines and items inside the description, so a screen reader announces them. */}
          <AlertDialogDescription>
            {ask.lines.join('\n\n')}
            {ask.items.map((item, index) => (
              <Text key={`${index}:${item}`} size="sm" variant="muted">
                {index === 0 ? firstBullet : '\n• '}
                {item}
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
          {/* Plain button: an AlertDialogAction would also request close, firing the cancel. */}
          <Button variant="primary" onPress={() => onAnswer('save')} disabled={saving}>
            <Text>{ask.confirmLabel}</Text>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The question a Save asks before it writes (alert-dialog.md), up and inert through its write. */
export function RowConfirmDialog<Draft extends FieldValues>({
  session,
}: {
  session: RowSaveSession<Draft>
}) {
  const ask = session.pendingConfirm
  return ask == null ? null : (
    <ConfirmDialog ask={ask} saving={session.saving} onAnswer={session.resolveConfirm} />
  )
}
