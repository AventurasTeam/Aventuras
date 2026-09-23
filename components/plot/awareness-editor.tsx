import {
  Controller,
  useFieldArray,
  useWatch,
  type Control,
  type UseFormTrigger,
} from 'react-hook-form'
import { View } from 'react-native'

import { EntityPicker } from '@/components/compounds/entity-picker'
import { EntryRefPicker } from '@/components/compounds/entry-ref-picker'
import { FormRow } from '@/components/compounds/form-row'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import type { Entity } from '@/lib/db'
import type { EntryRef } from '@/lib/entry-refs'
import { t } from '@/lib/i18n'
import type { HappeningDraft } from '@/lib/plot'

import { DecayResistanceField } from './decay-resistance-field'
import { LinkCard, revalidateLinks } from './link-card'
import { issueLabel } from './plot-copy'

export type AwarenessEditorProps = {
  control: Control<HappeningDraft>
  trigger: UseFormTrigger<HappeningDraft>
  entities: readonly Entity[]
  /** A ready index — the pane mounts no editor before it is. */
  entries: readonly EntryRef[]
  blocked: boolean
  blockedReason?: string
  /** The row's character opens in World. */
  onOpenEntity: (entity: Entity) => void
}

// plot.md → Happenings side → Awareness.
export function AwarenessEditor({
  control,
  trigger,
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
          // A committed row keys by its own id, not `field.id` — see InvolvementsEditor.
          <LinkCard
            key={rows[index]?.id ?? field.id}
            list="awareness"
            testID={`awareness-${index}`}
            entity={entity}
            blocked={blocked}
            blockedReason={blockedReason}
            onOpenEntity={onOpenEntity}
            onRemove={() => {
              remove(index)
              revalidateLinks(trigger, 'awareness')
            }}
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
                    accessibilityHint={blocked ? blockedReason : undefined}
                    aria-label={t('plot:fields.source')}
                  />
                </FormRow>
              )}
            />
          </LinkCard>
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
