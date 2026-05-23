import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ImpactFeedbackStyle, impactAsync } from 'expo-haptics'
import { ChevronDown, GripVertical, Trash2 } from 'lucide-react-native'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { Platform, Pressable, View, type LayoutChangeEvent } from 'react-native'
import { GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useSortableList, useSortable as useSortableNative } from 'react-native-reanimated-dnd'
import { runOnUISync } from 'react-native-worklets'

import { Button } from '@/components/ui/button'
import { ColorPicker, type ColorValue } from '@/components/ui/color-picker'
import { Icon } from '@/components/ui/icon'
import { IconAction } from '@/components/ui/icon-action'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import { useTier } from '@/hooks/use-tier'
import { useDensity } from '@/lib/density/use-density'
import { cn } from '@/lib/utils'

type SuggestionCategory = {
  /** Stable id; survives reorder + edit. Host generates on create. */
  id: string
  /** Translated, user-facing label. Validated non-empty + case-insensitive unique. */
  label: string
  /** ColorPicker value (hex). Resolved against the host's swatch palette. */
  color: ColorValue | null
  /** Prose hint the suggestion agent receives for this slot. Empty allowed. */
  promptHint: string
  /** When false, entry stays defined but doesn't emit. */
  enabled: boolean
}

type SuggestionCategoriesEditorProps = {
  /** Ordered list. Array position IS the order — host serializes `order: index` on save. */
  categories: SuggestionCategory[]
  /** Fires on every mutation: reorder, edit field, toggle, add, delete. */
  onChange: (next: SuggestionCategory[]) => void
  /** Swatch palette the per-row ColorPicker offers. */
  swatches: ColorValue[]
  /** Color a row falls back to when its `color` is null. */
  fallbackColor: ColorValue
  /** Localized label for the fallback swatch. */
  fallbackColorLabel?: string
  /** When true, dim the entire editor (master suggestionsEnabled toggle off). */
  disabled?: boolean
  /** Generator for new-row ids — host injects so prod can use cuid / nanoid. */
  generateId?: () => string
  className?: string
}

const DEFAULT_FALLBACK_LABEL = 'Default'
const PROMPT_HINT_MIN_HEIGHT = 80
const EXPAND_DURATION_MS = 200
// Time to keep the dropped row rendered last in the DOM after gesture end. Covers the lib's
// post-release withSpring settle so the row doesn't paint under siblings mid-animation.
const DROP_HOLD_MS = 350
const COLLAPSED_ROW_HEIGHT_BY_DENSITY = {
  compact: 45,
  regular: 51,
  comfortable: 59,
} as const

function findDuplicateLabelIds(categories: SuggestionCategory[]): ReadonlySet<string> {
  const seen = new Map<string, string[]>()
  for (const c of categories) {
    const key = c.label.trim().toLowerCase()
    if (key.length === 0) continue
    const ids = seen.get(key) ?? []
    ids.push(c.id)
    seen.set(key, ids)
  }
  const dups = new Set<string>()
  for (const ids of seen.values()) {
    if (ids.length > 1) for (const id of ids) dups.add(id)
  }
  return dups
}

