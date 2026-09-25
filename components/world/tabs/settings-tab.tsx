import { Controller, useWatch, type Control } from 'react-hook-form'
import { View } from 'react-native'

import { FormRow } from '@/components/compounds/form-row'
import { NumberInput } from '@/components/compounds/number-input'
import { Select } from '@/components/ui/select'
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
}: Gate & { control: Control<EntityBaseDraft> }) {
  const status = useWatch({ control, name: 'status' })
  const gate = { blocked, blockedReason }
  return (
    <View className="gap-4">
      <Controller
        control={control}
        name="status"
        render={({ field }) => (
          <FormRow label={t('world:fields.status')}>
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
        render={({ field }) => (
          <FormRow
            label={t('world:fields.injectionMode')}
            hint={t('world:fields.injectionOverride')}
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
                description: t(`world:fields.injection.${mode}Help`),
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
