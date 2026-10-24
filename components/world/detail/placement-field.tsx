import { useCallback, useEffect, useMemo, useState } from 'react'
import { Controller, type Control } from 'react-hook-form'
import { View } from 'react-native'

import { FormRow } from '@/components/compounds/form-row'
import { PickerField } from '@/components/compounds/picker-field'
import { EntityKindIcon } from '@/components/entity/entity-kind-icon'
import { ENTITY_STATUS_TONE } from '@/components/entity/entity-row'
import {
  SearchableOverlayList,
  type Row,
  type Section,
} from '@/components/ui/searchable-overlay-list'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import type { Entity } from '@/lib/db'
import { t } from '@/lib/i18n'
import { normalizeTerm } from '@/lib/keyword-terms'
import { byName, type LocationDraft, type PlacePlacement } from '@/lib/world'

import { issueLabel } from '../world-copy'
import type { Gate } from './fields'

type Choice = Exclude<PlacePlacement['kind'], 'under'>

type PlacementRow = { kind: 'choice'; choice: Choice } | { kind: 'place'; place: Entity }

// Beside entity ids in one list: no `loc_<uuid>` id starts with `placement:`.
const CHOICE_ROW_ID: Record<Choice, string> = {
  unplaced: 'placement:unplaced',
  top: 'placement:top',
}

const CHOICE_LABEL: Record<Choice, () => string> = {
  unplaced: () => t('world:connections.placementUnknown'),
  top: () => t('world:connections.placementTopLevel'),
}

function rowIdOf(placement: PlacePlacement): string {
  return placement.kind === 'under' ? placement.parentId : CHOICE_ROW_ID[placement.kind]
}

function StatusTag({ entity }: { entity: Entity }) {
  // A non-active place, staged or retired, carries its status tag, as EntityPicker's rows do.
  if (entity.status === 'active') return null
  return (
    <View className="shrink-0">
      <Tag tone={ENTITY_STATUS_TONE[entity.status]}>{t(`world:status.${entity.status}`)}</Tag>
    </View>
  )
}

function TriggerValue({ value, parent }: { value: PlacePlacement; parent: Entity | null }) {
  if (value.kind !== 'under')
    return (
      <View className="min-w-0 flex-1 flex-row items-center">
        <Text size="sm" variant={value.kind === 'unplaced' ? 'muted' : 'default'} numberOfLines={1}>
          {CHOICE_LABEL[value.kind]()}
        </Text>
      </View>
    )
  if (parent == null)
    return (
      <View className="min-w-0 flex-1 flex-row items-center">
        <Tag tone="warning">
          <Text size="xs">⚠ {t('picker.entityMissing')}</Text>
        </Tag>
      </View>
    )
  return (
    <View className="min-w-0 flex-1 flex-row items-center gap-2">
      <View className="shrink-0">
        <EntityKindIcon kind="location" className="h-4 w-4" />
      </View>
      <Text size="sm" numberOfLines={1} className="shrink">
        {parent.name}
      </Text>
      <StatusTag entity={parent} />
    </View>
  )
}

function PlacementRowView({ row }: { row: PlacementRow }) {
  if (row.kind === 'choice')
    return (
      <View className="w-full flex-row items-center">
        <Text size="sm" numberOfLines={1}>
          {CHOICE_LABEL[row.choice]()}
        </Text>
      </View>
    )
  return (
    <View className="w-full flex-row items-center gap-2">
      <View className="shrink-0">
        <EntityKindIcon kind="location" />
      </View>
      <View className="min-w-0 flex-1">
        <Text size="sm" className="shrink" numberOfLines={1}>
          {row.place.name}
        </Text>
      </View>
      <StatusTag entity={row.place} />
    </View>
  )
}

type PlacementPickerProps = {
  value: PlacePlacement
  onChange: (placement: PlacePlacement) => void
  /** The branch's entities; the places among them are the parents on offer. */
  entities: readonly Entity[]
  /** Hidden from the list unless one is the current parent. */
  excludeIds: readonly string[]
  /** world.md → Overview: `Unknown` is offered only while the saved place is unplaced. */
  offerUnknown: boolean
  label: string
  disabled?: boolean
  disabledReason?: string
  'aria-invalid'?: boolean
  testID?: string
  /** Adds the `↗` that opens the parent; hidden for `Unknown`, `Top level` or a missing parent. */
  onOpen?: (id: string) => void
}

