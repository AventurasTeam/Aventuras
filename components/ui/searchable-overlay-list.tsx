import * as PopoverPrimitive from '@rn-primitives/popover'
import { Portal } from '@rn-primitives/portal'
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual'
import { Search, X } from 'lucide-react-native'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from 'react'
import {
  Platform,
  Pressable,
  SectionList,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type ViewStyle,
} from 'react-native'

import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { useKeyboardHeight } from '@/hooks/use-keyboard-height'
import { useTier } from '@/hooks/use-tier'
import { cn } from '@/lib/utils'

type Row<T> = {
  id: string
  disabled?: boolean
  data: T
}

type Section<T> = {
  id: string
  header?: ReactNode
  sticky?: boolean
  rows: Row<T>[]
}

type TriggerProps = {
  ref: Ref<unknown>
  onPress: () => void
  open: boolean
  'aria-haspopup': 'dialog'
  'aria-expanded': boolean
  'aria-controls'?: string
}

type SearchableOverlayListProps<T> = {
  searchPlacement: 'as-trigger' | 'in-overlay'

  open?: boolean
  onOpenChange?: (open: boolean) => void

  searchPlaceholder?: string
  onQueryChange: (query: string) => void
  sections: Section<T>[]
  renderRow: (row: Row<T>, state: { highlighted: boolean; selected: boolean }) => ReactNode
  renderEmpty?: (query: string) => ReactNode
  renderFooter?: () => ReactNode

  // Marks rows that represent the consumer's committed value. The substrate
  // paints each with `bg-bg-sunken` (the convention shared with Select
  // customContent), so consumers don't re-implement the selected-row affordance.
  // Distinct from `highlighted` (transient keyboard cursor). When set,
  // `bg-tint-hover` is suppressed on selected rows so the selection signal
  // isn't muddled by hover. Array semantics let a single logical selection
  // surface in multiple sections — e.g. the picker tints the same model in
  // both the Favorites strip and its provider section.
  selectedRowIds?: readonly string[]

  // Web-only opt-in: the Shape 2 popover sizes to its trigger's width (with a
  // 240px floor so a narrow trigger doesn't crush content). Use for
  // select-shaped consumers where the open surface should read as the trigger
  // expanding. Leave off for command-menu consumers whose surface is dialog-
  // scaled regardless of trigger. No-op on phone (Sheet covers width on its own).
  matchTriggerWidth?: boolean

  onActivate: (row: Row<T>) => void
  // Optional consumer signal for the X clear button. In as-trigger mode this is the
  // "unset the committed value" gesture — wire to setPicked(null) or equivalent so
  // X clears both the input text and the consumer's selection.
  onClear?: () => void

  autofocusSearch?: 'always' | 'except-phone'
  escClearsQueryFirst?: boolean
  sheetSize?: 'short' | 'medium' | 'tall'

  renderTrigger?: (p: TriggerProps) => ReactNode

  valueLabel?: string
  disabled?: boolean
  disabledReason?: string
  'aria-invalid'?: boolean | 'true' | 'false'

  ariaLabel?: string
  ariaLabelledBy?: string
  className?: string
}

// w-full so the row Pressable spans its parent container — without it
// RN-Web's View defaults make the Pressable size to its content, leaving
// a flex-1 + trailing-aligned cell layout floating short of the right edge.
const ROW_BASE = 'w-full flex-row items-center active:bg-tint-press'
const ROW_DESKTOP = 'min-h-control-md px-row-x-md py-row-y-md'
const ROW_PHONE = 'min-h-control-lg px-row-x-md py-row-y-md'

const STATIC_STYLES = {
  flex1: { flex: 1 } as ViewStyle,
  overlayChrome: {
    maxHeight: 480,
    overflow: 'hidden' as const,
  } satisfies ViewStyle,
  // Radix exposes `--radix-popover-trigger-width` on Content; honor it as the
  // surface width with a 240px floor so a narrow trigger doesn't crush rows
  // (modelId + caps + ★ need a reasonable minimum). Web-only — native phones
  // route through Sheet which owns its own sizing.
  overlayChromeMatchTrigger: {
    maxHeight: 480,
    overflow: 'hidden' as const,
    width: 'var(--radix-popover-trigger-width)' as unknown as number,
    minWidth: 240,
  } satisfies ViewStyle,
  pointerEventsNone: { pointerEvents: 'none' as const } satisfies ViewStyle,
}

function flattenEnabled<T>(sections: Section<T>[]): Row<T>[] {
  const out: Row<T>[] = []
  for (const s of sections) for (const r of s.rows) if (!r.disabled) out.push(r)
  return out
}

// Memoize the array→Set conversion so the substrate's selected-row lookups stay O(1)
// per row without re-allocating each render. Consumers pass arrays (natural shape);
// the substrate works in Set space.
function useSelectedSet(ids: readonly string[] | undefined): ReadonlySet<string> | undefined {
  return useMemo(() => (ids ? new Set(ids) : undefined), [ids])
}

