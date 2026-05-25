import { MoreVertical } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useState, type Ref } from 'react'
import { Platform, View } from 'react-native'

import { IconAction } from '@/components/ui/icon-action'
import {
  SearchableOverlayList,
  type Row,
  type Section,
  type TriggerProps,
} from '@/components/ui/searchable-overlay-list'
import { Text } from '@/components/ui/text'

type ActionEntry = {
  /** Stable id; unique across all entries the menu surfaces this render. */
  id: string
  /** Translated, user-facing label. Search filters case-insensitively on this. */
  label: string
  /**
   * When true, the entry renders dimmed and is skipped by keyboard nav. Pair
   * with `disabledReason` to surface a web title-tooltip explaining why.
   */
  disabled?: boolean
  disabledReason?: string
  /** Fired after the substrate closes the overlay. */
  onActivate: () => void
}

type ActionGroup = {
  /** Stable id; substrate `Section.id`. */
  id: string
  /** Translated header label rendered above the group. */
  header: string
  entries: ActionEntry[]
}

type ActionsMenuProps = {
  /**
   * The "ON THIS SCREEN" zone — at most one group. Omit (or pass an empty
   * `entries` array) to drop the zone entirely; spec is explicit: an empty
   * contextual zone hides its header rather than rendering an empty section.
   */
  contextual?: ActionGroup
  /**
   * Curated core groups in render order. Per the spec, off-story surfaces
   * pass only the `APP` group; in-story surfaces pass `GO TO`, `STORY TOOLS`,
   * `APP`. Capability-gated entries are absent from the array, not disabled —
   * the menu doesn't surface dead commands.
   */
  coreGroups: ActionGroup[]
  /** Translated placeholder for the search input. */
  searchPlaceholder?: string
  /** Translated empty-state label when search filters everything out. */
  emptyLabel?: string
  /** Translated `aria-label` for the trigger button. */
  triggerLabel?: string
  /**
   * When true, both the trigger and the `Cmd/Ctrl-K` shortcut are inert. Pass
   * this from the surface owner whenever a modal / AlertDialog / Sheet is
   * blocking — Sheet-over-Sheet is disallowed
   */
  blocked?: boolean
}

type MenuRowData = {
  label: string
  disabled?: boolean
  disabledReason?: string
  onActivate: () => void
}

const DEFAULT_SEARCH_PLACEHOLDER = 'Search actions…'
const DEFAULT_EMPTY_LABEL = 'No actions match.'
const DEFAULT_TRIGGER_LABEL = 'Actions'

// Mac vs Windows / Linux shortcut hint — same heuristic SaveBar uses for ⌘S.
// Native sees no shortcut at all (the menu opens via tap there).
function useShortcutHint(): string | null {
  return useMemo(() => {
    if (Platform.OS !== 'web') return null
    const ua = typeof navigator !== 'undefined' ? (navigator.userAgent ?? '') : ''
    return /Mac|iPhone|iPad|iPod/.test(ua) ? '⌘K' : 'Ctrl+K'
  }, [])
}

// Substring match on label; trimmed lowercase. Whole-token / fuzzy is
// out-of-scope for v1 — the spec wants case-insensitive substring only.
function entryMatchesQuery(label: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return label.toLowerCase().includes(q)
}

function MenuRow({ row }: { row: Row<MenuRowData> }) {
  const { label, disabled, disabledReason } = row.data
  // RN-Web's Pressable doesn't forward `title`; wrap on web so the
  // disabled-reason tooltip surfaces — same workaround IconAction uses.
  const labelNode = (
    <View className="w-full flex-row items-center">
      <Text size="sm" className={disabled ? 'text-fg-muted' : 'text-fg-primary'} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
  if (disabled && disabledReason && Platform.OS === 'web') {
    return <div title={disabledReason}>{labelNode}</div>
  }
  return labelNode
}

type ActionsTriggerOwnProps = {
  p: TriggerProps
  label: string
  shortcutHint: string | null
  disabled?: boolean
}

function ActionsTrigger({
  p,
  label,
  shortcutHint,
  disabled,
  ...slotProps
}: ActionsTriggerOwnProps) {
  const accessibleLabel = shortcutHint ? `${label} (${shortcutHint})` : label
  return (
    <IconAction
      ref={p.ref as Ref<View>}
      icon={MoreVertical}
      label={accessibleLabel}
      onPress={p.onPress}
      disabled={disabled}
      aria-haspopup={p['aria-haspopup']}
      aria-expanded={p['aria-expanded']}
      aria-controls={p['aria-controls']}
      {...slotProps}
    />
  )
}

function ActionsMenu({
  contextual,
  coreGroups,
  searchPlaceholder = DEFAULT_SEARCH_PLACEHOLDER,
  emptyLabel = DEFAULT_EMPTY_LABEL,
  triggerLabel = DEFAULT_TRIGGER_LABEL,
  blocked,
}: ActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const shortcutHint = useShortcutHint()

  useEffect(() => {
    if (Platform.OS !== 'web') return
    const handler = (e: KeyboardEvent) => {
      if (blocked) return
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key !== 'k' && e.key !== 'K') return
      e.preventDefault()
      e.stopPropagation()
      setOpen((prev) => !prev)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [blocked])

  const sections = useMemo<Section<MenuRowData>[]>(() => {
    const out: Section<MenuRowData>[] = []
    const collectGroup = (g: ActionGroup): Section<MenuRowData> | null => {
      const rows: Row<MenuRowData>[] = g.entries
        .filter((e) => entryMatchesQuery(e.label, query))
        .map((e) => ({
          id: e.id,
          disabled: e.disabled,
          data: {
            label: e.label,
            disabled: e.disabled,
            disabledReason: e.disabledReason,
            onActivate: e.onActivate,
          },
        }))
      if (rows.length === 0) return null
      return { id: g.id, header: g.header, rows }
    }
    if (contextual && contextual.entries.length > 0) {
      const s = collectGroup(contextual)
      if (s) out.push(s)
    }
    for (const g of coreGroups) {
      const s = collectGroup(g)
      if (s) out.push(s)
    }
    return out
  }, [contextual, coreGroups, query])

  const handleActivate = useCallback((row: Row<MenuRowData>) => {
    if (row.data.disabled) return
    row.data.onActivate()
  }, [])

  const renderRow = useCallback((row: Row<MenuRowData>) => <MenuRow row={row} />, [])

  const renderTrigger = useCallback(
    (p: TriggerProps) => (
      <ActionsTrigger p={p} label={triggerLabel} shortcutHint={shortcutHint} disabled={blocked} />
    ),
    [triggerLabel, shortcutHint, blocked],
  )

  const renderEmpty = useCallback(
    () => (
      <View className="items-center px-row-x-md py-6">
        <Text size="sm" variant="muted">
          {emptyLabel}
        </Text>
      </View>
    ),
    [emptyLabel],
  )

  return (
    <SearchableOverlayList<MenuRowData>
      searchPlacement="in-overlay"
      open={open}
      onOpenChange={setOpen}
      ariaLabel={triggerLabel}
      searchPlaceholder={searchPlaceholder}
      sections={sections}
      onQueryChange={setQuery}
      renderTrigger={renderTrigger}
      renderRow={renderRow}
      renderEmpty={renderEmpty}
      onActivate={handleActivate}
      autofocusSearch="except-phone"
      sheetSize="tall"
    />
  )
}

export { ActionsMenu }
export type { ActionEntry, ActionGroup, ActionsMenuProps }
