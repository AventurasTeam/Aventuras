import { X } from 'lucide-react-native'
import * as React from 'react'
import {
  Platform,
  Pressable,
  ScrollView,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native'

import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { useKeyboardHeight } from '@/hooks/use-keyboard-height'
import { useTier } from '@/hooks/use-tier'
import { cn } from '@/lib/utils'
import { Portal } from '@rn-primitives/portal'

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
   * Fires when the user commits a value — picks a suggestion,
   * presses Enter on a match, or taps the tail-create row. The
   * committed value has already been case-normalized (per
   * `casingNormalization`) and trimmed.
   */
  onCommit?: (value: string) => void
  /**
   * Suggestions source. Empty / absent → no suggestions; the
   * dropdown shows only the `+ Add new` row when the user has
   * typed something. Component degrades cleanly to free-form
   * input.
   */
  sourceList?: readonly string[]
  /**
   * `'canonical'` (default) — exact case-insensitive match against
   * a source entry commits in the source's canonical case
   * (`'reiwa'` against `['Reiwa']` commits `Reiwa`). Use for
   * curated source lists.
   *
   * `'as-typed'` — preserve the user's casing on commit. Use when
   * the source list is hint-only rather than canonical (e.g., tag
   * lists where users may intentionally re-case).
   */
  casingNormalization?: 'canonical' | 'as-typed'
  /**
   * Customize the tail-create row label. Default:
   * `+ Add new: "<typed>"`.
   */
  createTailLabel?: (typed: string) => string
  placeholder?: string
  /**
   * Field label. On phone, surfaces as the visible title at the
   * top of the Sheet (since the Sheet is the entire editing
   * context and the surrounding FormRow's label isn't visible
   * inside it). Also feeds the Sheet's accessible name (screen
   * reader announce on open). Falls back to `placeholder` if not
   * provided. On desktop / tablet the label isn't rendered by the
   * primitive — wrap with FormRow to position a label above the
   * inline input.
   */
  label?: string
  disabled?: boolean
  /**
   * When provided alongside `disabled`, surfaces as the browser-
   * native `title` tooltip on web. Same affordance IconAction uses
   * for "temporarily unavailable" / edit-restriction-tooltip per
   * [`principles.md → Edit restrictions during in-flight generation`](../../docs/ui/principles.md#edit-restrictions-during-in-flight-generation).
   */
  disabledReason?: string
  /** Marks the input invalid for ARIA + visual error styling. */
  'aria-invalid'?: boolean | 'true' | 'false'
  className?: string
  inputClassName?: string
  popoverClassName?: string
}

type FilterResult = {
  trimmed: string
  exactMatch: string | undefined
  suggestions: string[]
  showTail: boolean
}

function useFilter(value: string, sourceList: readonly string[]): FilterResult {
  return React.useMemo(() => {
    const trimmed = value.trim()
    const lc = trimmed.toLowerCase()
    const exactMatch = sourceList.find((s) => s.toLowerCase() === lc)
    let suggestions: string[]
    if (sourceList.length === 0) {
      suggestions = []
    } else if (!trimmed) {
      suggestions = Array.from(sourceList)
    } else {
      suggestions = sourceList.filter((s) => s.toLowerCase().includes(lc))
    }
    return { trimmed, exactMatch, suggestions, showTail: trimmed.length > 0 && !exactMatch }
  }, [value, sourceList])
}

/**
 * Trailing clear button for the input. Always rendered when the
 * field is enabled — visibility toggled via `visible` prop rather
 * than conditional rendering. This is deliberate:
 *
 *   `Input` switches between a bare `<TextInput>` (no adornments)
 *   and a `<View>`-wrapped TextInput (with adornments) based on
 *   whether `leading`/`trailing` are present. Toggling `trailing`
 *   on first keystroke would unmount and remount the underlying
 *   TextInput, breaking external element references (test
 *   environments, focus management) and producing a visible
 *   layout shift when typing the first character. Always
 *   rendering the slot keeps the input's DOM identity stable.
 *
 * Standard input-adornment treatment — `text-fg-muted` color,
 * light press affordance via opacity. Not an `IconAction` because
 * that primitive's muted-default-then-brighten pattern is meant
 * for row-action contexts, not in-field clear buttons.
 */