function findRowSection<T>(
  sections: Section<T>[],
  rowId: string,
): { row: Row<T>; sectionIdx: number; rowIdx: number } | null {
  for (let si = 0; si < sections.length; si++) {
    const rows = sections[si]!.rows
    for (let ri = 0; ri < rows.length; ri++) {
      if (rows[ri]!.id === rowId) return { row: rows[ri]!, sectionIdx: si, rowIdx: ri }
    }
  }
  return null
}

// Centralised query + highlight state shared across the two shapes.
function useSearchableList<T>(props: SearchableOverlayListProps<T>) {
  const { onQueryChange, sections, valueLabel, searchPlacement } = props

  const [query, setQueryState] = useState('')
  const setQuery = useCallback(
    (next: string) => {
      setQueryState(next)
      onQueryChange(next)
    },
    [onQueryChange],
  )

  const enabledRows = useMemo(() => flattenEnabled(sections), [sections])
  const [highlightedId, setHighlightedId] = useState<string | null>(null)

  // Auto-highlight rule: when the query changes, non-empty auto-highlights the first
  // non-disabled row; empty highlights nothing. We track the previous query so the
  // rule only fires on actual query transitions — without this, every other render
  // (e.g. after an ArrowDown manually set the highlight) would force-reset it to null
  // for empty queries and wipe the user's keyboard navigation.
  const prevQueryRef = useRef(query)
  useEffect(() => {
    const queryChanged = prevQueryRef.current !== query
    prevQueryRef.current = query
    if (queryChanged) {
      if (!query || enabledRows.length === 0) {
        setHighlightedId(null)
      } else {
        setHighlightedId(enabledRows[0]!.id)
      }
      return
    }
    // Sections changed (consumer filter, in-flight disable, etc.): validate the
    // current highlight still maps to an enabled row, else clear / re-anchor.
    if (highlightedId != null && !enabledRows.some((r) => r.id === highlightedId)) {
      setHighlightedId(enabledRows.length > 0 ? enabledRows[0]!.id : null)
    }
  }, [query, enabledRows, highlightedId])

  const moveHighlight = useCallback(
    (direction: 1 | -1) => {
      if (enabledRows.length === 0) return
      if (highlightedId == null) {
        setHighlightedId(
          direction === 1 ? enabledRows[0]!.id : enabledRows[enabledRows.length - 1]!.id,
        )
        return
      }
      const idx = enabledRows.findIndex((r) => r.id === highlightedId)
      const next = Math.min(Math.max(idx + direction, 0), enabledRows.length - 1)
      setHighlightedId(enabledRows[next]!.id)
    },
    [enabledRows, highlightedId],
  )

  const resetOnOpen = useCallback(() => {
    // in-overlay opens with an empty query; as-trigger seeds from valueLabel.
    const seed = searchPlacement === 'as-trigger' ? (valueLabel ?? '') : ''
    setQueryState(seed)
    onQueryChange(seed)
    setHighlightedId(null)
  }, [searchPlacement, valueLabel, onQueryChange])

  const resetOnClose = useCallback(() => {
    // Mirrors resetOnOpen: as-trigger combobox closes back to the committed value
    // (otherwise the consumer that wired onQueryChange→onValueChange would receive a
    // spurious '' that wipes the freshly-picked value — the mobile-only Autocomplete bug).
    // in-overlay (Picker / ActionsMenu) keeps the empty-on-close behavior since their
    // onQueryChange is a filter setter, separate from the committed value.
    const seed = searchPlacement === 'as-trigger' ? (valueLabel ?? '') : ''
    setQueryState(seed)
    onQueryChange(seed)
    setHighlightedId(null)
  }, [searchPlacement, valueLabel, onQueryChange])

  return {
    query,
    setQuery,
    enabledRows,
    highlightedId,
    setHighlightedId,
    moveHighlight,
    resetOnOpen,
    resetOnClose,
  }
}

// Controlled-open bridge for the rn-primitives Popover Root (which only emits onOpenChange).
function PopoverControlledBridge({ open: controlled }: { open?: boolean }) {
  const { open, onOpenChange } = PopoverPrimitive.useRootContext()
  useEffect(() => {
    if (controlled != null && controlled !== open) onOpenChange(controlled)
  }, [controlled, open, onOpenChange])
  return null
}

type RowListProps<T> = {
  sections: Section<T>[]
  highlightedId: string | null
  selectedRowIds?: ReadonlySet<string>
  onActivate: (row: Row<T>) => void
  renderRow: (row: Row<T>, state: { highlighted: boolean; selected: boolean }) => ReactNode
  renderEmpty?: (query: string) => ReactNode
  query: string
  variant: 'inline' | 'sheet'
  listboxId: string
  rowIdPrefix: string
  className?: string
  style?: ViewStyle
}