function defaultIdGen(): string {
  return `cat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function dotColorStyle(color: string) {
  return { backgroundColor: color }
}

type RowState = {
  category: SuggestionCategory
  duplicateLabel: boolean
  emptyLabel: boolean
  index: number
  total: number
}

type RowHandlers = {
  onLabelChange: (id: string, label: string) => void
  onPromptHintChange: (id: string, promptHint: string) => void
  onColorChange: (id: string, color: ColorValue | null) => void
  onToggleEnabled: (id: string) => void
  onDelete: (id: string) => void
}

type RowContentProps = RowState &
  RowHandlers & {
    swatches: ColorValue[]
    fallbackColor: ColorValue
    fallbackColorLabel: string
    disabled?: boolean
    showDragHandle: boolean
    dragHandle?: ReactNode
    // Phones can't fit ColorPicker swatches beside a flex-1 Input at 360-400px; stacked: true
    // flips the inner layout to a vertical column.
    stacked: boolean
  }

const RowContent = memo(function RowContent({
  category,
  duplicateLabel,
  emptyLabel,
  total,
  onLabelChange,
  onPromptHintChange,
  onColorChange,
  onToggleEnabled,
  onDelete,
  swatches,
  fallbackColor,
  fallbackColorLabel,
  disabled,
  showDragHandle,
  dragHandle,
  stacked,
}: RowContentProps) {
  const labelError = emptyLabel
    ? 'Label is required'
    : duplicateLabel
      ? 'Label must be unique'
      : null
  const deleteLabel = `Delete category${total === 1 ? ' (last one)' : ''}`
  const labelField = (
    <View className="min-w-0 flex-1 flex-col gap-1">
      <Input
        value={category.label}
        onChangeText={(v) => onLabelChange(category.id, v)}
        placeholder="Category label"
        editable={!disabled}
        aria-invalid={labelError != null}
        autoCorrect={false}
      />
      {labelError ? (
        <Text size="xs" className="text-danger">
          {labelError}
        </Text>
      ) : null}
    </View>
  )
  const colorField = (
    <View className={stacked ? 'flex-col gap-1' : undefined}>
      {stacked ? (
        <Text size="xs" variant="muted">
          Color
        </Text>
      ) : null}
      <ColorPicker
        swatches={swatches}
        value={category.color}
        onChange={(next) => onColorChange(category.id, next)}
        fallbackColor={fallbackColor}
        fallbackLabel={fallbackColorLabel}
        allowCustom
        disabled={disabled}
      />
    </View>
  )
  const promptField = (
    <Textarea
      value={category.promptHint}
      onChangeText={(v) => onPromptHintChange(category.id, v)}
      placeholder="Prompt hint (optional — label is used as the sole hint when blank)"
      editable={!disabled}
      style={textareaMinHeightStyle}
      rows={3}
    />
  )
  return (
    <View className="flex-1 flex-row items-start gap-2">
      {showDragHandle ? dragHandle : null}
      <View className="pt-3">
        <Switch
          checked={category.enabled}
          onCheckedChange={() => onToggleEnabled(category.id)}
          disabled={disabled}
          aria-label={category.enabled ? 'Disable category' : 'Enable category'}
        />
      </View>
      <View className="flex-1 flex-col gap-2">
        {stacked ? (
          <>
            {labelField}
            {colorField}
            {promptField}
          </>
        ) : (
          <>
            <View className="flex-row items-start gap-2">
              {labelField}
              {colorField}
            </View>
            {promptField}
          </>
        )}
      </View>
      <View className="pt-2">
        <IconAction
          icon={Trash2}
          label={deleteLabel}
          size="sm"
          variant="destructive"
          onPress={() => onDelete(category.id)}
          disabled={disabled}
        />
      </View>
    </View>
  )
})

const textareaMinHeightStyle = { minHeight: PROMPT_HINT_MIN_HEIGHT } as const
const DIMMED_STYLE = { opacity: 0.5 } as const

function SortableWebRow({
  rowState,
  handlers,
  swatches,
  fallbackColor,
  fallbackColorLabel,
  disabled,
}: {
  rowState: RowState
  handlers: RowHandlers
  swatches: ColorValue[]
  fallbackColor: ColorValue
  fallbackColorLabel: string
  disabled?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rowState.category.id,
    disabled,
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  }
  const dragHandle = (
    <button
      type="button"
      aria-label="Drag to reorder"
      {...listeners}
      {...attributes}
      disabled={disabled}
      className="cursor-grab self-start rounded-sm p-2 text-fg-muted hover:text-fg-primary active:cursor-grabbing"
    >
      <Icon as={GripVertical} size="sm" />
    </button>
  )
  return (
    <div ref={setNodeRef} style={style} className="border-b border-border last:border-b-0">
      <View className="flex-row items-start gap-1 px-3 py-3">
        <RowContent
          {...rowState}
          {...handlers}
          swatches={swatches}
          fallbackColor={fallbackColor}
          fallbackColorLabel={fallbackColorLabel}
          disabled={disabled}
          showDragHandle
          dragHandle={dragHandle}
          stacked={false}
        />
      </View>
    </div>
  )
}

function PhoneRowSummary({
  category,
  duplicateLabel,
  emptyLabel,
  fallbackColor,
}: {
  category: SuggestionCategory
  duplicateLabel: boolean
  emptyLabel: boolean
  fallbackColor: ColorValue
}) {
  const dotColor = category.color ?? fallbackColor
  const labelDisplay = category.label.trim() || 'Unnamed category'
  const hasError = duplicateLabel || emptyLabel
  return (
    <View className="flex-1 flex-row items-center gap-2">
      <View
        className="size-3 rounded-full border border-border"
        style={dotColorStyle(dotColor)}
        aria-hidden
      />
      <Text
        size="sm"
        className={cn(
          'flex-1',
          category.enabled ? 'text-fg-primary' : 'text-fg-muted',
          hasError && 'text-danger',
        )}
        numberOfLines={1}
      >
        {labelDisplay}
      </Text>
      {!category.enabled ? (
        <Text size="xs" variant="muted">
          off
        </Text>
      ) : null}
    </View>
  )
}

function PhoneRowShell({
  rowState,
  handlers,
  swatches,
  fallbackColor,
  fallbackColorLabel,
  disabled,
  dragHandle,
  expanded,
  onToggleExpanded,
}: {
  rowState: RowState
  handlers: RowHandlers
  swatches: ColorValue[]
  fallbackColor: ColorValue
  fallbackColorLabel: string
  disabled?: boolean
  dragHandle: ReactNode
  expanded: boolean
  onToggleExpanded: () => void
}) {
  // Rotating the Icon directly rotates the SVG around (0,0) and pushes it off-screen.
  // Wrapping in a View rotates around the view's visual center.
  const progress = useDerivedValue(
    () => withTiming(expanded ? 1 : 0, { duration: EXPAND_DURATION_MS }),
    [expanded],
  )
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.value * 90 - 90}deg` }],
  }))
  return (
    <View className="border-b border-border bg-bg-base">
      <View className="flex-row items-center gap-1">
        {dragHandle}
        <Pressable
          accessibilityRole="button"
          aria-label={expanded ? 'Collapse category' : 'Expand category'}
          aria-expanded={expanded}
          onPress={onToggleExpanded}
          disabled={disabled}
          className="flex-1 flex-row items-center gap-2 py-row-y-lg pr-3"
        >
          <PhoneRowSummary
            category={rowState.category}
            duplicateLabel={rowState.duplicateLabel}
            emptyLabel={rowState.emptyLabel}
            fallbackColor={fallbackColor}
          />
          <Animated.View style={chevronStyle}>
            <Icon as={ChevronDown} size="sm" className="text-fg-muted" />
          </Animated.View>
        </Pressable>
      </View>
      {expanded ? (
        <View className="flex-row px-3 pb-3">
          <RowContent
            {...rowState}
            {...handlers}
            swatches={swatches}
            fallbackColor={fallbackColor}
            fallbackColorLabel={fallbackColorLabel}
            disabled={disabled}
            showDragHandle={false}
            stacked
          />
        </View>
      ) : null}
    </View>
  )
}

