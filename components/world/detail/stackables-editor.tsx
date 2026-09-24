import { Trash2 } from 'lucide-react-native'
import { Controller, useFieldArray, type Control, type UseFormTrigger } from 'react-hook-form'
import { View } from 'react-native'

import { NumberInput } from '@/components/compounds/number-input'
import { Button } from '@/components/ui/button'
import { IconAction } from '@/components/ui/icon-action'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import type { CharacterDraft } from '@/lib/world'

import { issueLabel } from '../world-copy'
import type { Gate } from './fields'

type StackablesEditorProps = Gate & {
  control: Control<CharacterDraft>
  trigger: UseFormTrigger<CharacterDraft>
}

/** Quantities as editable rows: counts need direct entry (world.md → Carrying, amended). */
export function StackablesEditor({
  control,
  trigger,
  blocked,
  blockedReason,
}: StackablesEditorProps) {
  const { fields, append, remove } = useFieldArray({ control, name: 'stackables' })
  return (
    <View className="gap-2" testID="stackables">
      {fields.map((field, index) => (
        <View key={field.id} className="flex-row items-start gap-2" testID={`stackable-${index}`}>
          <Controller
            control={control}
            name={`stackables.${index}.key`}
            // Duplicates are whole-array; revalidate every row, not just this leaf.
            rules={{ deps: ['stackables'] }}
            render={({ field: f, fieldState }) => (
              <View className="min-w-0 flex-1 gap-1">
                <Input
                  value={f.value}
                  onChangeText={f.onChange}
                  onBlur={f.onBlur}
                  placeholder={t('world:carrying.stackableKeyPlaceholder')}
                  aria-label={t('world:carrying.stackableKey')}
                  maxLength={40}
                  editable={!blocked}
                  accessibilityHint={blocked ? blockedReason : undefined}
                  aria-invalid={fieldState.error != null}
                />
                {fieldState.error != null ? (
                  <Text size="xs" className="text-danger">
                    {issueLabel(fieldState.error.message)}
                  </Text>
                ) : null}
              </View>
            )}
          />
          <Controller
            control={control}
            name={`stackables.${index}.count`}
            render={({ field: f, fieldState }) => (
              <View className="w-28">
                <NumberInput
                  value={f.value}
                  onChange={f.onChange}
                  label={t('world:carrying.stackableCount')}
                  disabled={blocked}
                  disabledReason={blockedReason}
                  invalid={fieldState.error != null}
                />
              </View>
            )}
          />
          <IconAction
            icon={Trash2}
            label={t('world:carrying.removeStackable')}
            size="sm"
            variant="destructive"
            disabled={blocked}
            disabledReason={blockedReason}
            onPress={() => {
              remove(index)
              trigger('stackables').catch((error: unknown) => {
                logger.error('app.world_stackables_revalidate_failed', {
                  error: error instanceof Error ? error.message : String(error),
                })
              })
            }}
          />
        </View>
      ))}
      <View className="flex-row">
        <Button
          variant="secondary"
          size="sm"
          disabled={blocked}
          onPress={() => append({ key: '', count: 1 })}
        >
          <Text>{t('world:carrying.addStackable')}</Text>
        </Button>
      </View>
    </View>
  )
}
