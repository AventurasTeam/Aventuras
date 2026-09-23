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
  /**
   * The branch's entries, newest first — `useEntryIndex(branchId)`'s `entries`, passed once
   * `ready` is true. Never `entriesStore`: an unready/partial index renders values as dangling.
   */
  entries: readonly EntryRef[]
  label: string
  placeholder: string
  disabled?: boolean
  disabledReason?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  testID?: string
}

type QueryMode =
  | { kind: 'all' }
  | { kind: 'position'; digits: string }
  | { kind: 'positionOrExcerpt'; digits: string }
  | { kind: 'excerpt'; needle: string }

// A leading `#` means position-only (bare `#` matches all, not empty). Bare digits union
// position and excerpt — a position can appear in excerpt prose; the label itself never matches.
function parseQuery(raw: string): QueryMode {
  const trimmed = raw.trim()
  if (trimmed === '') return { kind: 'all' }
  if (trimmed.startsWith('#')) return { kind: 'position', digits: trimmed.slice(1).trimStart() }
  if (/^\d+$/.test(trimmed)) return { kind: 'positionOrExcerpt', digits: trimmed }
  return { kind: 'excerpt', needle: normalizeTerm(trimmed) }
}

// Exact match first, then shorter strings, then newest for ties — `#12` over hundreds of entries
// must rank above #120…#129 (shared "12" prefix), or Enter would commit the wrong row.
function comparePositionMatches(digits: string) {
  return (a: EntryRef, b: EntryRef) => {
    const aStr = String(a.position)
    const bStr = String(b.position)
    const aExact = aStr === digits
    const bExact = bStr === digits
    if (aExact !== bExact) return aExact ? -1 : 1
    if (aStr.length !== bStr.length) return aStr.length - bStr.length
    return b.position - a.position
  }
}

type IndexedEntry = { entry: EntryRef; normalizedExcerpt: string }

function matchAndSort(indexed: readonly IndexedEntry[], mode: QueryMode): EntryRef[] {
  if (mode.kind === 'all') return indexed.map((i) => i.entry)
  if (mode.kind === 'excerpt') {
    return indexed.filter((i) => i.normalizedExcerpt.includes(mode.needle)).map((i) => i.entry)
  }
  const { digits } = mode
  if (digits === '') return indexed.map((i) => i.entry)
  const positionMatches = indexed
    .filter((i) => String(i.entry.position).startsWith(digits))
    .map((i) => i.entry)
    .sort(comparePositionMatches(digits))
  if (mode.kind === 'position') return positionMatches
  const positionIds = new Set(positionMatches.map((e) => e.id))
  const needle = normalizeTerm(digits)
  const excerptOnly = indexed
    .filter((i) => !positionIds.has(i.entry.id) && i.normalizedExcerpt.includes(needle))
    .map((i) => i.entry)
  return [...positionMatches, ...excerptOnly]
}

/**
 * Picks a branch entry id, rendering `entry #n` + excerpt or the dangling state — entry refs are
 * FK-less ids (data-model.md); a `value` absent from `entries` dangles, never a silent fallback.
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
  // Latches true on `open`'s first flip, never resets — gorhom keeps the phone Sheet's children
  // mounted through close animation, so gating on `open` itself would flash the empty state.
  const [hasOpened, setHasOpened] = useState(false)
  if (open && !hasOpened) setHasOpened(true)

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const index = useMemo(() => indexEntryRefs(entries), [entries])
  const indexedEntries = useMemo<IndexedEntry[]>(
    () =>
      hasOpened
        ? entries.map((entry) => ({ entry, normalizedExcerpt: normalizeTerm(entry.excerpt) }))
        : [],
    [hasOpened, entries],
  )
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

  // Gated on `hasOpened`, not `open`: an unopened picker builds no search index, and closing never
  // empties rows while the overlay is still animating out — filtering by `query` continues.
  const sections = useMemo<Section<EntryRef>[]>(() => {
    if (!hasOpened) return []
    const rows = matchAndSort(indexedEntries, parseQuery(query)).map<Row<EntryRef>>((entry) => ({
      id: entry.id,
      data: entry,
    }))
    return [{ id: 'entries', rows }]
  }, [hasOpened, indexedEntries, query])

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
}

/** `entry #n` plus excerpt, or the dangling state — shared by the picker and read-only refs. */
export function EntryRefText({ entry }: EntryRefTextProps) {
  if (entry == null) {
    // A row-shaped wrapper, not a bare Tag: RN-Web's column `align-items: stretch` would otherwise
    // stretch the pill full-width — a column parent (e.g. FormRow) is the common host here.
    return (
      <View className="min-w-0 flex-1 flex-row items-center">
        <Tag tone="warning">
          <Text size="xs">⚠ {t('entryRefDangling')}</Text>
        </Tag>
      </View>
    )
  }
  return (
    <View className="min-w-0 flex-1 flex-row items-center gap-2">
      <Tag tone="soft">{formatEntryRef(entry.position)}</Tag>
      <Text size="sm" variant="muted" className="shrink" numberOfLines={1}>
        {entry.excerpt}
      </Text>
    </View>
  )
}

export type { EntryRefPickerProps, EntryRefTextProps }