const dragHandleStaticStyle = { padding: 12 } as const

function SuggestionCategoriesEditor({
  categories,
  onChange,
  swatches,
  fallbackColor,
  fallbackColorLabel = DEFAULT_FALLBACK_LABEL,
  disabled,
  generateId = defaultIdGen,
  className,
}: SuggestionCategoriesEditorProps) {
  const tier = useTier()
  const isPhone = Platform.OS !== 'web' && tier === 'phone'

  const duplicateIds = useMemo(() => findDuplicateLabelIds(categories), [categories])

  // Latest-state ref so `handlers` and `handleAdd` can stay stable across keystrokes. Without
  // this they'd re-create on every `categories` change, breaking memo(RowContent) and
  // memo(SortablePhoneRow) — every keystroke in any row would re-render every other row.
  // Ref is updated synchronously in render so handlers always see the latest array.
  const stateRef = useRef({ categories, onChange, generateId })
  stateRef.current = { categories, onChange, generateId }

  const handlers = useMemo<RowHandlers>(
    () => ({
      onLabelChange: (id, label) => {
        const s = stateRef.current
        s.onChange(s.categories.map((c) => (c.id === id ? { ...c, label } : c)))
      },
      onPromptHintChange: (id, promptHint) => {
        const s = stateRef.current
        s.onChange(s.categories.map((c) => (c.id === id ? { ...c, promptHint } : c)))
      },
      onColorChange: (id, color) => {
        const s = stateRef.current
        s.onChange(s.categories.map((c) => (c.id === id ? { ...c, color } : c)))
      },
      onToggleEnabled: (id) => {
        const s = stateRef.current
        s.onChange(s.categories.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)))
      },
      onDelete: (id) => {
        const s = stateRef.current
        s.onChange(s.categories.filter((c) => c.id !== id))
      },
    }),
    [],
  )

  const handleAdd = useCallback(() => {
    const s = stateRef.current
    s.onChange([
      ...s.categories,
      {
        id: s.generateId(),
        label: '',
        color: null,
        promptHint: '',
        enabled: true,
      },
    ])
  }, [])

  const rowStates: RowState[] = useMemo(
    () =>
      categories.map((category, index) => ({
        category,
        duplicateLabel: duplicateIds.has(category.id),
        emptyLabel: category.label.trim().length === 0,
        index,
        total: categories.length,
      })),
    [categories, duplicateIds],
  )

  const addButton = (
    <Button variant="ghost" onPress={handleAdd} disabled={disabled}>
      <Text>+ Add category</Text>
    </Button>
  )

  return (
    <View className={cn('flex-col gap-2', className)} style={disabled ? DIMMED_STYLE : undefined}>
      {isPhone ? (
        <PhoneList
          rowStates={rowStates}
          handlers={handlers}
          swatches={swatches}
          fallbackColor={fallbackColor}
          fallbackColorLabel={fallbackColorLabel}
          disabled={disabled}
          onReorder={onChange}
          categories={categories}
        />
      ) : (
        <WebList
          rowStates={rowStates}
          handlers={handlers}
          swatches={swatches}
          fallbackColor={fallbackColor}
          fallbackColorLabel={fallbackColorLabel}
          disabled={disabled}
          onReorder={onChange}
          categories={categories}
        />
      )}
      {addButton}
    </View>
  )
}