const ROW_DIVIDER = <View className="mx-3 h-px bg-border" />

// Sheet content wrapper that pads the bottom by keyboard height on Android — the Sheet
// primitive's RN built-in KeyboardAvoidingView only behaves correctly on iOS
// (`behavior='padding'`); on Android (behavior=undefined) nothing lifts, so the footer
// + last list rows end up behind the keyboard. Padding here lifts the whole body
// (SearchInput + list + footer) together on Android while iOS continues to rely on
// Sheet's KAV. No-op on web (useKeyboardHeight returns 0).
function SheetKeyboardWrapper({ children }: { children: ReactNode }) {
  const keyboardHeight = useKeyboardHeight()
  const pad = Platform.OS === 'android' ? keyboardHeight : 0
  // flex-1 is essential — without it the wrapper sizes to content, the RowList
  // inside has nothing to flex against, and the list renders 0-height (no rows visible).
  return (
    <View className="flex-1" style={paddingBottomStyle(pad)}>
      {children}
    </View>
  )
}

function paddingBottomStyle(value: number): ViewStyle {
  return { paddingBottom: value }
}

// Native side uses SectionList for free sticky headers when any section requests them.
function RowListNative<T>({
  sections,
  highlightedId,
  selectedRowIds,
  onActivate,
  renderRow,
  renderEmpty,
  query,
  variant,
  listboxId,
  rowIdPrefix,
  className,
  style,
}: RowListProps<T>) {
  // Keyboard avoidance is handled at the body level (SheetKeyboardWrapper, Android-only)
  // rather than via list contentContainerStyle padding — the body-wrapper lifts the
  // footer too, while list-level padding only helped the list itself.
  const isEmpty = sections.every((s) => s.rows.length === 0)
  if (isEmpty) {
    return (
      <View className={className} style={style}>
        {renderEmpty?.(query) ?? <DefaultEmpty query={query} />}
      </View>
    )
  }
  const anySticky = sections.some((s) => s.sticky)
  const rowClass = variant === 'sheet' ? ROW_PHONE : ROW_DESKTOP
  return (
    <SectionList
      sections={sections.map((s) => ({
        key: s.id,
        header: s.header,
        sticky: s.sticky,
        data: s.rows,
      }))}
      keyExtractor={(row) => row.id}
      stickySectionHeadersEnabled={anySticky}
      keyboardShouldPersistTaps="handled"
      className={className}
      style={style}
      ItemSeparatorComponent={variant === 'sheet' ? () => ROW_DIVIDER : undefined}
      nativeID={listboxId}
      accessibilityRole={Platform.OS === 'web' ? undefined : 'list'}
      renderSectionHeader={({ section }) =>
        section.header != null ? (
          <View className="bg-bg-overlay px-row-x-md py-1">
            {typeof section.header === 'string' ? (
              <Text variant="muted" size="xs" className="uppercase tracking-wide">
                {section.header}
              </Text>
            ) : (
              section.header
            )}
          </View>
        ) : null
      }
      renderItem={({ item }) => {
        const highlighted = item.id === highlightedId
        const selected = selectedRowIds?.has(item.id) ?? false
        return (
          <Pressable
            nativeID={`${rowIdPrefix}-${item.id}`}
            role="button"
            // aria-selected on web reflects committed selection; on native the
            // primitive maps to accessibilityState.selected. Highlight is the
            // keyboard cursor and is conveyed via aria-activedescendant from
            // the search input — keeping it off this attribute avoids
            // duplicating the cue.
            aria-selected={selected || (selectedRowIds == null && highlighted)}
            disabled={item.disabled}
            onPress={() => onActivate(item)}
            className={cn(
              ROW_BASE,
              rowClass,
              selected && 'bg-bg-sunken',
              highlighted && !selected && 'bg-tint-hover',
              item.disabled && 'opacity-50',
            )}
          >
            {renderRow(item, { highlighted, selected })}
          </Pressable>
        )
      }}
    />
  )
}

// Web side renders a plain scroll container; sticky headers via CSS position: sticky.
function RowListWeb<T>({
  sections,
  highlightedId,
  selectedRowIds,
  onActivate,
  renderRow,
  renderEmpty,
  query,
  variant,
  listboxId,
  rowIdPrefix,
  className,
  style,
}: RowListProps<T>) {
  const isEmpty = sections.every((s) => s.rows.length === 0)
  if (isEmpty) {
    return (
      <div className={className} style={style as CSSProperties}>
        {renderEmpty?.(query) ?? <DefaultEmpty query={query} />}
      </div>
    )
  }
  return (
    <VirtualizedRowList<T>
      sections={sections}
      highlightedId={highlightedId}
      selectedRowIds={selectedRowIds}
      onActivate={onActivate}
      renderRow={renderRow}
      variant={variant}
      listboxId={listboxId}
      rowIdPrefix={rowIdPrefix}
      className={className}
      style={style}
    />
  )
}

