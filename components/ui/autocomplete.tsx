import { useCallback, useMemo, type ReactNode } from 'react'

import {
  SearchableOverlayList,
  type Row,
  type Section,
} from '@/components/ui/searchable-overlay-list'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

type AutocompleteProps = {
  /** Current text in the input. Controlled. */
  value: string
  /**
   * Fires on every keystroke and on commit. On commit with
   * `casingNormalization: 'canonical'`, the value updates to the
   * canonical-cased source entry.
   */
  onValueChange: (value: string) => void
  /**
   * Fires when the user commits a value — picks a suggestion, presses Enter
   * on a match, or taps the tail-create row. The committed value has already
   * been case-normalized (per `casingNormalization`) and trimmed.
   */
  onCommit?: (value: string) => void
  /**
   * Suggestions source. Empty / absent → no suggestions; the dropdown shows
   * only the `+ Add new` row when the user has typed something.
   */
  sourceList?: readonly string[]
  /**
   * `'canonical'` (default) — exact case-insensitive match against a source
   * entry commits in the source's canonical case (`'reiwa'` against
   * `['Reiwa']` commits `Reiwa`). Use for curated source lists.
   *
   * `'as-typed'` — preserve the user's casing on commit. Use when the source
   * list is hint-only rather than canonical (e.g., tag lists where users may
   * intentionally re-case).
   */
  casingNormalization?: 'canonical' | 'as-typed'
  /** Customize the tail-create row label. Default: `+ Add new: "<typed>"`. */
  createTailLabel?: (typed: string) => string
  placeholder?: string
  label?: string
  disabled?: boolean
  /**
   * When provided alongside `disabled`, surfaces as the browser-native
   * `title` tooltip on web.
   */
  disabledReason?: string
  /** Marks the input invalid for ARIA + visual error styling. */
  'aria-invalid'?: boolean | 'true' | 'false'
  className?: string
}

type AutocompleteRowData = { label: string; commitValue: string; isTail: boolean }

function defaultTailLabel(typed: string): string {
  return `+ Add new: "${typed}"`
}

// Casing-aware commit normalization. `canonical` matches an existing source
// entry case-insensitively and returns the entry's canonical case;
// `as-typed` returns the trimmed input verbatim.
function normalizeCommit(
  raw: string,
  sourceList: readonly string[],
  mode: 'canonical' | 'as-typed',
): string | null {
  const t = raw.trim()
  if (!t) return null
  if (mode === 'canonical') {
    return sourceList.find((s) => s.toLowerCase() === t.toLowerCase()) ?? t
  }
  return t
}

function renderAutocompleteRow(row: Row<AutocompleteRowData>): ReactNode {
  return (
    <Text className={cn('text-sm', row.data.isTail ? 'text-fg-secondary' : 'text-fg-primary')}>
      {row.data.label}
    </Text>
  )
}

export function Autocomplete({
  value,
  onValueChange,
  onCommit,
  sourceList = [],
  casingNormalization = 'canonical',
  createTailLabel = defaultTailLabel,
  placeholder,
  label,
  disabled,
  disabledReason,
  'aria-invalid': ariaInvalid,
  className,
}: AutocompleteProps) {
  const sections = useMemo<Section<AutocompleteRowData>[]>(() => {
    const trimmed = value.trim()
    const lc = trimmed.toLowerCase()
    let suggestions: string[]
    if (sourceList.length === 0) {
      suggestions = []
    } else if (!trimmed) {
      suggestions = Array.from(sourceList)
    } else {
      suggestions = sourceList.filter((s) => s.toLowerCase().includes(lc))
    }
    const exactMatch = sourceList.find((s) => s.toLowerCase() === lc)
    const showTail = trimmed.length > 0 && !exactMatch
    const rows: Row<AutocompleteRowData>[] = suggestions.map((s) => ({
      id: s,
      data: { label: s, commitValue: s, isTail: false },
    }))
    if (showTail) {
      rows.push({
        id: '__tail__',
        data: { label: createTailLabel(trimmed), commitValue: trimmed, isTail: true },
      })
    }
    return [{ id: 'main', rows }]
  }, [value, sourceList, createTailLabel])

  const handleActivate = useCallback(
    (row: Row<AutocompleteRowData>) => {
      const final = normalizeCommit(row.data.commitValue, sourceList, casingNormalization)
      if (final == null) return
      if (final !== value) onValueChange(final)
      onCommit?.(final)
    },
    [sourceList, casingNormalization, value, onValueChange, onCommit],
  )

  return (
    <SearchableOverlayList<AutocompleteRowData>
      searchPlacement="as-trigger"
      valueLabel={value}
      sections={sections}
      onQueryChange={onValueChange}
      onActivate={handleActivate}
      onClear={() => onValueChange('')}
      searchPlaceholder={placeholder}
      ariaLabel={label ?? placeholder}
      disabled={disabled}
      disabledReason={disabledReason}
      aria-invalid={ariaInvalid}
      className={className}
      renderRow={renderAutocompleteRow}
    />
  )
}

export type { AutocompleteProps }
