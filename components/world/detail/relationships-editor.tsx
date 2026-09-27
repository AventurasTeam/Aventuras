import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react-native'
import { useState } from 'react'
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
import { ListRow } from '@/components/compounds/list-row'
import { EntityKindIcon } from '@/components/entity/entity-kind-icon'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { IconAction } from '@/components/ui/icon-action'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import type { Entity, EntityKind } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { generateId } from '@/lib/ids'
import type { CharacterDraft } from '@/lib/world'

import { issueLabel, relationshipDescription } from '../world-copy'
import type { Gate } from './fields'

const CHARACTER: readonly EntityKind[] = ['character']

type RelationshipsEditorProps = Gate & {
  control: Control<CharacterDraft>
  trigger: UseFormTrigger<CharacterDraft>
  /** The pane's character; null while creating. */
  selfId: string | null
  entities: readonly Entity[]
}

/** world.md → Relationships. Inline cards: the phone picker is a Sheet, and Sheets can't stack. */
export function RelationshipsEditor({
  control,
  trigger,
  selfId,
  entities,
  blocked,
  blockedReason,
}: RelationshipsEditorProps) {
  const { fields, append, remove } = useFieldArray({ control, name: 'relationships' })
  const rows = useWatch({ control, name: 'relationships' }) ?? []
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  // A key that left the draft (Delete, undo, classifier removal) may return, and must return
  // collapsed. Prune only keys seen in `rows`: a just-added one may reach `rows` a render late.
  const keys = rows.map((r) => r.cardKey)
  const [seen, setSeen] = useState(keys)
  if (keys.length !== seen.length || keys.some((key, i) => key !== seen[i])) {
    setSeen(keys)
    const gone = seen.filter((key) => !keys.includes(key))
    if (gone.some((key) => open.has(key)))
      setOpen((prev) => new Set([...prev].filter((key) => !gone.includes(key))))
  }

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const taken = rows.map((r) => r.otherId).filter((id) => id !== '')
  const exclude = selfId == null ? taken : [selfId, ...taken]
  const revalidate = () => {
    trigger('relationships').catch((error: unknown) => {
      logger.error('app.world_relationships_revalidate_failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }

  return (
    <View className="gap-2" testID="relationships">
      {fields.length === 0 ? (
        <Text size="sm" variant="muted">
          {t('world:relationships.empty')}
        </Text>
      ) : null}
      {fields.map((field, index) => {
        const row = rows[index]
        const other = entities.find((e) => e.id === row?.otherId)
        const name =
          other?.name ??
          (row?.otherId ? t('world:entityMissing') : t('world:relationships.unnamed'))
        // Not `field.id`: react-hook-form regenerates it on every reset (a store patch, each Save),
        // which would collapse and remount the card being edited.
        const key = row?.cardKey ?? field.id
        const expanded = open.has(key)
        return (
          <View key={key} className="gap-2" testID={`relationship-${index}`}>
            <ListRow
              label={name}
              description={relationshipDescription(row?.selfToOther, row?.otherToSelf)}
              leading={<EntityKindIcon kind="character" />}
              trailing={
                <Icon
                  as={expanded ? ChevronDown : ChevronRight}
                  aria-hidden
                  size="sm"
                  className="text-fg-muted"
                />
              }
              onPress={() => toggle(key)}
            />
            {expanded ? (
              <View className="gap-3 rounded-md border border-border p-3">
                <Controller
                  control={control}
                  name={`relationships.${index}.otherId`}
                  rules={{ deps: ['relationships'] }}
                  render={({ field: f, fieldState }) => (
                    <FormRow
                      label={t('world:relationships.character')}
                      error={issueLabel(fieldState.error?.message)}
                    >
                      <EntityPicker
                        value={f.value === '' ? null : f.value}
                        onChange={(id) => f.onChange(id ?? '')}
                        entities={entities}
                        kinds={CHARACTER}
                        excludeIds={exclude}
                        label={t('world:relationships.character')}
                        placeholder={t('world:relationships.characterPlaceholder')}
                        clearable={false}
                        disabled={blocked}
                        disabledReason={blockedReason}
                        aria-invalid={fieldState.error != null}
                      />
                    </FormRow>
                  )}
                />
                <Controller
                  control={control}
                  name={`relationships.${index}.selfToOther`}
                  rules={{ deps: ['relationships'] }}
                  render={({ field: f, fieldState }) => (
                    <FormRow
                      label={t('world:relationships.your')}
                      error={issueLabel(fieldState.error?.message)}
                    >
                      <Input
                        value={f.value}
                        onChangeText={f.onChange}
                        onBlur={f.onBlur}
                        placeholder={t('world:relationships.yourPlaceholder')}
                        aria-label={t('world:relationships.your')}
                        editable={!blocked}
                        accessibilityHint={blocked ? blockedReason : undefined}
                        aria-invalid={fieldState.error != null}
                      />
                    </FormRow>
                  )}
                />
                <Controller
                  control={control}
                  name={`relationships.${index}.otherToSelf`}
                  rules={{ deps: ['relationships'] }}
                  render={({ field: f }) => (
                    <FormRow label={t('world:relationships.their')}>
                      <Input
                        value={f.value}
                        onChangeText={f.onChange}
                        onBlur={f.onBlur}
                        placeholder={t('world:relationships.theirPlaceholder')}
                        aria-label={t('world:relationships.their')}
                        editable={!blocked}
                        accessibilityHint={blocked ? blockedReason : undefined}
                      />
                    </FormRow>
                  )}
                />
                <View className="flex-row items-center justify-between">
                  <IconAction
                    icon={Trash2}
                    label={t('world:relationships.deleteNamed', { name })}
                    size="sm"
                    variant="destructive"
                    disabled={blocked}
                    disabledReason={blockedReason}
                    onPress={() => {
                      remove(index)
                      revalidate()
                    }}
                  />
                  <Button variant="secondary" size="sm" onPress={() => toggle(key)}>
                    <Text>{t('world:relationships.done')}</Text>
                  </Button>
                </View>
              </View>
            ) : null}
          </View>
        )
      })}
      <ListRow
        label={t('world:relationships.add')}
        leading={<Icon as={Plus} aria-hidden size="sm" />}
        disabled={blocked}
        onPress={() => {
          const cardKey = generateId('reldraft')
          setOpen((prev) => new Set(prev).add(cardKey))
          append({ cardKey, otherId: '', selfToOther: '', otherToSelf: '' })
        }}
      />
    </View>
  )
}