// Flat-index virtualization model: sections + rows expand into one array of
// `{kind: 'header' | 'row', ...}` items, each occupying one virtual slot. Sticky-marked
// section headers stay in the virtual range via `rangeExtractor` (per @tanstack/react-virtual's
// sticky pattern) and render with `position: sticky` instead of the usual absolute
// + transform. This is the web equivalent of native SectionList's stickySectionHeadersEnabled.
type FlatItem<T> =
  | { kind: 'header'; sectionId: string; header: ReactNode; sticky: boolean }
  | { kind: 'row'; sectionId: string; row: Row<T>; isLastInSection: boolean }

function flattenForVirtualizer<T>(sections: Section<T>[]): FlatItem<T>[] {
  const items: FlatItem<T>[] = []
  for (const section of sections) {
    if (section.header != null) {
      items.push({
        kind: 'header',
        sectionId: section.id,
        header: section.header,
        sticky: !!section.sticky,
      })
    }
    section.rows.forEach((row, idx) => {
      items.push({
        kind: 'row',
        sectionId: section.id,
        row,
        isLastInSection: idx === section.rows.length - 1,
      })
    })
  }
  return items
}

const STICKY_HEADER_STYLE: CSSProperties = {
  position: 'sticky',
  top: 0,
  left: 0,
  zIndex: 1,
  width: '100%',
}

function translateRowStyle(y: number): CSSProperties {
  return {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    transform: `translateY(${y}px)`,
  }
}

function virtualTrackStyle(totalSize: number): CSSProperties {
  return { position: 'relative', width: '100%', height: totalSize }
}

type VirtualizedRowListProps<T> = {
  sections: Section<T>[]
  highlightedId: string | null
  selectedRowIds?: ReadonlySet<string>
  onActivate: (row: Row<T>) => void
  renderRow: (row: Row<T>, state: { highlighted: boolean; selected: boolean }) => ReactNode
  variant: 'inline' | 'sheet'
  listboxId: string
  rowIdPrefix: string
  className?: string
  style?: ViewStyle
}