type WebListProps = {
  rowStates: RowState[]
  handlers: RowHandlers
  swatches: ColorValue[]
  fallbackColor: ColorValue
  fallbackColorLabel: string
  disabled?: boolean
  onReorder: (next: SuggestionCategory[]) => void
  categories: SuggestionCategory[]
}

function WebList({
  rowStates,
  handlers,
  swatches,
  fallbackColor,
  fallbackColorLabel,
  disabled,
  onReorder,
  categories,
}: WebListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const from = categories.findIndex((c) => c.id === active.id)
      const to = categories.findIndex((c) => c.id === over.id)
      if (from < 0 || to < 0) return
      onReorder(arrayMove(categories, from, to))
    },
    [categories, onReorder],
  )

  const items = useMemo(() => categories.map((c) => c.id), [categories])

  return (
    <View className="rounded-md border border-border bg-bg-base">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          {rowStates.map((rowState) => (
            <SortableWebRow
              key={rowState.category.id}
              rowState={rowState}
              handlers={handlers}
              swatches={swatches}
              fallbackColor={fallbackColor}
              fallbackColorLabel={fallbackColorLabel}
              disabled={disabled}
            />
          ))}
        </SortableContext>
      </DndContext>
    </View>
  )
}

type PhoneListProps = {
  rowStates: RowState[]
  handlers: RowHandlers
  swatches: ColorValue[]
  fallbackColor: ColorValue
  fallbackColorLabel: string
  disabled?: boolean
  onReorder: (next: SuggestionCategory[]) => void
  categories: SuggestionCategory[]
}

const EMPTY_EXPANDED_SET: ReadonlySet<string> = new Set()

// Build the lib's positions map ({ [id]: index }) from the category array. Matches
// react-native-reanimated-dnd's internal listToObject; inlined because the lib doesn't
// re-export it.
function buildPositions(categories: SuggestionCategory[]): { [id: string]: number } {
  const positions: { [id: string]: number } = {}
  for (let i = 0; i < categories.length; i++) {
    positions[categories[i]!.id] = i
  }
  return positions
}

