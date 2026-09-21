import { useMemo, useState } from 'react'
import { View } from 'react-native'

import { EntityKindIcon } from '@/components/entity/entity-kind-icon'
import {
  SearchableOverlayList,
  type Row,
  type Section,
} from '@/components/ui/searchable-overlay-list'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import type { Entity, EntityKind } from '@/lib/db'
import { t } from '@/lib/i18n'
import { normalizeTerm } from '@/lib/keyword-terms'

import { PickerField } from './picker-field'

type EntityPickerProps = {
  value: string | null
  onChange: (id: string | null) => void
  /** The branch's entities; the surface passes them so the picker reads no store. */
  entities: readonly Entity[]
  kinds: readonly EntityKind[]
  /** Hidden from the list unless one is the current value. */
  excludeIds?: readonly string[]
  label: string
  placeholder: string
  disabled?: boolean
  disabledReason?: string
  clearable?: boolean
  'aria-invalid'?: boolean | 'true' | 'false'
  testID?: string
}

const KIND_ORDER: readonly EntityKind[] = ['character', 'location', 'item', 'faction']

/**
 * A kind-aware picker over the branch's entities returning an entity id — two rows can
 * share a name, so a string Autocomplete cannot carry the value.
 */
export function EntityPicker({
  value,
  onChange,
  entities,
  kinds,
  excludeIds,
  label,
  placeholder,
  disabled,
  disabledReason,
  clearable = true,
  'aria-invalid': ariaInvalid,
  testID,
}: EntityPickerProps) {
  const [query, setQuery] = useState('')
  const selected = useMemo(() => entities.find((e) => e.id === value) ?? null, [entities, value])
  const sections = useMemo<Section<Entity>[]>(() => {
    const needle = normalizeTerm(query)
    const excluded = new Set(excludeIds ?? [])
    const eligible = entities.filter(
      (e) =>
        kinds.includes(e.kind) &&
        (!excluded.has(e.id) || e.id === value) &&
        (needle === '' || normalizeTerm(e.name).includes(needle)),
    )
    return KIND_ORDER.filter((kind) => kinds.includes(kind))
      .map((kind) => ({
        id: kind,
        header:
          kinds.length > 1 ? (
            <Text size="xs" variant="muted" className="px-3 py-1 font-medium uppercase">
              {t(`world:categories.${kind}`)}
            </Text>
          ) : undefined,
        rows: eligible
          .filter((e) => e.kind === kind)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map<Row<Entity>>((e) => ({ id: e.id, data: e })),
      }))
      .filter((section) => section.rows.length > 0)
  }, [entities, kinds, excludeIds, query, value])

  return (
    <SearchableOverlayList<Entity>
      searchPlacement="in-overlay"
      searchPlaceholder={t('picker.entitySearch')}
      onQueryChange={setQuery}
      sections={sections}
      selectedRowIds={value == null ? undefined : [value]}
      sheetSize="medium"
      matchTriggerWidth
      ariaLabel={label}
      renderTrigger={(trigger) => (
        <PickerField
          trigger={trigger}
          placeholder={placeholder}
          label={label}
          disabled={disabled}
          disabledReason={disabledReason}
          aria-invalid={ariaInvalid}
          testID={testID}
          onClear={clearable ? () => onChange(null) : undefined}
        >
          {selected == null ? null : (
            <View className="min-w-0 flex-row items-center gap-2">
              <EntityKindIcon kind={selected.kind} className="h-4 w-4" />
              <Text numberOfLines={1}>{selected.name}</Text>
            </View>
          )}
        </PickerField>
      )}
      renderRow={(row) => (
        <View className="w-full flex-row items-center gap-2 px-3 py-2">
          <EntityKindIcon kind={row.data.kind} />
          <Text className="flex-1" numberOfLines={1}>
            {row.data.name}
          </Text>
          <Tag tone="soft">{t(`world:status.${row.data.status}`)}</Tag>
        </View>
      )}
      renderEmpty={() => (
        <Text size="sm" variant="muted" className="p-3">
          {t('picker.entityNoResults')}
        </Text>
      )}
      onActivate={(row) => onChange(row.data.id)}
    />
  )
}

export type { EntityPickerProps }
