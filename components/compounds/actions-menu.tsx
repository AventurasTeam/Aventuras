import { MoreVertical } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react'
import { Platform, View } from 'react-native'

import { IconAction, type IconActionSize } from '@/components/ui/icon-action'
import {
  SearchableOverlayList,
  type Row,
  type Section,
  type TriggerProps,
} from '@/components/ui/searchable-overlay-list'
import { Text } from '@/components/ui/text'
import { useGlobalHotkey } from '@/hooks/use-global-hotkey'
import { t } from '@/lib/i18n'
import { blockingOverlaysStore } from '@/lib/stores'

import { isActionsMenuInert } from './actions-menu-logic'
import { ActionsMenuRow, type ActionsMenuRowData } from './actions-menu-row'

type ActionEntry = {
  /** Stable id; unique across all entries the menu surfaces this render. */
  id: string
  /** Translated, user-facing label. Search filters case-insensitively on this. */
  label: string
  /**
   * When true, the entry renders dimmed and is skipped by keyboard nav. Pair
   * with `disabledReason` to explain why: a tooltip on web, a line under it on native.
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
  /** Trigger IconAction size. Defaults to `md`; chrome bars pass `lg`. */
  triggerSize?: IconActionSize
  /**
   * When true, both the trigger and the `Cmd/Ctrl-K` shortcut are inert. Pass
   * this while the surface is mid-decision — a confirm the user must answer
   * before navigating away. Open sheets already gate themselves; this is the
   * judgment half, which nothing can derive.
   */
  blocked?: boolean
  /**
   * The owning screen's focus state. A pushed-under expo-router screen stays
   * mounted, so without this its Cmd/Ctrl-K keeps firing from behind the
   * screen on top. Gates only the shortcut; `blocked` is what makes the
   * trigger inert too.
   */
  hotkeyEnabled?: boolean
  /**
   * Each time the menu opens or closes, from the trigger or the shortcut: a surface can resolve
   * an entry's label as the menu opens.
   */
  onOpenChange?: (open: boolean) => void
}

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

type ActionsTriggerOwnProps = {
  p: TriggerProps
  label: string
  shortcutHint: string | null
  disabled?: boolean
  size?: IconActionSize
}

function ActionsTrigger({
  p,
  label,
  shortcutHint,
  disabled,
  size,
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
      size={size}
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
  searchPlaceholder = t('chrome.actionsSearch'),
  emptyLabel = t('chrome.actionsNoMatch'),
  triggerLabel = t('chrome.actions'),
  triggerSize,
  blocked,
  hotkeyEnabled = true,
  onOpenChange,
}: ActionsMenuProps) {
  const [open, setOpen] = useState(false)
  const onOpenChangeRef = useRef(onOpenChange)
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  })
  useEffect(() => {
    onOpenChangeRef.current?.(open)
  }, [open])
  const [query, setQuery] = useState('')
  const shortcutHint = useShortcutHint()

  const matchesMenuShortcut = useCallback(
    (e: KeyboardEvent) => (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K'),
    [],
  )
  const overlayCount = blockingOverlaysStore.useBlockingOverlayCount()
  const inert = isActionsMenuInert(blocked, overlayCount)

  const toggleOpen = useCallback(() => setOpen((prev) => !prev), [])
  // Both off-reasons live here, not split with the matcher, so a third has one place to go.
  useGlobalHotkey(matchesMenuShortcut, toggleOpen, {
    capture: true,
    stopPropagation: true,
    enabled: hotkeyEnabled && !inert,
  })

  const sections = useMemo<Section<ActionsMenuRowData>[]>(() => {
    const out: Section<ActionsMenuRowData>[] = []
    const collectGroup = (g: ActionGroup): Section<ActionsMenuRowData> | null => {
      const rows: Row<ActionsMenuRowData>[] = g.entries
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

  const handleActivate = useCallback((row: Row<ActionsMenuRowData>) => {
    if (row.data.disabled) return
    row.data.onActivate()
  }, [])

  const renderRow = useCallback((row: Row<ActionsMenuRowData>) => <ActionsMenuRow row={row} />, [])

  const renderTrigger = useCallback(
    (p: TriggerProps) => (
      <ActionsTrigger
        p={p}
        label={triggerLabel}
        shortcutHint={shortcutHint}
        disabled={inert}
        size={triggerSize}
      />
    ),
    [triggerLabel, shortcutHint, inert, triggerSize],
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
    <SearchableOverlayList<ActionsMenuRowData>
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
      autofocusSearch="web-only"
      sheetSize="tall"
      suppressOverlayRegistration
    />
  )
}

export { ActionsMenu }
export type { ActionEntry, ActionGroup, ActionsMenuProps }