function PhoneList({
  rowStates,
  handlers,
  swatches,
  fallbackColor,
  fallbackColorLabel,
  onReorder,
  categories,
  disabled,
}: PhoneListProps) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(EMPTY_EXPANDED_SET)
  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const density = useDensity()
  const sortableList = useSortableList<SuggestionCategory>({
    data: categories,
    enableDynamicHeights: true,
    estimatedItemHeight: COLLAPSED_ROW_HEIGHT_BY_DENSITY[density.resolved],
    itemKeyExtractor: (item) => item.id,
  })

  // useSortableList initializes `positions` once and never updates it when `data` changes
  // (the lib's data-effect only resyncs `itemHeights`). Without this sync, adding or deleting
  // a category leaves the lib's positions map stale — the previous workaround was to remount
  // the whole subtree via key={idSetKey}, which destroyed expanded state, replayed the chevron
  // animation, and let `overflow-hidden` clip rows under the still-springing container height.
  //
  // The write MUST be synchronous and happen during render (before children mount). The lib's
  // useSortable captures `initialTopVal = positions.get()[id] * estimatedItemHeight` in a
  // useMemo with empty deps on the new row's first render — if positions doesn't include the
  // new id at that moment, initialTopVal is 0 and the new row paints over row 0 until the
  // user touches it (which forces the lib to re-resolve from positions on the UI thread).
  //
  // Plain `positionsSV.value = ...` from JS only SCHEDULES a UI-thread write (Reanimated 4
  // mutables, see node_modules/.../mutables.js makeMutableNative). The subsequent .get() in
  // the lib calls runOnUISync to fetch the UI-side value, which hasn't been updated yet, so
  // the lib still sees the stale map. Using runOnUISync ourselves forces the write to happen
  // synchronously on the UI thread before we proceed to render children.
  //
  // Safe to do here: drag is worklet-only and can't overlap an add/delete from the user. On
  // reorder the lib has already written the new map, so the sort-keyed signature skips the
  // redundant write for that path.
  const positionsSV = sortableList.positions
  const idSetSignature = useMemo(
    () =>
      categories
        .map((c) => c.id)
        .slice()
        .sort()
        .join('|'),
    [categories],
  )
  const lastSyncedSignatureRef = useRef<string | null>(null)
  if (lastSyncedSignatureRef.current !== idSetSignature) {
    const next = buildPositions(categories)
    runOnUISync(() => {
      'worklet'
      positionsSV.value = next
    })
    lastSyncedSignatureRef.current = idSetSignature
  }

  const itemHeightsSV = sortableList.itemHeights
  const targetHeight = useDerivedValue(() => {
    let total = 0
    const heights = itemHeightsSV.value
    for (const id in heights) {
      total += heights[id]
    }
    return total
  })
  const animatedHeight = useDerivedValue(() => withSpring(targetHeight.value))
  const animatedHeightStyle = useAnimatedStyle(() => ({
    height: Math.round(animatedHeight.value),
  }))

  const rowStateById = useMemo(() => {
    const map = new Map<string, RowState>()
    for (const rs of rowStates) map.set(rs.category.id, rs)
    return map
  }, [rowStates])

  // Latest-categories ref so handleMove validates against current state, not the closure-
  // captured array. The lib re-creates its useAnimatedReaction when onMove changes, but the
  // OLD reaction (with the old handleMove closure) can fire one last time during our
  // runOnUISync write before React commits and tears it down. That stale closure sees the
  // pre-delete array, so validations against `categories` pass spuriously and arrayMove
  // reintroduces the deleted row. Updating the ref during render keeps it ahead of any
  // queued onMove.
  const categoriesRef = useRef(categories)
  categoriesRef.current = categories
  const handleMove = useCallback(
    (id: string, from: number, to: number) => {
      // The lib fires onMove for every position change, not just drags — including the
      // index-shifts that ripple through remaining rows when we delete one (e.g. row at
      // index 2 becomes index 1) AND the position-becomes-undefined event for the deleted
      // row itself. Validate against the latest categories ref and reject non-number
      // arguments (to=undefined when the deleted row's reaction fires).
      if (typeof from !== 'number' || typeof to !== 'number') return
      if (from === to) return
      const current = categoriesRef.current
      if (from < 0 || from >= current.length) return
      if (to < 0 || to >= current.length) return
      if (current[from]?.id !== id) return
      onReorder(arrayMove(current, from, to))
    },
    [onReorder],
  )

  // Track which row is being dragged so we can render it last in the DOM. RN's zIndex on
  // absolute-positioned siblings (the lib sets `zIndex: movingSV.value ? 1 : 0` on the row)
  // is unreliable on Android — but more importantly, the lib flips `movingSV` to false on
  // gesture end, while the drop-settling spring keeps running for ~300ms afterwards. During
  // that spring the dragged row would otherwise paint UNDER any sibling it was over, which
  // reads as the row falling behind. Hold the renderOrder-last status for DROP_HOLD_MS to
  // cover the spring. The constant is tuned to the lib's withSpring default; if upstream
  // changes spring config, retune.
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const dropTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (dropTimerRef.current) clearTimeout(dropTimerRef.current)
    }
  }, [])
  const handleDragStart = useCallback((id: string) => {
    if (dropTimerRef.current) clearTimeout(dropTimerRef.current)
    setDraggedId(id)
    void impactAsync(ImpactFeedbackStyle.Medium)
  }, [])
  const handleDrop = useCallback(() => {
    if (dropTimerRef.current) clearTimeout(dropTimerRef.current)
    dropTimerRef.current = setTimeout(() => {
      setDraggedId(null)
      dropTimerRef.current = null
    }, DROP_HOLD_MS)
  }, [])

  const renderOrder = useMemo(() => {
    if (!draggedId) return categories
    const idx = categories.findIndex((c) => c.id === draggedId)
    if (idx === -1) return categories
    return [...categories.slice(0, idx), ...categories.slice(idx + 1), categories[idx]!]
  }, [categories, draggedId])

  return (
    <Animated.View
      className="overflow-hidden rounded-md border border-border bg-bg-base"
      style={animatedHeightStyle}
    >
      {renderOrder.map((item) => {
        const rowState = rowStateById.get(item.id)
        if (!rowState) return null
        const originalIndex = categories.indexOf(item)
        const sortableProps = sortableList.getItemProps(item, originalIndex)
        return (
          <SortablePhoneRow
            key={item.id}
            item={item}
            sortableProps={sortableProps}
            rowState={rowState}
            handlers={handlers}
            swatches={swatches}
            fallbackColor={fallbackColor}
            fallbackColorLabel={fallbackColorLabel}
            onMove={handleMove}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            expanded={expandedIds.has(item.id)}
            onToggleExpanded={toggleExpanded}
            disabled={disabled}
          />
        )
      })}
    </Animated.View>
  )
}

