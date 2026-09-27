import { Controller, type Control, type FieldPathByValue, type FieldValues } from 'react-hook-form'

import { EntityPicker } from '@/components/compounds/entity-picker'
import { FormRow } from '@/components/compounds/form-row'
import { TagInput } from '@/components/compounds/tag-input'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { Entity, EntityKind } from '@/lib/db'

import { issueLabel } from '../world-copy'

export type Gate = { blocked: boolean; blockedReason?: string }

type TextFieldProps<D extends FieldValues> = Gate & {
  control: Control<D>
  name: FieldPathByValue<D, string>
  label: string
  placeholder?: string
  hint?: string
  multiline?: boolean
  maxLength?: number
  /** False keeps the field read-only whatever the gate says — a conditional field. */
  editable?: boolean
}

export function TextField<D extends FieldValues>({
  control,
  name,
  label,
  placeholder,
  hint,
  multiline = false,
  maxLength,
  editable = true,
  blocked,
  blockedReason,
}: TextFieldProps<D>) {
  const canEdit = editable && !blocked
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormRow label={label} hint={hint} error={issueLabel(fieldState.error?.message)}>
          {multiline ? (
            <Textarea
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              rows={4}
              maxLength={maxLength}
              placeholder={placeholder}
              editable={canEdit}
              accessibilityHint={blocked ? blockedReason : undefined}
              aria-label={label}
              aria-invalid={fieldState.error != null}
            />
          ) : (
            <Input
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              maxLength={maxLength}
              placeholder={placeholder}
              editable={canEdit}
              accessibilityHint={blocked ? blockedReason : undefined}
              aria-label={label}
              aria-invalid={fieldState.error != null}
            />
          )}
        </FormRow>
      )}
    />
  )
}

type ListFieldProps<D extends FieldValues> = Gate & {
  control: Control<D>
  name: FieldPathByValue<D, string[]>
  label: string
  placeholder?: string
  hint?: string
}

/** A `string[]` as TagInput chips (forms.md → TagInput pattern). */
export function ListField<D extends FieldValues>({
  control,
  name,
  label,
  placeholder,
  hint,
  blocked,
  blockedReason,
}: ListFieldProps<D>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormRow label={label} hint={hint} error={issueLabel(fieldState.error?.message)}>
          <TagInput
            value={field.value}
            onChange={field.onChange}
            label={label}
            placeholder={placeholder}
            disabled={blocked}
            disabledReason={blockedReason}
            aria-invalid={fieldState.error != null}
          />
        </FormRow>
      )}
    />
  )
}

type RefFieldProps<D extends FieldValues> = Gate & {
  control: Control<D>
  name: FieldPathByValue<D, string | null>
  label: string
  placeholder: string
  entities: readonly Entity[]
  kinds: readonly EntityKind[]
  excludeIds?: readonly string[]
  testID?: string
  /** Adds the picker's `↗` jump to the linked entity. */
  onOpenEntity?: (id: string) => void
}

/** One entity reference; a field error (parent-cycle) renders below. */
export function RefField<D extends FieldValues>({
  control,
  name,
  label,
  placeholder,
  entities,
  kinds,
  excludeIds,
  testID,
  onOpenEntity,
  blocked,
  blockedReason,
}: RefFieldProps<D>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormRow label={label} error={issueLabel(fieldState.error?.message)}>
          <EntityPicker
            value={field.value}
            onChange={field.onChange}
            entities={entities}
            kinds={kinds}
            excludeIds={excludeIds}
            label={label}
            placeholder={placeholder}
            disabled={blocked}
            disabledReason={blockedReason}
            aria-invalid={fieldState.error != null}
            testID={testID}
            onOpen={onOpenEntity}
          />
        </FormRow>
      )}
    />
  )
}