function ClearButton({ visible, onPress }: { visible: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!visible}
      hitSlop={8}
      accessibilityRole="button"
      aria-label="Clear input"
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      className={cn('p-1 active:opacity-70', !visible && 'opacity-0')}
    >
      <Icon as={X} size="sm" className="text-fg-muted" />
    </Pressable>
  )
}

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

type SuggestionListProps = {
  suggestions: string[]
  showTail: boolean
  trimmed: string
  highlightedIndex: number
  onPickSuggestion: (s: string) => void
  onPickTail: (typed: string) => void
  createTailLabel: (typed: string) => string
  style?: React.ComponentProps<typeof View>['style']
  /**
   * `'inline'` — desktop / tablet popover. Compact rows
   * (`min-h-control-md`, density-aware horizontal + vertical
   * padding) with hairline `border-b` separators between. Popover
   * container chrome (border + rounded) comes from the parent.
   *
   * `'sheet'` — phone bottom Sheet. Touch-sized rows
   * (`min-h-control-lg`) with edge-to-edge `border-b` dividers
   * (parent applies `-mx-6` bleed so dividers run the Sheet's full
   * width). Horizontal padding is fixed at `px-9` (36 px) so row
   * text aligns with the Input text above (Sheet's p-6 + Input's
   * pl-3). Tail-create row is rendered separately by the parent as
   * a `<Button variant="secondary">` rather than another row in
   * this list.
   */
  variant?: 'inline' | 'sheet'
  className?: string
}

const ROW_BASE = 'flex-row items-center active:bg-tint-press'

function SuggestionList({
  suggestions,
  showTail,
  trimmed,
  highlightedIndex,
  onPickSuggestion,
  onPickTail,
  createTailLabel,
  variant = 'inline',
  className,
  style,
}: SuggestionListProps) {
  const isSheet = variant === 'sheet'
  // Sheet variant: transparent rows. Dividers render as separate
  // `<View>` elements (not `border-b` on rows) so they can carry
  // their own `mx-3` side margin without indenting the row's
  // press-tint hit area. Top divider above the first row and a
  // closing divider after the last anchor the list visually +
  // separate it from the tail-create Button below. Row's `px-9`
  // (36 px) aligns suggestion text with the input text above
  // (Sheet's p-6 + Input's pl-3 = 36 px from the screen edge).
  //
  // Inline variant: rows carry their own `border-b` between
  // entries — the popover's border + rounded chrome already gives
  // top + bottom edge affordance, no need for extra wrapping
  // dividers.
  const rowVariantClasses = isSheet
    ? 'min-h-control-lg px-9 py-row-y-md'
    : 'min-h-control-md px-row-x-md py-row-y-md'
  const sheetDivider = <View className="mx-3 h-px bg-border" />
  return (
    <View className={className} style={style}>
      {isSheet && (suggestions.length > 0 || showTail) && sheetDivider}
      {suggestions.map((s, idx) => {
        const isLastSuggestion = idx === suggestions.length - 1
        return (
          <React.Fragment key={s}>
            <Pressable
              onPress={() => onPickSuggestion(s)}
              className={cn(
                ROW_BASE,
                rowVariantClasses,
                !isSheet && !isLastSuggestion && 'border-b border-border',
                highlightedIndex === idx && 'bg-tint-hover',
                Platform.select({ web: 'hover:bg-tint-hover', default: '' }),
              )}
              accessibilityRole="button"
              aria-label={s}
              aria-selected={highlightedIndex === idx}
            >
              <Text className="text-sm text-fg-primary">{s}</Text>
            </Pressable>
            {isSheet && sheetDivider}
          </React.Fragment>
        )
      })}
      {showTail && (
        <Pressable
          onPress={() => onPickTail(trimmed)}
          className={cn(
            ROW_BASE,
            rowVariantClasses,
            // Inline-only stronger top divider for the tail row;
            // sheet renders the tail as a separate `<Button>`
            // outside this list, so this branch only runs inline.
            !isSheet && suggestions.length > 0 && 'border-t border-border-strong',
            highlightedIndex === suggestions.length && 'bg-tint-hover',
            Platform.select({ web: 'hover:bg-tint-hover', default: '' }),
          )}
          accessibilityRole="button"
          aria-label={createTailLabel(trimmed)}
          aria-selected={highlightedIndex === suggestions.length}
        >
          <Text className="text-sm text-fg-secondary">{createTailLabel(trimmed)}</Text>
        </Pressable>
      )}
    </View>
  )
}