const SORTABLE_VIRTUAL_CONTAINER_HEIGHT = 9999

type SortablePhoneRowProps = {
  item: SuggestionCategory
  sortableProps: ReturnType<ReturnType<typeof useSortableList<SuggestionCategory>>['getItemProps']>
  rowState: RowState
  handlers: RowHandlers
  swatches: ColorValue[]
  fallbackColor: ColorValue
  fallbackColorLabel: string
  onMove: (id: string, from: number, to: number) => void
  onDragStart: (id: string) => void
  onDrop: () => void
  expanded: boolean
  onToggleExpanded: (id: string) => void
  disabled?: boolean
}

const dragHandleDisabledStyle = { padding: 12, pointerEvents: 'none' } as const

const SortablePhoneRow = memo(function SortablePhoneRow({
  item,
  sortableProps,
  rowState,
  handlers,
  swatches,
  fallbackColor,
  fallbackColorLabel,
  onMove,
  onDragStart,
  onDrop,
  expanded,
  onToggleExpanded,
  disabled,
}: SortablePhoneRowProps) {
  const {
    animatedStyle: libAnimatedStyle,
    panGestureHandler,
    handlePanGestureHandler,
    registerHandle,
  } = useSortableNative<SuggestionCategory>({
    id: item.id,
    positions: sortableProps.positions,
    lowerBound: sortableProps.lowerBound!,
    autoScrollDirection: sortableProps.autoScrollDirection!,
    itemsCount: sortableProps.itemsCount,
    isDynamicHeight: sortableProps.isDynamicHeight,
    estimatedItemHeight: sortableProps.estimatedItemHeight,
    itemHeights: sortableProps.itemHeights,
    containerHeight: SORTABLE_VIRTUAL_CONTAINER_HEIGHT,
    onMove,
    onDragStart,
    onDrop,
  })

  // Mark this row as having a handle so the lib disables the whole-area pan
  // (matches SortableItem.Handle's registerHandle(true) call).
  useEffect(() => {
    registerHandle(true)
    return () => registerHandle(false)
  }, [registerHandle])

  const itemId = item.id

  const scheduleHeightUpdate = sortableProps.scheduleHeightUpdate
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (!scheduleHeightUpdate) return
      scheduleHeightUpdate(itemId, Math.ceil(event.nativeEvent.layout.height))
    },
    [itemId, scheduleHeightUpdate],
  )

  const handleToggle = useCallback(() => onToggleExpanded(itemId), [itemId, onToggleExpanded])

  return (
    <GestureDetector gesture={panGestureHandler}>
      <Animated.View style={libAnimatedStyle} onLayout={handleLayout}>
        <PhoneRowShell
          rowState={rowState}
          handlers={handlers}
          swatches={swatches}
          fallbackColor={fallbackColor}
          fallbackColorLabel={fallbackColorLabel}
          disabled={disabled}
          expanded={expanded}
          onToggleExpanded={handleToggle}
          dragHandle={
            // Wrapping the handle in GestureDetector replaces SortableItem.Handle. pointerEvents
            // on the inner Animated.View suppresses long-press when disabled.
            <GestureDetector gesture={handlePanGestureHandler}>
              <Animated.View style={disabled ? dragHandleDisabledStyle : dragHandleStaticStyle}>
                <View
                  accessibilityRole={disabled ? 'image' : 'button'}
                  aria-label={
                    disabled ? 'Drag handle (disabled)' : 'Long-press to drag and reorder'
                  }
                >
                  <Icon as={GripVertical} size="md" className="text-fg-muted" />
                </View>
              </Animated.View>
            </GestureDetector>
          }
        />
      </Animated.View>
    </GestureDetector>
  )
}, sortablePhoneRowPropsEqual)

