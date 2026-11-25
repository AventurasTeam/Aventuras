import { useState, type ReactElement } from 'react'
import { Platform, View } from 'react-native'

import { FormRow } from '@/components/compounds/form-row'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// Radix's web wrapper shrinks to content, so web needs a definite width; the cap serves native.
const PANEL_CLASS = cn(
  'sm:max-w-[360px]',
  Platform.select({ web: 'w-[360px] max-w-[calc(100vw-2rem)]' }),
)

export type BranchCreateModalProps = {
  /** The fork entry's position: `Branching from entry <position>.` */
  entryPosition: number
  /** From the press of Create to the navigation: Create spins, the rest disables, nothing closes. */
  pending: boolean
  /** The refusal's or the failure's line above the buttons. */
  message: string | null
  /** Why Create can't run at all right now (a pending swap); shown when no message is. */
  createBlockedReason?: string
  /** The name as typed; the action trims it. */
  onCreate: (name: string) => void
  onCancel: () => void
}

/**
 * branch-navigator.md → Branch creation — modal. Props only: the reader's `useBranchCreate` holds
 * the request, the press in flight and the line.
 */
export function BranchCreateModal({
  entryPosition,
  pending,
  message,
  createBlockedReason,
  onCreate,
  onCancel,
}: BranchCreateModalProps): ReactElement {
  // One input with a submit: component state, not a form (code-conventions.md → Forms).
  const [name, setName] = useState('')
  const canCreate = !pending && createBlockedReason == null && name.trim() !== ''
  const create = () => {
    if (canCreate) onCreate(name)
  }
  // Esc, a press outside, the × and hardware back all ask through onOpenChange.
  const cancel = () => {
    if (!pending) onCancel()
  }
  const line = message ?? createBlockedReason
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) cancel()
      }}
    >
      <DialogContent className={PANEL_CLASS} busy={pending} closeDisabled={pending}>
        <DialogHeader>
          <DialogTitle>{t('reader:branches.create.title')}</DialogTitle>
          <DialogDescription>
            {t('reader:branches.create.context', { position: entryPosition })}
          </DialogDescription>
        </DialogHeader>
        <FormRow label={t('reader:branches.create.name')} required stacked>
          <Input
            aria-label={t('reader:branches.create.name')}
            value={name}
            onChangeText={setName}
            onSubmitEditing={create}
            submitBehavior="submit"
            returnKeyType="done"
            editable={!pending}
            autoFocus
          />
        </FormRow>
        {line != null ? (
          <View role="alert" accessibilityLiveRegion="assertive">
            <Text size="sm" className={message != null ? 'text-danger' : 'text-fg-muted'}>
              {line}
            </Text>
          </View>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" disabled={pending} onPress={cancel}>
            <Text>{t('reader:branches.create.cancel')}</Text>
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!canCreate}
            disabledReason={createBlockedReason}
            onPress={create}
          >
            <Text>{t('reader:branches.create.confirm')}</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