type InlineProps = AutocompleteProps & { tailLabel: (typed: string) => string }

function AutocompleteInline({
  value,
  onValueChange,
  onCommit,
  sourceList = [],
  casingNormalization = 'canonical',
  tailLabel,
  placeholder,
  disabled,
  disabledReason,
  'aria-invalid': ariaInvalid,
  className,
  inputClassName,
  popoverClassName,
}: InlineProps) {
  const [open, setOpen] = React.useState(false)
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1)
  const [anchorRect, setAnchorRect] = React.useState<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)
  const blurTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = React.useRef<View>(null)
  // Each Autocomplete instance gets a stable Portal name so multiple
  // instances on the same page don't overwrite each other's portal
  // content (Portals keyed off the same name share a slot).
  const portalName = React.useId()

  React.useEffect(() => {
    return () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
    }
  }, [])

  // Measure the input wrapper's viewport coords. Used to position
  // the portaled popover. Portal mounts content at the root-level
  // PortalHost (app/_layout.tsx), escaping every ancestor stacking
  // context — the earlier in-flow approach (with `z-50` then
  // `position: fixed`) was getting clipped by parent ScrollViews on
  // Electron. RN-Web's style allowlist also drops `position: fixed`,
  // which is why fixed-positioning didn't work either.
  const updateAnchor = React.useCallback(() => {
    const node = wrapperRef.current
    if (!node) return
    node.measureInWindow((x, y, width, height) => {
      setAnchorRect({ x, y, width, height })
    })
  }, [])

  React.useEffect(() => {
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

  const { trimmed, exactMatch, suggestions, showTail } = useFilter(value, sourceList)
  const totalItems = suggestions.length + (showTail ? 1 : 0)
  const hasContent = totalItems > 0
  const isOpen = !disabled && open && hasContent

  // Clamp highlightedIndex when filter results change.
  React.useEffect(() => {
    if (highlightedIndex >= totalItems) setHighlightedIndex(-1)
  }, [totalItems, highlightedIndex])

  const commitValue = React.useCallback(
    (raw: string) => {
      const final = normalizeCommit(raw, sourceList, casingNormalization)
      if (final == null) return
      if (final !== value) onValueChange(final)
      onCommit?.(final)
      setOpen(false)
      setHighlightedIndex(-1)
    },
    [casingNormalization, sourceList, value, onValueChange, onCommit],
  )

  const onSubmitEditing = () => {
    // Highlighted item commits first — keyboard nav is an explicit
    // selection, regardless of whether the typed value is empty.
    // Spec's "empty Enter is no-op" rule covers the case where the
    // user hits Enter without doing anything; an arrowed-to highlight
    // is doing something.
    if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
      commitValue(suggestions[highlightedIndex]!)
      return
    }
    if (highlightedIndex === suggestions.length && showTail) {
      commitValue(trimmed)
      return
    }
    if (!trimmed) return
    if (exactMatch) {
      commitValue(exactMatch)
      return
    }
    if (suggestions.length > 0) {
      commitValue(suggestions[0]!)
      return
    }
    commitValue(trimmed)
  }

  const onKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    // Web-only: arrow keys + Escape. RN-Web's TextInput exposes
    // `key` on the synthetic event for non-printable keys.
    if (Platform.OS !== 'web') return
    const key = e.nativeEvent.key
    if (key === 'ArrowDown') {
      if (!hasContent) return
      e.preventDefault?.()
      setOpen(true)
      setHighlightedIndex((i) => (i + 1 >= totalItems ? 0 : i + 1))
    } else if (key === 'ArrowUp') {
      if (!hasContent) return
      e.preventDefault?.()
      setOpen(true)
      setHighlightedIndex((i) => (i <= 0 ? totalItems - 1 : i - 1))
    } else if (key === 'Escape') {
      e.preventDefault?.()
      setOpen(false)
      setHighlightedIndex(-1)
    }
  }

  const popoverChromeClasses = cn(
    'max-h-72 overflow-hidden rounded-md border border-border bg-bg-overlay py-1',
    Platform.select({ web: 'overflow-y-auto', default: '' }),
    popoverClassName,
  )
  const popoverStyle =
    anchorRect != null
      ? {
          position: 'absolute' as const,
          top: anchorRect.y + anchorRect.height + 4,
          left: anchorRect.x,
          width: anchorRect.width,
          zIndex: 50,
        }
      : undefined
  const content = (
    <View ref={wrapperRef} className={cn('relative', className)} onLayout={updateAnchor}>
      <Input
        value={value}
        onChangeText={(v) => {
          onValueChange(v)
          setHighlightedIndex(-1)
          if (!disabled) setOpen(true)
        }}
        onFocus={() => {
          if (blurTimerRef.current) {
            clearTimeout(blurTimerRef.current)
            blurTimerRef.current = null
          }
          if (!disabled) setOpen(true)
        }}
        onBlur={() => {
          // Defer close so a Pressable suggestion can register its
          // press before blur fires. 200 ms is the standard
          // type-ahead grace window.
          blurTimerRef.current = setTimeout(() => {
            setOpen(false)
            setHighlightedIndex(-1)
          }, 200)
        }}
        onSubmitEditing={onSubmitEditing}
        onKeyPress={onKeyPress}
        editable={!disabled}
        placeholder={placeholder}
        aria-invalid={ariaInvalid}
        trailing={
          disabled ? undefined : (
            <ClearButton visible={value.length > 0} onPress={() => onValueChange('')} />
          )
        }
        className={inputClassName}
      />
      {isOpen && popoverStyle && (
        // Portal mounts the popover at the root-level PortalHost
        // (app/_layout.tsx), escaping every ancestor stacking
        // context. The container View carries position:absolute +
        // measured viewport coords; the SuggestionList provides
        // the chrome + items. Same pattern Select uses via Radix
        // portal — this is the rn-primitives equivalent.
        <Portal name={portalName}>
          <SuggestionList
            suggestions={suggestions}
            showTail={showTail}
            trimmed={trimmed}
            highlightedIndex={highlightedIndex}
            onPickSuggestion={commitValue}
            onPickTail={commitValue}
            createTailLabel={tailLabel}
            className={popoverChromeClasses}
            style={popoverStyle}
          />
        </Portal>
      )}
    </View>
  )

  // RN-Web's TextInput allowlist drops `title`, so the disabled-
  // with-reason browser tooltip wraps the field in a raw div on
  // web. Same path IconAction uses. Native ignores the wrapper.
  if (disabled && disabledReason && Platform.OS === 'web') {
    return <div title={disabledReason}>{content}</div>
  }
  return content
}