function sortablePhoneRowPropsEqual(prev: SortablePhoneRowProps, next: SortablePhoneRowProps) {
  if (prev.item !== next.item) return false
  if (prev.rowState !== next.rowState) return false
  if (prev.handlers !== next.handlers) return false
  if (prev.swatches !== next.swatches) return false
  if (prev.fallbackColor !== next.fallbackColor) return false
  if (prev.fallbackColorLabel !== next.fallbackColorLabel) return false
  if (prev.onMove !== next.onMove) return false
  if (prev.onDragStart !== next.onDragStart) return false
  if (prev.onDrop !== next.onDrop) return false
  if (prev.expanded !== next.expanded) return false
  if (prev.onToggleExpanded !== next.onToggleExpanded) return false
  if (prev.disabled !== next.disabled) return false
  const ps = prev.sortableProps
  const ns = next.sortableProps
  // sortableProps is a fresh object each render (lib's getItemProps returns new), but its
  // fields are stable shared-value refs except itemsCount.
  return (
    ps.id === ns.id &&
    ps.itemsCount === ns.itemsCount &&
    ps.isDynamicHeight === ns.isDynamicHeight &&
    ps.estimatedItemHeight === ns.estimatedItemHeight &&
    ps.positions === ns.positions &&
    ps.lowerBound === ns.lowerBound &&
    ps.autoScrollDirection === ns.autoScrollDirection &&
    ps.itemHeights === ns.itemHeights &&
    ps.scheduleHeightUpdate === ns.scheduleHeightUpdate &&
    ps.itemHeight === ns.itemHeight
  )
}

export { SuggestionCategoriesEditor }
export type { SuggestionCategoriesEditorProps, SuggestionCategory }
