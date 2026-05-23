import * as PopoverPrimitive from '@rn-primitives/popover'
import { Portal } from '@rn-primitives/portal'
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
  ScrollView,
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
  renderRow: (row: Row<T>, state: { highlighted: boolean }) => ReactNode
  renderEmpty?: (query: string) => ReactNode
  renderFooter?: () => ReactNode

  onActivate: (row: Row<T>) => void

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

const ROW_BASE = 'flex-row items-center active:bg-tint-press'
const ROW_DESKTOP = 'min-h-control-md px-row-x-md py-row-y-md'
const ROW_PHONE = 'min-h-control-lg px-row-x-md py-row-y-md'

const STATIC_STYLES = {
  flex1: { flex: 1 } as ViewStyle,
  overlayChrome: {
    maxHeight: 480,
    overflow: 'hidden' as const,
  } satisfies ViewStyle,
  pointerEventsNone: { pointerEvents: 'none' as const } satisfies ViewStyle,
}

function flattenEnabled<T>(sections: Section<T>[]): Row<T>[] {
  const out: Row<T>[] = []
  for (const s of sections) for (const r of s.rows) if (!r.disabled) out.push(r)
  return out
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

  // Auto-highlight rule: non-empty query auto-highlights the first non-disabled row;
  // empty query highlights nothing. Reapplied whenever query / sections change.
  useEffect(() => {
    if (!query) {
      setHighlightedId(null)
      return
    }
    if (enabledRows.length === 0) {
      setHighlightedId(null)
      return
    }
    if (highlightedId == null || !enabledRows.some((r) => r.id === highlightedId)) {
      setHighlightedId(enabledRows[0]!.id)
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
    setQueryState('')
    onQueryChange('')
    setHighlightedId(null)
  }, [onQueryChange])

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
  onActivate: (row: Row<T>) => void
  renderRow: (row: Row<T>, state: { highlighted: boolean }) => ReactNode
  renderEmpty?: (query: string) => ReactNode
  query: string
  variant: 'inline' | 'sheet'
  listboxId: string
  rowIdPrefix: string
  // When true, the consumer renders a sticky footer below the list — skip the
  // keyboard-height bottom padding (the footer already anchors against the keyboard,
  // doubling the padding produces a visible gap).
  hasFooter?: boolean
  className?: string
  style?: ViewStyle
}

const ROW_DIVIDER = <View className="mx-3 h-px bg-border" />

// Native side uses SectionList for free sticky headers when any section requests them.
function RowListNative<T>({
  sections,
  highlightedId,
  onActivate,
  renderRow,
  renderEmpty,
  query,
  variant,
  listboxId,
  rowIdPrefix,
  hasFooter,
  className,
  style,
}: RowListProps<T>) {
  // Sheet variant pads the scroll content by keyboard height so the last rows can
  // scroll above the keyboard. When the consumer renders a sticky footer, the footer
  // is already the bottom anchor and this padding double-counts (visible gap between
  // last item and keyboard) — skip in that case.
  const keyboardHeight = useKeyboardHeight()
  const applyKeyboardPad = variant === 'sheet' && keyboardHeight > 0 && !hasFooter
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
      contentContainerStyle={applyKeyboardPad ? { paddingBottom: keyboardHeight } : undefined}
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
        return (
          <Pressable
            nativeID={`${rowIdPrefix}-${item.id}`}
            role="button"
            aria-selected={highlighted}
            disabled={item.disabled}
            onPress={() => onActivate(item)}
            className={cn(
              ROW_BASE,
              rowClass,
              highlighted && 'bg-tint-hover',
              item.disabled && 'opacity-50',
            )}
          >
            {renderRow(item, { highlighted })}
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
  const rowClass = variant === 'sheet' ? ROW_PHONE : ROW_DESKTOP
  // `role="listbox"` is a web-only DOM attribute; RN's Role union doesn't include it.
  const webProps = { role: 'listbox' } as object
  return (
    <ScrollView {...webProps} className={className} style={style} nativeID={listboxId}>
      {sections.map((section) => (
        <View key={section.id}>
          {section.header != null ? (
            <View
              className={cn(
                'bg-bg-overlay px-row-x-md py-1',
                section.sticky && 'sticky top-0 z-10',
              )}
            >
              {typeof section.header === 'string' ? (
                <Text variant="muted" size="xs" className="uppercase tracking-wide">
                  {section.header}
                </Text>
              ) : (
                section.header
              )}
            </View>
          ) : null}
          {section.rows.map((row, rowIdx) => {
            const highlighted = row.id === highlightedId
            const isLastInSection = rowIdx === section.rows.length - 1
            return (
              <Pressable
                key={row.id}
                nativeID={`${rowIdPrefix}-${row.id}`}
                role="option"
                aria-selected={highlighted}
                disabled={row.disabled}
                onPress={() => onActivate(row)}
                className={cn(
                  ROW_BASE,
                  rowClass,
                  // Hairline divider under each row except the last in its section.
                  !isLastInSection && 'border-b border-border',
                  highlighted && 'bg-tint-hover',
                  row.disabled && 'opacity-50',
                )}
              >
                {renderRow(row, { highlighted })}
              </Pressable>
            )
          })}
        </View>
      ))}
    </ScrollView>
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
  autoFocus,
  listboxId,
  expanded = true,
  highlightedRowId,
  rowIdPrefix,
  ariaInvalid,
  className,
}: SearchInputProps) {
  const activeDescendant = highlightedRowId ? `${rowIdPrefix}-${highlightedRowId}` : undefined
  return (
    <Input
      value={query}
      onChangeText={onQueryChange}
      placeholder={placeholder}
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
      trailing={<ClearButton visible={query.length > 0} onPress={() => onQueryChange('')} />}
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
        onActivate={activate}
        renderRow={renderRow}
        renderEmpty={renderEmpty}
        query={list.query}
        variant={isPhone ? 'sheet' : 'inline'}
        listboxId={listboxId}
        rowIdPrefix={rowIdPrefix}
        hasFooter={renderFooter != null}
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
            {body}
          </SheetContent>
        </Sheet>
      </>
    )
  }

  // Desktop / tablet — rn-primitives Popover with the controlled-open bridge.
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
          className="z-50 w-80 rounded-md border border-border bg-bg-overlay p-4"
          style={STATIC_STYLES.overlayChrome}
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
    valueLabel,
    searchPlaceholder,
    renderRow,
    renderEmpty,
    renderFooter,
    disabled,
    disabledReason,
    'aria-invalid': ariaInvalid,
    ariaLabel,
    escClearsQueryFirst = false,
    className,
  } = props

  const list = useSearchableList(props)
  // Pull stable function refs out of `list` so downstream useCallbacks don't depend on the
  // whole-object reference (which is new every render) — preserves Input focus across renders.
  const { setQuery, resetOnOpen, moveHighlight, query: currentQuery, highlightedId } = list
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

  // Ref to the most recent valueLabel so deferred callbacks (blur timer, post-activate
  // microtask) sync to the value committed AFTER React flushes consumer state updates.
  const valueLabelRef = useRef(valueLabel)
  useEffect(() => {
    valueLabelRef.current = valueLabel
  }, [valueLabel])

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

  // Focus opens + seeds query from valueLabel (combobox idiom: the field shows the
  // committed value, editable). Blur deferred-closes so a Pressable row press can
  // register before the dropdown unmounts. Typing flows through onChangeText below —
  // we explicitly do NOT seed on every open transition because typing-triggered opens
  // would wipe the typed character.
  const handleFocus = useCallback(() => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current)
      blurTimerRef.current = null
    }
    if (disabled) return
    resetOnOpen()
    setOpen(true)
  }, [disabled, resetOnOpen])
  const handleBlur = useCallback(() => {
    blurTimerRef.current = setTimeout(() => {
      setOpen(false)
      // Combobox idiom: closed state shows the committed value, not the typed-discarded text.
      setQuery(valueLabelRef.current || '')
    }, 200)
  }, [setQuery])

  const activate = useCallback(
    (row: Row<T>) => {
      if (row.disabled) return
      setOpen(false)
      onActivate(row)
      // Enter-to-pick doesn't fire blur; defer one tick to let the consumer's state
      // update propagate (valueLabelRef refreshes), then sync the input to it.
      setTimeout(() => setQuery(valueLabelRef.current || ''), 0)
    },
    [onActivate, setQuery],
  )

  const onSubmit = useCallback(() => {
    if (highlightedId != null) {
      const found = findRowSection(sections, highlightedId)
      if (found && !found.row.disabled) activate(found.row)
    }
  }, [highlightedId, sections, activate])

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
      } else if (key === 'Escape') {
        e.preventDefault?.()
        if (escClearsQueryFirst && currentQuery.length > 0) setQuery('')
        else setOpen(false)
      }
    },
    [moveHighlight, currentQuery, setQuery, escClearsQueryFirst],
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
        placeholder={searchPlaceholder ?? valueLabel}
        showLeadingGlyph={false}
        onKeyPress={onKeyPress}
        onSubmitEditing={onSubmit}
        onFocus={handleFocus}
        onBlur={handleBlur}
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
            aria-label={ariaLabel ?? 'Suggestions'}
          >
            <RowList
              sections={sections}
              highlightedId={list.highlightedId}
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
