import { Controller, useWatch, type Control } from 'react-hook-form'
import { View } from 'react-native'

import { FormRow } from '@/components/compounds/form-row'
import { NumberInput } from '@/components/compounds/number-input'
import { Select } from '@/components/ui/select'
import { injectionHelpText } from '@/components/world/injection-help'
import { INJECTION_MODES } from '@/lib/db'
import { t } from '@/lib/i18n'
import { ENTITY_STATUSES, type EntityBaseDraft } from '@/lib/world'

import { ListField, TextField, type Gate } from '../detail/fields'
import { issueLabel } from '../world-copy'

// world.md → Settings.
export function SettingsTab({
  control,
  blocked,
  blockedReason,
  place,
}: Gate & {
  control: Control<EntityBaseDraft>
  /**
   * A location: the hints add what retiring does to the places inside it, and what each mode does
   * on the location map.
   */
  place?: {
    /** The ancestor whose `disabled` reaches this place, by name; null when none does. */
    disabledThrough: string | null
  }
}) {
  const status = useWatch({ control, name: 'status' })
  const gate = { blocked, blockedReason }
  let injectionHint = t('world:fields.injectionOverride')
  if (place != null) injectionHint += ` ${t('world:fields.injectionPlaceMap')}`
  if (place?.disabledThrough != null)
    injectionHint += `\n${t('world:fields.disabledThrough', { place: place.disabledThrough })}`
  return (
    <View className="gap-4">
      <Controller
        control={control}
        name="status"
        render={({ field, fieldState }) => (
          <FormRow
            label={t('world:fields.status')}
            hint={place != null ? t('world:fields.statusPlace') : undefined}
            error={issueLabel(fieldState.error?.message)}
          >
            <Select
              label={t('world:fields.status')}
              value={field.value}
              onValueChange={field.onChange}
              disabled={blocked}
              disabledReason={blockedReason}
              options={ENTITY_STATUSES.map((value) => ({
                value,
                label: t(`world:tiers.${value}`),
              }))}
            />
          </FormRow>
        )}
      />
      <Controller
        control={control}
        name="injectionMode"
        render={({ field, fieldState }) => (
          <FormRow
            label={t('world:fields.injectionMode')}
            hint={injectionHint}
            error={issueLabel(fieldState.error?.message)}
          >
            {/* Options with help text make Select render radio. */}
            <Select
              label={t('world:fields.injectionMode')}
              value={field.value}
              onValueChange={field.onChange}
              disabled={blocked}
              disabledReason={blockedReason}
              options={INJECTION_MODES.map((mode) => ({
                value: mode,
                label: t(`world:fields.injection.${mode}`),
                description: injectionHelpText('entity', mode),
              }))}
            />
          </FormRow>
        )}
      />
      <TextField
        control={control}
        name="retiredReason"
        label={t('world:fields.retiredReason')}
        placeholder={t('world:fields.retiredReasonPlaceholder')}
        hint={t('world:fields.retiredReasonHint')}
        editable={status === 'retired'}
        {...gate}
      />
      <ListField
        control={control}
        name="keywords"
        label={t('world:fields.keywords')}
        placeholder={t('world:fields.keywordsPlaceholder')}
        hint={t('world:fields.keywordsHint')}
        {...gate}
      />
      <Controller
        control={control}
        name="priority"
        render={({ field, fieldState }) => (
          <FormRow
            label={t('world:fields.priority')}
            hint={t('world:fields.priorityHint')}
            error={issueLabel(fieldState.error?.message)}
          >
            <View className="w-28">
              <NumberInput
                value={field.value}
                onChange={field.onChange}
                label={t('world:fields.priority')}
                disabled={blocked}
                disabledReason={blockedReason}
                invalid={fieldState.error != null}
              />
            </View>
          </FormRow>
        )}
      />
      <ListField
        control={control}
        name="tags"
        label={t('world:fields.tags')}
        placeholder={t('world:fields.tagsPlaceholder')}
        {...gate}
      />
    </View>
  )
}