type SheetProps = AutocompleteProps & { tailLabel: (typed: string) => string }

function AutocompleteSheet({
  value,
  onValueChange,
  onCommit,
  sourceList = [],
  casingNormalization = 'canonical',
  tailLabel,
  placeholder,
  label,
  disabled,
  disabledReason,
  'aria-invalid': ariaInvalid,
  className,
  inputClassName,
}: SheetProps) {
  const [open, setOpen] = React.useState(false)
  const { trimmed, exactMatch, suggestions, showTail } = useFilter(value, sourceList)
  const keyboardHeight = useKeyboardHeight()

  const commitValue = React.useCallback(
    (raw: string) => {
      const final = normalizeCommit(raw, sourceList, casingNormalization)
      if (final == null) return
      if (final !== value) onValueChange(final)
      onCommit?.(final)
      setOpen(false)
    },
    [casingNormalization, sourceList, value, onValueChange, onCommit],
  )

  const onSubmitEditing = () => {
    if (!trimmed) return
    if (exactMatch) {
      commitValue(exactMatch)
      return
    }
    if (suggestions.length > 0) {
      commitValue(suggestions[0]!)
      return
    }
    commitValue(trimmed)
  }

  const trigger = (
    <Pressable
      onPress={() => !disabled && setOpen(true)}
      disabled={disabled}
      accessibilityRole="button"
      aria-label={value || placeholder || 'Pick value'}
      className={cn(
        'h-control-md flex-row items-center justify-start rounded-md border border-border bg-bg-base px-3',
        disabled && 'opacity-50',
        ariaInvalid && 'border-danger',
        inputClassName,
      )}
    >
      <Text
        className={cn('text-sm', value ? 'text-fg-primary' : 'text-fg-muted')}
        numberOfLines={1}
      >
        {value || placeholder || ''}
      </Text>
    </Pressable>
  )

  return (
    <View className={className}>
      {disabled && disabledReason && Platform.OS === 'web' ? (
        <div title={disabledReason}>{trigger}</div>
      ) : (
        trigger
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent anchor="bottom" size="tall" title={label ?? placeholder ?? 'Pick value'}>
          {label != null && label.length > 0 && (
            <Heading level={2} className="mb-3">
              {label}
            </Heading>
          )}
          <Input
            value={value}
            onChangeText={onValueChange}
            onSubmitEditing={onSubmitEditing}
            autoFocus
            placeholder={placeholder}
            aria-invalid={ariaInvalid}
            trailing={
              disabled ? undefined : (
                <ClearButton visible={value.length > 0} onPress={() => onValueChange('')} />
              )
            }
            className="mb-3"
          />
          <ScrollView
            className="-mx-6"
            style={{ flex: 1 }}
            // `paddingBottom: keyboardHeight` extends the scrollable
            // content past the keyboard's footprint so the last
            // suggestion row + tail-create Button can be scrolled
            // above the keyboard rather than being covered by it.
            // The hook returns 0 on web + when keyboard is hidden,
            // so this is a no-op in those states.
            contentContainerStyle={{ paddingBottom: keyboardHeight }}
            keyboardShouldPersistTaps="handled"
          >
            <SuggestionList
              suggestions={suggestions}
              showTail={false}
              trimmed={trimmed}
              highlightedIndex={-1}
              onPickSuggestion={commitValue}
              onPickTail={commitValue}
              createTailLabel={tailLabel}
              variant="sheet"
            />
            {showTail && (
              <View className="mx-6 mt-3">
                <Button variant="secondary" onPress={() => commitValue(trimmed)} className="w-full">
                  <Text>{tailLabel(trimmed)}</Text>
                </Button>
              </View>
            )}
          </ScrollView>
        </SheetContent>
      </Sheet>
    </View>
  )
}

export function Autocomplete(props: AutocompleteProps) {
  const tier = useTier()
  const tailLabel = props.createTailLabel ?? defaultTailLabel
  // Sheet is a touch idiom; on web (any width) the user is on mouse,
  // so popover/inline is the appropriate shape regardless of viewport
  // width. Gate sheet dispatch on native-phone only. Matches Select.
  const usesSheet = Platform.OS !== 'web' && tier === 'phone'
  if (usesSheet) {
    return <AutocompleteSheet {...props} tailLabel={tailLabel} />
  }
  return <AutocompleteInline {...props} tailLabel={tailLabel} />
}

function defaultTailLabel(typed: string): string {
  return `+ Add new: "${typed}"`
}

export type { AutocompleteProps }
