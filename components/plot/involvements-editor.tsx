import { ExternalLink, Trash2 } from 'lucide-react-native'
import {
  Controller,
  useFieldArray,
  useWatch,
  type Control,
  type UseFormTrigger,
} from 'react-hook-form'
import { View } from 'react-native'

import { EntityPicker } from '@/components/compounds/entity-picker'
import { FormRow } from '@/components/compounds/form-row'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { IconAction } from '@/components/ui/icon-action'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import type { Entity, EntityKind } from '@/lib/db'
import { t } from '@/lib/i18n'
import type { HappeningDraft } from '@/lib/plot'

import { issueLabel } from './plot-copy'

const ALL_KINDS: readonly EntityKind[] = ['character', 'location', 'item', 'faction']

export type InvolvementsEditorProps = {
  control: Control<HappeningDraft>
  trigger: UseFormTrigger<HappeningDraft>
  entities: readonly Entity[]
  blocked: boolean
  blockedReason?: string
  /** The row's entity opens in World. */
  onOpenEntity: (entity: Entity) => void
}

// plot.md → Happenings side → Involvements: kind-aware entity picker plus free-form role.
export function InvolvementsEditor({
  control,
  trigger,
  entities,
  blocked,
  blockedReason,
  onOpenEntity,
}: InvolvementsEditorProps) {
  const { fields, append, remove } = useFieldArray({ control, name: 'involvements' })
  const rows = useWatch({ control, name: 'involvements' }) ?? []
  const taken = rows.map((r) => r.entityId).filter((id) => id !== '')

  return (
    <View className="gap-4">
      {fields.length === 0 ? (
        <EmptyState
          title={t('plot:involvements.empty')}
          subtext={t('plot:involvements.emptyBody')}
        />
      ) : null}
      {fields.map((field, index) => {
        const entity = entities.find((e) => e.id === rows[index]?.entityId)
        const removeLabel =
          entity != null
            ? t('plot:involvements.removeNamed', { name: entity.name })
            : t('plot:involvements.remove')
        return (
          // Keyed by the draft's own row id, not `field.id` — a reset (Save's rebase, a
          // classifier patch) regenerates every `field.id`, remounting cards and dropping focus.
          <View
            key={rows[index]?.id ?? field.id}
            className="gap-2 rounded-md border border-border p-3"
            testID={`involvement-${index}`}
          >
            <Controller
              control={control}
              name={`involvements.${index}.entityId`}
              // Cross-row duplicates are whole-array; plain onChange revalidates only this
              // leaf, leaving another row's stale `duplicateEntity` error in place.
              rules={{ deps: ['involvements'] }}
              render={({ field: f, fieldState }) => (
                <FormRow
                  label={t('plot:fields.entity')}
                  error={issueLabel(fieldState.error?.message)}
                >
                  <EntityPicker
                    value={f.value === '' ? null : f.value}
                    onChange={(id) => f.onChange(id ?? '')}
                    entities={entities}
                    kinds={ALL_KINDS}
                    excludeIds={taken.filter((id) => id !== f.value)}
                    label={t('plot:fields.entity')}
                    placeholder={t('plot:fields.entityPlaceholder')}
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
              name={`involvements.${index}.role`}
              render={({ field: f }) => (
                <FormRow label={t('plot:fields.role')}>
                  <Input
                    value={f.value}
                    onChangeText={f.onChange}
                    placeholder={t('plot:fields.rolePlaceholder')}
                    editable={!blocked}
                    accessibilityHint={blocked ? blockedReason : undefined}
                    aria-label={t('plot:fields.role')}
                  />
                </FormRow>
              )}
            />
            <View className="flex-row justify-end gap-2">
              {entity != null ? (
                <IconAction
                  icon={ExternalLink}
                  label={t('plot:involvements.openInWorld', { name: entity.name })}
                  size="sm"
                  onPress={() => onOpenEntity(entity)}
                />
              ) : null}
              <IconAction
                icon={Trash2}
                label={removeLabel}
                size="sm"
                variant="destructive"
                disabled={blocked}
                disabledReason={blockedReason}
                onPress={() => {
                  remove(index)
                  // `useFieldArray`'s post-remove revalidation only compares the array's root
                  // error type/message (no-op for per-index errors) — stale survivors need this.
                  void trigger('involvements')
                }}
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
        onPress={() => append({ id: null, entityId: '', role: '' })}
      >
        <Text>{t('plot:involvements.add')}</Text>
      </Button>
    </View>
  )
}
