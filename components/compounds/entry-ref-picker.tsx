import { useCallback, useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'

import {
  SearchableOverlayList,
  type Row,
  type Section,
} from '@/components/ui/searchable-overlay-list'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { formatEntryRef, indexEntryRefs, type EntryRef } from '@/lib/entry-refs'
import { t } from '@/lib/i18n'
import { normalizeTerm } from '@/lib/keyword-terms'

import { PickerField } from './picker-field'

type EntryRefPickerProps = {
  value: string | null
  onChange: (id: string | null) => void
  /** The branch's entries, newest first, from `useEntryIndex`. */
  entries: readonly EntryRef[]
  label: string
  placeholder: string
  disabled?: boolean
  disabledReason?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  testID?: string
}

// `#12` / `12` match positions by prefix; anything else searches the excerpt.
function matchesEntry(entry: EntryRef, query: string): boolean {
  const trimmed = query.trim()
  if (trimmed === '') return true
  const digits = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed
  if (/^\d+$/.test(digits)) return String(entry.position).startsWith(digits)
  return normalizeTerm(entry.excerpt).includes(normalizeTerm(trimmed))
}

/**
 * Picks a branch entry id, rendering `entry #n` plus an excerpt or the dangling state — a
 * `value` absent from `entries` (the entries store is a trailing window, not every anchor
 * is resolvable) renders the dangling state instead of silently falling back to placeholder.
 */
export function EntryRefPicker({
  value,
  onChange,
  entries,
  label,
  placeholder,
  disabled,
  disabledReason,
  'aria-invalid': ariaInvalid,
  testID,
}: EntryRefPickerProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const index = useMemo(() => indexEntryRefs(entries), [entries])
  const selected = useMemo(
    () => (value == null ? null : (index.get(value) ?? null)),
    [index, value],
  )
  const hasValue = value != null
  const missing = hasValue && selected == null
  const valueText =
    selected != null
      ? formatEntryRef(selected.position)
      : missing
        ? t('entryRefDangling')
        : undefined

  const sections = useMemo<Section<EntryRef>[]>(
    () => [
      {
        id: 'entries',
        rows: entries
          .filter((entry) => matchesEntry(entry, query))
          .map<Row<EntryRef>>((entry) => ({ id: entry.id, data: entry })),
      },
    ],
    [entries, query],
  )

  const handleActivate = useCallback((row: Row<EntryRef>) => onChange(row.data.id), [onChange])

  return (
    <SearchableOverlayList<EntryRef>
      searchPlacement="in-overlay"
      searchPlaceholder={t('picker.entrySearch')}
      onQueryChange={setQuery}
      sections={sections}
      open={open}
      onOpenChange={setOpen}
      selectedRowIds={value == null ? undefined : [value]}
      initialScrollRowId={value ?? undefined}
      sheetSize="tall"
      matchTriggerWidth
      ariaLabel={label}
      renderTrigger={(trigger) => (
        <PickerField
          {...trigger}
          hasValue={hasValue}
          valueText={valueText}
          placeholder={placeholder}
          label={label}
          disabled={disabled}
          disabledReason={disabledReason}
          aria-invalid={ariaInvalid}
          testID={testID}
          onClear={() => onChange(null)}
        >
          {!hasValue ? null : <EntryRefText entry={selected} />}
        </PickerField>
      )}
      renderRow={(row) => (
        <View className="w-full flex-row items-center gap-2">
          <Tag tone="soft">{formatEntryRef(row.data.position)}</Tag>
          <Text size="xs" variant="muted">
            {t(`entryKind.${row.data.kind}`)}
          </Text>
          <View className="min-w-0 flex-1">
            <Text size="sm" className="shrink" numberOfLines={1}>
              {row.data.excerpt}
            </Text>
          </View>
        </View>
      )}
      renderEmpty={(activeQuery) => (
        <Text size="sm" variant="muted" className="p-3">
          {activeQuery ? t('picker.entryNoResults') : t('picker.entryNone')}
        </Text>
      )}
      onActivate={handleActivate}
    />
  )
}

type EntryRefTextProps = {
  /** The resolved entry, or null for a set id the index no longer holds (the dangling state). */
  entry: EntryRef | null
  withExcerpt?: boolean
}

/** `entry #n` plus excerpt, or the dangling state — shared by the picker and read-only refs. */
export function EntryRefText({ entry, withExcerpt = true }: EntryRefTextProps) {
  if (entry == null) return <Tag tone="warning">{t('entryRefDangling')}</Tag>
  return (
    <View className="min-w-0 flex-1 flex-row items-center gap-2">
      <Tag tone="soft">{formatEntryRef(entry.position)}</Tag>
      {withExcerpt ? (
        <Text size="sm" variant="muted" className="shrink" numberOfLines={1}>
          {entry.excerpt}
        </Text>
      ) : null}
    </View>
  )
}

export type { EntryRefPickerProps, EntryRefTextProps }
