import { useCallback, useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'

import { EntityKindIcon } from '@/components/entity/entity-kind-icon'
import { ENTITY_STATUS_TONE } from '@/components/entity/entity-row'
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
import { collate, compareId } from '@/lib/list-modules'

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
  /** A muted note after a row's name — an item's current whereabouts, say. */
  rowHint?: (entity: Entity) => string | undefined
}

const KIND_ORDER: readonly EntityKind[] = ['character', 'location', 'item', 'faction']

function compareEntityRows(a: Entity, b: Entity): number {
  return collate(a.name, b.name) || a.createdAt - b.createdAt || compareId(a.id, b.id)
}

/**
 * Returns an entity id, not a name — two rows can share a name. A `value` absent from
 * `entities` (no FK on the link tables) renders a missing-entity warning, not a placeholder.
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
  rowHint,
}: EntityPickerProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const selected = useMemo(() => entities.find((e) => e.id === value) ?? null, [entities, value])
  const hasValue = value != null
  const missing = hasValue && selected == null

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
          .sort(compareEntityRows)
          .map<Row<Entity>>((e) => ({ id: e.id, data: e })),
      }))
      .filter((section) => section.rows.length > 0)
  }, [entities, kinds, excludeIds, query, value])

  const handleActivate = useCallback((row: Row<Entity>) => onChange(row.data.id), [onChange])

  return (
    <SearchableOverlayList<Entity>
      searchPlacement="in-overlay"
      searchPlaceholder={t('picker.entitySearch')}
      onQueryChange={setQuery}
      sections={sections}
      open={open}
      onOpenChange={setOpen}
      selectedRowIds={value == null ? undefined : [value]}
      initialScrollRowId={value ?? undefined}
      sheetSize="medium"
      matchTriggerWidth
      ariaLabel={label}
      renderTrigger={(trigger) => (
        <PickerField
          {...trigger}
          hasValue={hasValue}
          valueText={selected?.name ?? (missing ? t('picker.entityMissing') : undefined)}
          placeholder={placeholder}
          label={label}
          disabled={disabled}
          disabledReason={disabledReason}
          aria-invalid={ariaInvalid}
          testID={testID}
          onClear={clearable ? () => onChange(null) : undefined}
        >
          {!hasValue ? null : selected != null ? (
            <View className="min-w-0 flex-1 flex-row items-center gap-2">
              <View className="shrink-0">
                <EntityKindIcon kind={selected.kind} className="h-4 w-4" />
              </View>
              <Text size="sm" numberOfLines={1} className="shrink">
                {selected.name}
              </Text>
              {/* data-model.md → Lifecycle on retirement: UI badges retired participants. */}
              {selected.status !== 'active' ? (
                <View className="shrink-0">
                  <Tag tone={ENTITY_STATUS_TONE[selected.status]}>
                    {t(`world:status.${selected.status}`)}
                  </Tag>
                </View>
              ) : null}
            </View>
          ) : (
            <View className="min-w-0 flex-1 flex-row items-center">
              <Tag tone="warning">
                <Text size="xs">⚠ {t('picker.entityMissing')}</Text>
              </Tag>
            </View>
          )}
        </PickerField>
      )}
      renderRow={(row) => (
        <View className="w-full flex-row items-center gap-2">
          <View className="shrink-0">
            <EntityKindIcon kind={row.data.kind} />
          </View>
          <View className="min-w-0 flex-1">
            <Text size="sm" className="shrink" numberOfLines={1}>
              {row.data.name}
            </Text>
          </View>
          {rowHint?.(row.data) ? (
            <View className="shrink-0">
              <Text size="xs" variant="muted" numberOfLines={1}>
                {rowHint(row.data)}
              </Text>
            </View>
          ) : null}
          {row.data.status !== 'active' ? (
            <View className="shrink-0">
              <Tag tone={ENTITY_STATUS_TONE[row.data.status]}>
                {t(`world:status.${row.data.status}`)}
              </Tag>
            </View>
          ) : null}
        </View>
      )}
      renderEmpty={(activeQuery) => (
        <Text size="sm" variant="muted" className="p-3">
          {activeQuery ? t('picker.entityNoResults') : t('picker.entityNone')}
        </Text>
      )}
      onActivate={handleActivate}
    />
  )
}

export type { EntityPickerProps }
