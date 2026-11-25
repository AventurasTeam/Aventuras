import type { ReactElement } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Platform, type TextInputKeyPressEvent } from 'react-native'

import { FormRow } from '@/components/compounds/form-row'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, type SelectOption } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import type { DuplicateBranch } from '@/lib/actions'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export type DuplicateDialogState =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'refused'; reason: string }
  | { kind: 'copying' }
  | { kind: 'failed' }

export type DuplicateBranchOption = { readonly id: string; readonly name: string }

export type DuplicateStoryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceTitle: string
  /** `created_at` order; known at mount, never empty. */
  branches: readonly DuplicateBranchOption[]
  /** One of `branches`; the Select's default. */
  currentBranchId: string
  state: DuplicateDialogState
  onBranchChange: (branch: DuplicateBranch) => void
  onDuplicate: (values: { title: string; branch: DuplicateBranch }) => void
}

type DuplicateForm = { title: string; branch: string }

// A definite width on every tier: a content-sized dialog resizes as a state's line comes and goes.
// Radix's web wrapper shrinks to content, so web needs `w-*`; the cap serves native.
const PANEL_CLASS = cn(
  'sm:max-w-[360px]',
  Platform.select({ web: 'w-[360px] max-w-[calc(100vw-2rem)]' }),
)

// Branch ids are `br_<uuid>`, so no branch's option can carry this value.
const ALL_BRANCHES = 'all'

// RN-Web's own submit guard reads both signals; 229 is the key code an IME's confirming Enter can
// carry with isComposing already false.
const IME_KEY_CODE = 229

const isComposing = ({ nativeEvent }: TextInputKeyPressEvent) =>
  ('isComposing' in nativeEvent && nativeEvent.isComposing === true) ||
  ('keyCode' in nativeEvent && nativeEvent.keyCode === IME_KEY_CODE)

function branchOf(value: string): DuplicateBranch {
  return value === ALL_BRANCHES ? 'all' : { branchId: value }
}

// The mark rides the label so the closed trigger shows it too, as the wireframe does.
function branchOptions(
  branches: readonly DuplicateBranchOption[],
  currentBranchId: string,
): SelectOption[] {
  const current = branches.find((branch) => branch.id === currentBranchId)
  return [
    ...(current == null
      ? []
      : [{ value: current.id, label: `${current.name} · ${t('landing:duplicate.currentMark')}` }]),
    ...branches
      .filter((branch) => branch.id !== currentBranchId)
      .map((branch) => ({ value: branch.id, label: branch.name })),
    { value: ALL_BRANCHES, label: t('landing:duplicate.allBranches', { count: branches.length }) },
  ]
}

/** story-list.md → Duplicate a story. Props only: the host mounts it per open. */
export function DuplicateStoryDialog({
  open,
  onOpenChange,
  sourceTitle,
  branches,
  currentBranchId,
  state,
  onBranchChange,
  onDuplicate,
}: DuplicateStoryDialogProps): ReactElement {
  // react-hook-form mutates formState in place; compiled memos keyed on it would go stale.
  'use no memo'
  // Read once: the host keys the dialog per open with these known, so nothing resets the form.
  const { control, handleSubmit } = useForm<DuplicateForm>({
    defaultValues: {
      title: t('landing:duplicate.nameDefault', { title: sourceTitle }),
      branch: currentBranchId,
    },
  })
  const title = useWatch({ control, name: 'title' })
  const copying = state.kind === 'copying'
  const refusal = state.kind === 'refused' ? state.reason : undefined
  const canDuplicate = (state.kind === 'ready' || state.kind === 'failed') && title.trim() !== ''

  const duplicate = () => {
    if (!canDuplicate) return
    void handleSubmit((values) =>
      onDuplicate({ title: values.title, branch: branchOf(values.branch) }),
    )()
  }

  // Esc, the backdrop and the × land here too: a copy is one transaction and can't stop partway.
  const handleOpenChange = (next: boolean) => {
    if (!next && copying) return
    onOpenChange(next)
  }

  const handleKeyPress = (event: TextInputKeyPressEvent) => {
    if (Platform.OS !== 'web' || event.nativeEvent.key !== 'Enter' || isComposing(event)) return
    // RN-Web blurs a single-line field after Enter; a blank name keeps focus here.
    event.preventDefault?.()
    duplicate()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={PANEL_CLASS} busy={copying} closeDisabled={copying}>
        <DialogHeader>
          <DialogTitle>{t('landing:duplicate.title')}</DialogTitle>
        </DialogHeader>
        <Controller
          control={control}
          name="title"
          render={({ field }) => (
            <FormRow label={t('landing:duplicate.name')} required stacked>
              <Input
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                onKeyPress={handleKeyPress}
                onSubmitEditing={duplicate}
                submitBehavior="submit"
                returnKeyType="done"
                editable={!copying}
                aria-label={t('landing:duplicate.name')}
                autoFocus
                selectTextOnFocus
              />
            </FormRow>
          )}
        />
        {branches.length > 1 ? (
          <Controller
            control={control}
            name="branch"
            render={({ field }) => (
              <FormRow label={t('landing:duplicate.branch')} stacked>
                <Select
                  mode="dropdown"
                  label={t('landing:duplicate.branch')}
                  options={branchOptions(branches, currentBranchId)}
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value)
                    onBranchChange(branchOf(value))
                  }}
                  disabled={copying}
                />
              </FormRow>
            )}
          />
        ) : null}
        {state.kind === 'refused' ? (
          <Text size="sm" variant="secondary">
            {state.reason}
          </Text>
        ) : state.kind === 'failed' ? (
          <Text size="sm" className="text-danger">
            {t('landing:duplicate.failed')}
          </Text>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" disabled={copying} onPress={() => handleOpenChange(false)}>
            <Text>{t('cancel')}</Text>
          </Button>
          <Button
            variant="primary"
            loading={copying}
            disabled={!canDuplicate}
            disabledReason={refusal}
            onPress={duplicate}
          >
            <Text>{t('landing:duplicate.confirm')}</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