/** A place's placement: `Unknown`, `Top level`, or a parent place (world.md → Overview). */
export function PlacementPicker({
  value,
  onChange,
  entities,
  excludeIds,
  offerUnknown,
  label,
  disabled,
  disabledReason,
  'aria-invalid': ariaInvalid,
  testID,
  onOpen,
}: PlacementPickerProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const parentId = value.kind === 'under' ? value.parentId : null
  const parent = useMemo(
    () => (parentId == null ? null : (entities.find((e) => e.id === parentId) ?? null)),
    [entities, parentId],
  )

  const sections = useMemo<Section<PlacementRow>[]>(() => {
    const needle = normalizeTerm(query)
    const matches = (text: string) => needle === '' || normalizeTerm(text).includes(needle)
    const choices: Choice[] = offerUnknown ? ['unplaced', 'top'] : ['top']
    const excluded = new Set(excludeIds)
    const choiceRows = choices
      .filter((choice) => matches(CHOICE_LABEL[choice]()))
      .map(
        (choice): Row<PlacementRow> => ({
          id: CHOICE_ROW_ID[choice],
          data: { kind: 'choice', choice },
        }),
      )
    const placeRows = entities
      .filter(
        (e) =>
          e.kind === 'location' && (!excluded.has(e.id) || e.id === parentId) && matches(e.name),
      )
      .sort(byName)
      .map((e): Row<PlacementRow> => ({ id: e.id, data: { kind: 'place', place: e } }))
    const all: Section<PlacementRow>[] = [
      { id: 'choices', rows: choiceRows },
      { id: 'places', rows: placeRows },
    ]
    return all.filter((section) => section.rows.length > 0)
  }, [entities, excludeIds, offerUnknown, parentId, query])

  const handleActivate = useCallback(
    (row: Row<PlacementRow>) =>
      onChange(
        row.data.kind === 'place'
          ? { kind: 'under', parentId: row.data.place.id }
          : { kind: row.data.choice },
      ),
    [onChange],
  )

  const valueText =
    value.kind === 'under'
      ? (parent?.name ?? t('picker.entityMissing'))
      : CHOICE_LABEL[value.kind]()
  const selectedId = rowIdOf(value)

  return (
    <SearchableOverlayList<PlacementRow>
      searchPlacement="in-overlay"
      searchPlaceholder={t('world:connections.placementSearch')}
      onQueryChange={setQuery}
      sections={sections}
      open={open}
      onOpenChange={setOpen}
      selectedRowIds={[selectedId]}
      initialScrollRowId={selectedId}
      sheetSize="medium"
      matchTriggerWidth
      ariaLabel={label}
      renderTrigger={(trigger) => (
        <PickerField
          {...trigger}
          hasValue
          valueText={valueText}
          placeholder={CHOICE_LABEL.unplaced()}
          label={label}
          disabled={disabled}
          disabledReason={disabledReason}
          aria-invalid={ariaInvalid}
          testID={testID}
          openLabel={onOpen == null ? undefined : t('picker.open', { name: parent?.name ?? label })}
          onOpen={onOpen == null || parent == null ? undefined : () => onOpen(parent.id)}
        >
          <TriggerValue value={value} parent={parent} />
        </PickerField>
      )}
      renderRow={(row) => <PlacementRowView row={row.data} />}
      // Top level is always on offer, so the list is only ever empty under a query.
      renderEmpty={() => (
        <Text size="sm" variant="muted" className="p-3">
          {t('world:connections.placementNoResults')}
        </Text>
      )}
      onActivate={handleActivate}
    />
  )
}

type PlacementFieldProps = Gate & {
  control: Control<LocationDraft>
  entities: readonly Entity[]
  excludeIds: readonly string[]
  offerUnknown: boolean
  testID?: string
  onOpenEntity?: (id: string) => void
}

/** The Connections tab's placement; a field error (parent-cycle) renders below. */
export function PlacementField({
  control,
  entities,
  excludeIds,
  offerUnknown,
  testID,
  onOpenEntity,
  blocked,
  blockedReason,
}: PlacementFieldProps) {
  const label = t('world:fields.parentLocation')
  return (
    <Controller
      control={control}
      name="placement"
      render={({ field, fieldState }) => (
        <FormRow label={label} error={issueLabel(fieldState.error?.message)}>
          <PlacementPicker
            value={field.value}
            onChange={field.onChange}
            entities={entities}
            excludeIds={excludeIds}
            offerUnknown={offerUnknown}
            label={label}
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
