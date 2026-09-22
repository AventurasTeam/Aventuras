import { ExternalLink, Trash2 } from 'lucide-react-native'
import { Controller, useFieldArray, useWatch, type Control } from 'react-hook-form'
import { View } from 'react-native'

import { EntityPicker } from '@/components/compounds/entity-picker'
import { EntryRefPicker } from '@/components/compounds/entry-ref-picker'
import { FormRow } from '@/components/compounds/form-row'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { IconAction } from '@/components/ui/icon-action'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import type { Entity } from '@/lib/db'
import type { EntryRef } from '@/lib/entry-refs'
import { t } from '@/lib/i18n'
import type { HappeningDraft } from '@/lib/plot'

import { DecayResistanceField } from './decay-resistance-field'
import { issueLabel } from './plot-copy'

export type AwarenessEditorProps = {
  control: Control<HappeningDraft>
  entities: readonly Entity[]
  /** A ready index — the pane mounts no editor before it is. */
  entries: readonly EntryRef[]
  blocked: boolean
  blockedReason?: string
  /** The row's character opens in World; the pane routes it through the session's leave guard. */
  onOpenEntity: (entity: Entity) => void
}

// plot.md → Happenings side → Awareness: character picker, learned-at, decay resistance, source.
export function AwarenessEditor({
  control,
  entities,
  entries,
  blocked,
  blockedReason,
  onOpenEntity,
}: AwarenessEditorProps) {
  const { fields, append, remove } = useFieldArray({ control, name: 'awareness' })
  const rows = useWatch({ control, name: 'awareness' }) ?? []
  const taken = rows.map((r) => r.characterId).filter((id) => id !== '')

  return (
    <View className="gap-4">
      {fields.length === 0 ? (
        <EmptyState title={t('plot:awareness.empty')} subtext={t('plot:awareness.emptyBody')} />
      ) : null}
      {fields.map((field, index) => {
        const entity = entities.find((e) => e.id === rows[index]?.characterId)
        return (
          <View
            key={field.id}
            className="gap-2 rounded-md border border-border p-3"
            testID={`awareness-${index}`}
          >
            <Controller
              control={control}
              name={`awareness.${index}.characterId`}
              // Cross-row duplicates are a whole-array schema issue; a plain onChange revalidates
              // only this leaf, leaving another row's stale `duplicateCharacter` error in place.
              rules={{ deps: ['awareness'] }}
              render={({ field: f, fieldState }) => (
                <FormRow
                  label={t('plot:fields.character')}
                  error={issueLabel(fieldState.error?.message)}
                >
                  <EntityPicker
                    value={f.value === '' ? null : f.value}
                    onChange={(id) => f.onChange(id ?? '')}
                    entities={entities}
                    kinds={['character']}
                    excludeIds={taken.filter((id) => id !== f.value)}
                    label={t('plot:fields.character')}
                    placeholder={t('plot:fields.characterPlaceholder')}
                    disabled={blocked}
                    disabledReason={blockedReason}
                    clearable={false}
                    aria-invalid={fieldState.invalid}
                  />
                </FormRow>
              )}
            />
            <Controller
              control={control}
              name={`awareness.${index}.learnedAtEntryId`}
              render={({ field: f }) => (
                <FormRow label={t('plot:fields.learnedAt')}>
                  <EntryRefPicker
                    value={f.value}
                    onChange={f.onChange}
                    entries={entries}
                    label={t('plot:fields.learnedAt')}
                    placeholder={t('plot:fields.learnedAtPlaceholder')}
                    disabled={blocked}
                    disabledReason={blockedReason}
                  />
                </FormRow>
              )}
            />
            <Controller
              control={control}
              name={`awareness.${index}.decayResistance`}
              render={({ field: f, fieldState }) => (
                <FormRow
                  label={t('plot:fields.decayResistance')}
                  hint={t('plot:fields.decayResistanceHint')}
                  error={issueLabel(fieldState.error?.message)}
                >
                  <DecayResistanceField
                    value={f.value}
                    onChange={f.onChange}
                    label={t('plot:fields.decayResistance')}
                    disabled={blocked}
                    disabledReason={blockedReason}
                    invalid={fieldState.invalid}
                  />
                </FormRow>
              )}
            />
            <Controller
              control={control}
              name={`awareness.${index}.source`}
              render={({ field: f }) => (
                <FormRow label={t('plot:fields.source')}>
                  <Input
                    value={f.value}
                    onChangeText={f.onChange}
                    placeholder={t('plot:fields.sourcePlaceholder')}
                    editable={!blocked}
                    aria-label={t('plot:fields.source')}
                  />
                </FormRow>
              )}
            />
            <View className="flex-row justify-end gap-2">
              {entity != null ? (
                <IconAction
                  icon={ExternalLink}
                  label={t('plot:awareness.openInWorld')}
                  size="sm"
                  onPress={() => onOpenEntity(entity)}
                />
              ) : null}
              <IconAction
                icon={Trash2}
                label={t('plot:awareness.remove')}
                size="sm"
                disabled={blocked}
                disabledReason={blockedReason}
                onPress={() => remove(index)}
              />
            </View>
          </View>
        )
      })}
      <Button
        variant="secondary"
        size="sm"
        disabled={blocked}
        disabledReason={blockedReason}
        onPress={() =>
          append({
            id: null,
            characterId: '',
            learnedAtEntryId: null,
            decayResistance: null,
            source: '',
          })
        }
      >
        <Text>{t('plot:awareness.add')}</Text>
      </Button>
    </View>
  )
}