function VirtualizedRowList<T>({
  sections,
  highlightedId,
  selectedRowIds,
  onActivate,
  renderRow,
  variant,
  listboxId,
  rowIdPrefix,
  className,
  style,
}: VirtualizedRowListProps<T>) {
  const items = useMemo(() => flattenForVirtualizer(sections), [sections])
  const parentRef = useRef<HTMLDivElement>(null)

  const stickyIndexes = useMemo(
    () => items.flatMap((it, i) => (it.kind === 'header' && it.sticky ? [i] : [])),
    [items],
  )
  const activeStickyIndexRef = useRef(-1)

  const rangeExtractor = useCallback(
    (range: Range) => {
      activeStickyIndexRef.current =
        [...stickyIndexes].reverse().find((i) => range.startIndex >= i) ?? -1
      const indexes = new Set(defaultRangeExtractor(range))
      if (activeStickyIndexRef.current >= 0) indexes.add(activeStickyIndexRef.current)
      return [...indexes].sort((a, b) => a - b)
    },
    [stickyIndexes],
  )

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 8,
    rangeExtractor,
  })

  // Keep the keyboard-highlighted row inside the viewport while the user arrows
  // through long lists. `align: 'auto'` only scrolls when out of view.
  useEffect(() => {
    if (highlightedId == null) return
    const idx = items.findIndex((it) => it.kind === 'row' && it.row.id === highlightedId)
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'auto' })
  }, [highlightedId, items, virtualizer])

  const rowClass = variant === 'sheet' ? ROW_PHONE : ROW_DESKTOP
  const webProps = { role: 'listbox' } as object
  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div
      ref={parentRef}
      id={listboxId}
      className={cn('overflow-y-auto', className)}
      style={style as CSSProperties}
      {...webProps}
    >
      <div style={virtualTrackStyle(virtualizer.getTotalSize())}>
        {virtualItems.map((virtualRow) => {
          const item = items[virtualRow.index]!
          const isSticky = item.kind === 'header' && item.sticky
          const isActiveSticky = isSticky && activeStickyIndexRef.current === virtualRow.index
          const wrapperStyle = isActiveSticky
            ? STICKY_HEADER_STYLE
            : translateRowStyle(virtualRow.start)

          if (item.kind === 'header') {
            return (
              <div
                key={virtualRow.key}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                style={wrapperStyle}
              >
                <View className="bg-bg-overlay px-row-x-md py-1">
                  {typeof item.header === 'string' ? (
                    <Text variant="muted" size="xs" className="uppercase tracking-wide">
                      {item.header}
                    </Text>
                  ) : (
                    item.header
                  )}
                </View>
              </div>
            )
          }

          const row = item.row
          const highlighted = row.id === highlightedId
          const selected = selectedRowIds?.has(row.id) ?? false
          return (
            <div
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={wrapperStyle}
            >
              <Pressable
                nativeID={`${rowIdPrefix}-${row.id}`}
                role="option"
                aria-selected={selected || (selectedRowIds == null && highlighted)}
                disabled={row.disabled}
                onPress={() => onActivate(row)}
                className={cn(
                  ROW_BASE,
                  rowClass,
                  !item.isLastInSection && 'border-b border-border',
                  selected && 'bg-bg-sunken',
                  highlighted && !selected && 'bg-tint-hover',
                  row.disabled && 'opacity-50',
                )}
              >
                {renderRow(row, { highlighted, selected })}
              </Pressable>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RowList<T>(props: RowListProps<T>) {
  return Platform.OS === 'web' ? <RowListWeb {...props} /> : <RowListNative {...props} />
}

function DefaultEmpty({ query }: { query: string }) {
  return (
    <View className="items-center px-row-x-md py-6">
      <Text variant="muted" size="sm">
        {query ? `No matches for "${query}".` : 'No items.'}
      </Text>
    </View>
  )
}

type SearchInputProps = {
  query: string
  onQueryChange: (q: string) => void
  placeholder?: string
  showLeadingGlyph: boolean
  onKeyPress?: ComponentProps<typeof Input>['onKeyPress']
  onSubmitEditing?: ComponentProps<typeof Input>['onSubmitEditing']
  onFocus?: ComponentProps<typeof Input>['onFocus']
  onBlur?: ComponentProps<typeof Input>['onBlur']
  // Override for the X clear button. When provided, X press calls this instead of
  // clearing the query directly — lets Shape 1 bundle close-popover + onClear-signal.
  onClear?: () => void
  disabled?: boolean
  autoFocus?: boolean
  // Only set when the listbox is actually mounted in the DOM — aria-controls
  // referencing a missing id is an a11y violation.
  listboxId?: string
  // Defaults true (Shape 2: input only renders while dialog is open). Shape 1
  // (always-rendered combobox input) passes the live open state.
  expanded?: boolean
  highlightedRowId?: string
  rowIdPrefix: string
  ariaInvalid?: boolean | 'true' | 'false'
  className?: string
}

// Always-rendered clear button with visibility-only toggle. The Input primitive
// switches its internal DOM shape (bare TextInput vs wrapped) based on whether
// trailing is present — conditionally rendering this would re-key the TextInput on
// first keystroke and silently lose focus mid-type. Mirrors shipped Autocomplete.
function ClearButton({ visible, onPress }: { visible: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!visible}
      hitSlop={8}
      accessibilityRole="button"
      aria-label="Clear search"
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      className={cn('p-1 active:opacity-70', !visible && 'opacity-0')}
    >
      <Icon as={X} size="sm" className="text-fg-muted" />
    </Pressable>
  )
}

function SearchInput({
  query,
  onQueryChange,
  placeholder,
  showLeadingGlyph,
  onKeyPress,
  onSubmitEditing,
  onFocus,
  onBlur,
  onClear,
  disabled,
  autoFocus,
  listboxId,
  expanded = true,
  highlightedRowId,
  rowIdPrefix,
  ariaInvalid,
  className,
}: SearchInputProps) {
  // aria-activedescendant must reference a DOM-mounted element — the listbox only
  // exists while open, so gate on listboxId presence (the parent passes it only when open).
  const activeDescendant =
    listboxId != null && highlightedRowId ? `${rowIdPrefix}-${highlightedRowId}` : undefined
  return (
    <Input
      value={query}
      onChangeText={onQueryChange}
      placeholder={placeholder}
      editable={!disabled}
      autoFocus={autoFocus}
      autoCorrect={false}
      autoCapitalize="none"
      onKeyPress={onKeyPress}
      onSubmitEditing={onSubmitEditing}
      onFocus={onFocus}
      onBlur={onBlur}
      aria-invalid={ariaInvalid}
      role="combobox"
      aria-expanded={expanded}
      aria-autocomplete="list"
      aria-controls={listboxId}
      aria-activedescendant={activeDescendant}
      leading={
        showLeadingGlyph ? <Icon as={Search} size="sm" className="text-fg-muted" /> : undefined
      }
      // Always-rendered ClearButton, visibility-toggled. The Input primitive switches
      // its underlying DOM shape (bare TextInput vs wrapped) based on whether trailing
      // is present — conditionally rendering it would re-key the TextInput on first
      // keystroke and silently lose focus mid-type. Same pattern shipped Autocomplete uses.
      trailing={
        <ClearButton visible={query.length > 0} onPress={onClear ?? (() => onQueryChange(''))} />
      }
      className={className}
    />
  )
}

// Shape 2 — dialog wrapping a combobox + listbox. Phone uses Sheet, non-phone uses
// rn-primitives Popover with a portaled dialog. Both render role="dialog" with a
// pinned search input, a results region, and an optional sticky footer.
function Shape2Dialog<T>(props: SearchableOverlayListProps<T>) {
  const tier = useTier()
  const isPhone = tier === 'phone'
  const {
    open: controlledOpen,
    onOpenChange,
    sections,
    renderTrigger,
    renderRow,
    renderEmpty,
    renderFooter,
    onActivate,
    searchPlaceholder,
    autofocusSearch = 'always',
    escClearsQueryFirst = false,
    sheetSize = 'tall',
    ariaLabel,
    ariaLabelledBy,
    'aria-invalid': ariaInvalid,
    searchPlacement,
  } = props

  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen != null
  const open = isControlled ? controlledOpen : internalOpen

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange],
  )

  const list = useSearchableList(props)
  const selectedRowIdsSet = useSelectedSet(props.selectedRowIds)

  // Reset query state on each open / close transition.
  const wasOpenRef = useRef(open)
  useEffect(() => {
    if (open && !wasOpenRef.current) list.resetOnOpen()
    if (!open && wasOpenRef.current) list.resetOnClose()
    wasOpenRef.current = open
  }, [open, list])

  const listboxId = useId()
  const rowIdPrefix = useId()
  const triggerRef = useRef<unknown>(null)

  const shouldAutofocus =
    autofocusSearch === 'always' || (autofocusSearch === 'except-phone' && !isPhone)

  const activate = useCallback(
    (row: Row<T>) => {
      if (row.disabled) return
      // Close-before-act: substrate dismisses, then the consumer commits.
      setOpen(false)
      onActivate(row)
    },
    [setOpen, onActivate],
  )

  const onSubmit = useCallback(() => {
    if (list.highlightedId == null) return
    const found = findRowSection(sections, list.highlightedId)
    if (found && !found.row.disabled) activate(found.row)
  }, [list.highlightedId, sections, activate])

  const onKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (Platform.OS !== 'web') return
      const key = e.nativeEvent.key
      if (key === 'ArrowDown') {
        e.preventDefault?.()
        list.moveHighlight(1)
      } else if (key === 'ArrowUp') {
        e.preventDefault?.()
        list.moveHighlight(-1)
      } else if (key === 'Escape') {
        e.preventDefault?.()
        if (escClearsQueryFirst && list.query.length > 0) list.setQuery('')
        else setOpen(false)
      }
    },
    [list, escClearsQueryFirst, setOpen],
  )

  const triggerProps: TriggerProps = useMemo(
    () => ({
      ref: triggerRef,
      onPress: () => setOpen(!open),
      open,
      'aria-haspopup': 'dialog',
      'aria-expanded': open,
      'aria-controls': open ? listboxId : undefined,
    }),
    [open, setOpen, listboxId],
  )

  const trigger = useMemo(() => {
    if (searchPlacement === 'in-overlay') {
      return renderTrigger?.(triggerProps) ?? null
    }
    // as-trigger on phone: substrate-rendered field-shaped tap-proxy.
    return (
      <Pressable
        ref={triggerRef as Ref<View>}
        onPress={triggerProps.onPress}
        disabled={props.disabled}
        accessibilityRole="button"
        aria-label={ariaLabel ?? 'Open picker'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={triggerProps['aria-controls']}
        className={cn(
          // min-w-32 keeps the tap-proxy visible at sensible width even when valueLabel
          // is empty — consumers can override via the wrapping FormRow / flex parent.
          'h-control-md min-w-32 flex-row items-center justify-start rounded-md border border-border bg-bg-base px-3',
          props.disabled && 'opacity-50',
          ariaInvalid && 'border-danger',
        )}
      >
        <Text
          className={cn('text-sm', props.valueLabel ? 'text-fg-primary' : 'text-fg-muted')}
          numberOfLines={1}
        >
          {props.valueLabel || props.searchPlaceholder || ''}
        </Text>
      </Pressable>
    )
  }, [
    searchPlacement,
    renderTrigger,
    triggerProps,
    ariaLabel,
    ariaInvalid,
    props.disabled,
    props.valueLabel,
    props.searchPlaceholder,
    open,
  ])

  const body = (
    <>
      <SearchInput
        query={list.query}
        onQueryChange={list.setQuery}
        placeholder={searchPlaceholder}
        showLeadingGlyph
        onKeyPress={onKeyPress}
        onSubmitEditing={onSubmit}
        autoFocus={shouldAutofocus}
        listboxId={listboxId}
        highlightedRowId={list.highlightedId ?? undefined}
        rowIdPrefix={rowIdPrefix}
        ariaInvalid={ariaInvalid}
        className="mb-3"
      />
      <RowList
        sections={sections}
        highlightedId={list.highlightedId}
        selectedRowIds={selectedRowIdsSet}
        onActivate={activate}
        renderRow={renderRow}
        renderEmpty={renderEmpty}
        query={list.query}
        variant={isPhone ? 'sheet' : 'inline'}
        listboxId={listboxId}
        rowIdPrefix={rowIdPrefix}
        // Sheet has p-6 outer padding — bleed rows full-width via -mx-6 so dividers /
        // tint hover reach the sheet edge. Popover has p-4 + lighter row chrome, so no
        // bleed (rows respect the container padding; text aligns with the search field).
        className={cn(isPhone ? '-mx-6' : '', 'flex-1')}
        style={STATIC_STYLES.flex1}
      />
      {renderFooter ? (
        <View className="mt-3 border-t border-border pt-3">{renderFooter()}</View>
      ) : null}
    </>
  )

  if (isPhone) {
    return (
      <>
        {trigger}
        <Sheet
          open={open}
          onOpenChange={setOpen}
          ariaLabel={ariaLabel}
          ariaLabelledBy={ariaLabelledBy}
        >
          <SheetContent anchor="bottom" size={sheetSize}>
            <SheetKeyboardWrapper>{body}</SheetKeyboardWrapper>
          </SheetContent>
        </Sheet>
      </>
    )
  }

  // Desktop / tablet — rn-primitives Popover with the controlled-open bridge.
  // Width: `matchTriggerWidth` swaps `w-80` for the Radix trigger-width CSS var;
  // otherwise the popover is a fixed 320px (command-menu-shaped surfaces).
  const popoverStyle = props.matchTriggerWidth
    ? STATIC_STYLES.overlayChromeMatchTrigger
    : STATIC_STYLES.overlayChrome
  return (
    <PopoverPrimitive.Root onOpenChange={setOpen}>
      <PopoverControlledBridge open={open} />
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          role="dialog"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          className={cn(
            'z-50 rounded-md border border-border bg-bg-overlay p-4',
            !props.matchTriggerWidth && 'w-80',
          )}
          style={popoverStyle}
        >
          {body}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

// Shape 1 — inline combobox with a portaled listbox popup. as-trigger on non-phone.
function Shape1Inline<T>(props: SearchableOverlayListProps<T>) {
  const {
    sections,
    onActivate,
    onClear,
    valueLabel,
    searchPlaceholder,
    renderRow,
    renderEmpty,
    renderFooter,
    disabled,
    disabledReason,
    'aria-invalid': ariaInvalid,
    escClearsQueryFirst = false,
    className,
  } = props

  const list = useSearchableList(props)
  const selectedRowIdsSet = useSelectedSet(props.selectedRowIds)
  // Pull stable function refs out of `list` so downstream useCallbacks don't depend on the
  // whole-object reference (which is new every render) — preserves Input focus across renders.
  const { setQuery, moveHighlight, query: currentQuery, highlightedId } = list
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<View>(null)
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const portalName = useId()
  const listboxId = useId()
  const rowIdPrefix = useId()
  const [anchorRect, setAnchorRect] = useState<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)

  useEffect(
    () => () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
    },
    [],
  )

  const updateAnchor = useCallback(() => {
    const node = wrapperRef.current
    if (!node) return
    node.measureInWindow((x, y, width, height) => setAnchorRect({ x, y, width, height }))
  }, [])

  useEffect(() => {
    if (!open || Platform.OS !== 'web') return undefined
    updateAnchor()
    const handler = () => updateAnchor()
    window.addEventListener('scroll', handler, true)
    window.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('scroll', handler, true)
      window.removeEventListener('resize', handler)
    }
  }, [open, updateAnchor])

  // Combobox sync model: the input value tracks query (substrate state); query is
  // updated by (a) user typing / clearing — preserved across focus cycles — and (b) an
  // EXTERNAL commit, when the consumer's valueLabel changes from a pick. The earlier
  // "reset to valueLabel on blur" actively undid the user's edits when they backspaced
  // and clicked away; preserving typed text is the standard combobox UX.
  useEffect(() => {
    // Intentionally only watching valueLabel: typing / clearing updates query directly
    // via setQuery and must not re-trigger this sync. setQuery itself is stable (useCallback
    // with [onQueryChange] which is the consumer's stable setter).
    setQuery(valueLabel ?? '')
  }, [valueLabel, setQuery])

  const handleFocus = useCallback(() => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current)
      blurTimerRef.current = null
    }
    if (disabled) return
    setOpen(true)
  }, [disabled])
  const handleBlur = useCallback(() => {
    // Deferred close so a Pressable row press can register before the dropdown unmounts.
    blurTimerRef.current = setTimeout(() => setOpen(false), 200)
  }, [])

  // X (the input's clear button) — combobox-clear gesture. Sets query to empty AND closes
  // the popover AND signals the consumer to unset the committed value. The setTimeout(0)
  // is defensive: RN-Web clicks inside the input wrapper can re-focus the input which
  // triggers handleFocus → setOpen(true); deferring an extra setOpen(false) to the next
  // microtask reliably overrides any focus-induced re-open.
  const handleClearText = useCallback(() => {
    setQuery('')
    setOpen(false)
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current)
      blurTimerRef.current = null
    }
    setTimeout(() => setOpen(false), 0)
    onClear?.()
  }, [setQuery, onClear])

  const activate = useCallback(
    (row: Row<T>) => {
      if (row.disabled) return
      setOpen(false)
      onActivate(row)
      // Input sync happens via the valueLabel useEffect once the consumer's state propagates —
      // works for both click-pick (after the blur timer's setOpen no-op) and Enter-pick.
    },
    [onActivate],
  )

  // Ref-stable highlight + sections snapshot so the keyboard handlers always see the
  // latest values even when RN-Web caches the handler reference. Assignment happens
  // during render (not in a useEffect) so the refs are synchronously current the moment
  // the next event fires — the useEffect-update lag was failing the empty-Enter test
  // because userEvent.keyboard dispatches Enter before the post-ArrowDown effect commits.
  const highlightedIdRef = useRef(highlightedId)
  const sectionsRef = useRef(sections)
  highlightedIdRef.current = highlightedId
  sectionsRef.current = sections

  const onSubmit = useCallback(() => {
    const id = highlightedIdRef.current
    if (id == null) return
    const found = findRowSection(sectionsRef.current, id)
    if (found && !found.row.disabled) activate(found.row)
  }, [activate])

  const onKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (Platform.OS !== 'web') return
      const key = e.nativeEvent.key
      if (key === 'ArrowDown') {
        e.preventDefault?.()
        setOpen(true)
        moveHighlight(1)
      } else if (key === 'ArrowUp') {
        e.preventDefault?.()
        setOpen(true)
        moveHighlight(-1)
      } else if (key === 'Enter') {
        // Enter handled here too — onSubmitEditing isn't always reliable on web
        // (caches handler refs; some envs don't fire it for empty inputs).
        e.preventDefault?.()
        onSubmit()
      } else if (key === 'Escape') {
        e.preventDefault?.()
        if (escClearsQueryFirst && currentQuery.length > 0) setQuery('')
        else setOpen(false)
      }
    },
    [moveHighlight, currentQuery, setQuery, escClearsQueryFirst, onSubmit],
  )

  const popoverStyle: ViewStyle | undefined =
    anchorRect != null
      ? {
          position: 'absolute',
          top: anchorRect.y + anchorRect.height + 4,
          left: anchorRect.x,
          width: anchorRect.width,
          zIndex: 50,
          maxHeight: 320,
        }
      : undefined

  const wrapper = (
    <View
      ref={wrapperRef}
      className={cn('relative', className)}
      onLayout={updateAnchor}
      style={disabled ? STATIC_STYLES.pointerEventsNone : undefined}
    >
      <SearchInput
        query={list.query}
        onQueryChange={(v) => {
          list.setQuery(v)
          if (!disabled) setOpen(true)
        }}
        onClear={handleClearText}
        placeholder={searchPlaceholder ?? valueLabel}
        showLeadingGlyph={false}
        onKeyPress={onKeyPress}
        onSubmitEditing={onSubmit}
        onFocus={handleFocus}
        onBlur={handleBlur}
        disabled={disabled}
        // Listbox only exists in DOM while open; pass id (and expanded=true) only then.
        listboxId={open ? listboxId : undefined}
        expanded={open}
        highlightedRowId={list.highlightedId ?? undefined}
        rowIdPrefix={rowIdPrefix}
        ariaInvalid={ariaInvalid}
      />
      {open && popoverStyle ? (
        <Portal name={portalName}>
          <View
            style={popoverStyle}
            className="overflow-hidden rounded-md border border-border bg-bg-overlay py-1"
          >
            <RowList
              sections={sections}
              highlightedId={list.highlightedId}
              selectedRowIds={selectedRowIdsSet}
              onActivate={activate}
              renderRow={renderRow}
              renderEmpty={renderEmpty}
              query={list.query}
              variant="inline"
              listboxId={listboxId}
              rowIdPrefix={rowIdPrefix}
              style={STATIC_STYLES.flex1}
            />
            {renderFooter ? (
              <View className="border-t border-border px-3 py-2">{renderFooter()}</View>
            ) : null}
          </View>
        </Portal>
      ) : null}
    </View>
  )

  // RN-Web's TextInput allowlist drops `title`; wrap in a raw div for the disabled-tooltip on web.
  if (disabled && disabledReason && Platform.OS === 'web') {
    return <div title={disabledReason}>{wrapper}</div>
  }

  return wrapper
}

function SearchableOverlayList<T>(props: SearchableOverlayListProps<T>) {
  const tier = useTier()
  const isPhone = tier === 'phone'
  const useInline = props.searchPlacement === 'as-trigger' && (Platform.OS === 'web' || !isPhone)

  if (useInline) return <Shape1Inline {...props} />
  return <Shape2Dialog {...props} />
}

export { SearchableOverlayList }
export type { Row, Section, SearchableOverlayListProps, TriggerProps }
