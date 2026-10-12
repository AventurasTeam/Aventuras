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
      // A Save parked behind its own question owns the screen until that is answered.
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
  onAnswer,
}: {
  ask: RowSaveConfirm
  onAnswer: (outcome: 'save' | 'cancel') => void
}) {
  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        // Escape and Android back land here too.
        if (!next) onAnswer('cancel')
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
                {index === 0 ? (ask.lines.length > 0 ? '\n\n• ' : '• ') : '\n• '}
                {item}
              </Text>
            ))}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">
              <Text>{t('cancel')}</Text>
            </Button>
          </AlertDialogCancel>
          {/* Plain button: an AlertDialogAction would also request close, firing the cancel. */}
          <Button variant="primary" onPress={() => onAnswer('save')}>
            <Text>{ask.confirmLabel}</Text>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The question a Save asks before it writes (alert-dialog.md), one per Save. */
export function RowConfirmDialog<Draft extends FieldValues>({
  session,
}: {
  session: RowSaveSession<Draft>
}) {
  const ask = session.pendingConfirm
  return ask == null ? null : <ConfirmDialog ask={ask} onAnswer={session.resolveConfirm} />
}
