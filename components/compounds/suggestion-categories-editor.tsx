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
import { memo, useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Platform, Pressable, View } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { SortableItem, useSortableList } from 'react-native-reanimated-dnd'

import { Button } from '@/components/ui/button'
import { ColorPicker, type ColorValue } from '@/components/ui/color-picker'
import { Icon } from '@/components/ui/icon'
import { IconAction } from '@/components/ui/icon-action'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import { useTier } from '@/hooks/use-tier'
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
// Initial guess for a collapsed phone row; library swaps in measured heights once rendered.
const ESTIMATED_COLLAPSED_ROW_HEIGHT = 56

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

// Snap-render the expanded content instead of animating it. The lib's official
// DynamicHeightExample takes this approach — letting Collapsible animate height continuously
// causes the sortable's per-item withSpring to chase a moving target every frame and visibly
// lag behind. With a snap, onLayout fires once with the final height and rows below spring
// once cleanly to their final positions.
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

  const handlers: RowHandlers = useMemo(
    () => ({
      onLabelChange: (id, label) =>
        onChange(categories.map((c) => (c.id === id ? { ...c, label } : c))),
      onPromptHintChange: (id, promptHint) =>
        onChange(categories.map((c) => (c.id === id ? { ...c, promptHint } : c))),
      onColorChange: (id, color) =>
        onChange(categories.map((c) => (c.id === id ? { ...c, color } : c))),
      onToggleEnabled: (id) =>
        onChange(categories.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c))),
      onDelete: (id) => onChange(categories.filter((c) => c.id !== id)),
    }),
    [categories, onChange],
  )

  const handleAdd = useCallback(() => {
    onChange([
      ...categories,
      {
        id: generateId(),
        label: '',
        color: null,
        promptHint: '',
        enabled: true,
      },
    ])
  }, [categories, generateId, onChange])

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

function PhoneList(props: PhoneListProps) {
  // useSortableList only re-syncs measured heights on data changes, not the positions shared
  // value. Keying by the id set (not order) forces a clean remount on add/delete while
  // letting reorders pass through to the worklet without losing per-row expanded state.
  const idSetKey = useMemo(
    () =>
      props.categories
        .map((c) => c.id)
        .sort()
        .join('|'),
    [props.categories],
  )
  return props.disabled ? (
    <PhoneListStatic {...props} />
  ) : (
    <PhoneListSortable key={idSetKey} {...props} />
  )
}

function PhoneListStatic({
  rowStates,
  handlers,
  swatches,
  fallbackColor,
  fallbackColorLabel,
  disabled,
}: PhoneListProps) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(EMPTY_EXPANDED_SET)
  const toggleExpanded = useToggleExpanded(setExpandedIds)
  return (
    <View className="overflow-hidden rounded-md border border-border bg-bg-base">
      {rowStates.map((rowState) => (
        <PhoneRowShell
          key={rowState.category.id}
          rowState={rowState}
          handlers={handlers}
          swatches={swatches}
          fallbackColor={fallbackColor}
          fallbackColorLabel={fallbackColorLabel}
          disabled={disabled}
          expanded={expandedIds.has(rowState.category.id)}
          onToggleExpanded={() => toggleExpanded(rowState.category.id)}
          dragHandle={
            <View
              accessibilityRole="image"
              aria-label="Drag handle (disabled)"
              style={dragHandleStaticStyle}
            >
              <Icon as={GripVertical} size="md" className="text-fg-muted" />
            </View>
          }
        />
      ))}
    </View>
  )
}

const EMPTY_EXPANDED_SET: ReadonlySet<string> = new Set()

function useToggleExpanded(
  setExpandedIds: (updater: (prev: ReadonlySet<string>) => ReadonlySet<string>) => void,
) {
  return useCallback(
    (id: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    },
    [setExpandedIds],
  )
}

// react-native-reanimated-dnd's Sortable component wraps an internal
// GestureHandlerRootView + ScrollView with hardcoded flex:1 + white background; that breaks
// embed-in-parent-ScrollView usage. Driving useSortableList + SortableItem ourselves keeps the
// list as a plain themed View whose absolute-positioned items lay out inside an explicit height.
function PhoneListSortable({
  rowStates,
  handlers,
  swatches,
  fallbackColor,
  fallbackColorLabel,
  onReorder,
  categories,
}: PhoneListProps) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(EMPTY_EXPANDED_SET)
  const toggleExpanded = useToggleExpanded(setExpandedIds)
  const sortableList = useSortableList<SuggestionCategory>({
    data: categories,
    enableDynamicHeights: true,
    estimatedItemHeight: ESTIMATED_COLLAPSED_ROW_HEIGHT,
    itemKeyExtractor: (item) => item.id,
  })

  const itemHeightsSV = sortableList.itemHeights
  // The lib's useSortable springs each item's `top` via withSpring (~500ms settle) on any
  // height change. If our container's height snapped to the new sum instantly, an empty gap
  // would appear at the bottom while rows below caught up — the perceived "rows lag behind
  // their slot" symptom. Spring the container height at the same rate as the items so both
  // arrive at the final layout together.
  const targetHeight = useDerivedValue(() => {
    let total = 0
    const heights = itemHeightsSV.value
    for (const id in heights) {
      total += heights[id]
    }
    return total
  })
  const animatedHeight = useDerivedValue(() => withSpring(targetHeight.value))
  const animatedHeightStyle = useAnimatedStyle(() => ({ height: animatedHeight.value }))

  const rowStateById = useMemo(() => {
    const map = new Map<string, RowState>()
    for (const rs of rowStates) map.set(rs.category.id, rs)
    return map
  }, [rowStates])

  const handleMove = useCallback(
    (_id: string, from: number, to: number) => {
      if (from === to) return
      onReorder(arrayMove(categories, from, to))
    },
    [categories, onReorder],
  )

  const handleDragStart = useCallback(() => {
    void impactAsync(ImpactFeedbackStyle.Medium)
  }, [])

  // SortableItem absolutely positions itself within its parent; the wrapper must declare an
  // explicit height (the sum of measured row heights) so neighbors flow correctly.
  return (
    <Animated.View
      className="overflow-hidden rounded-md border border-border bg-bg-base"
      style={animatedHeightStyle}
    >
      {categories.map((item, index) => {
        const rowState = rowStateById.get(item.id)
        if (!rowState) return null
        const sortableProps = sortableList.getItemProps(item, index)
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
            expanded={expandedIds.has(item.id)}
            onToggleExpanded={toggleExpanded}
          />
        )
      })}
    </Animated.View>
  )
}

// A large virtual container height that autoscroll never reaches. The lib's useSortable defaults
// containerHeight=500; when positionY exceeds (containerHeight - itemHeight), it activates
// autoscroll and starts animating scrollY toward a negative maxScroll value, making lowerBound
// go negative and causing all items to spring to wrong positions — the drag-time shake.
// Since this list has no internal scroll, we want autoscroll permanently disabled.
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
  onDragStart: () => void
  expanded: boolean
  onToggleExpanded: (id: string) => void
}

// memo here is load-bearing for perf: useSortableList runs setDynamicContentHeight on every
// layout tick (via the lib's scheduleHeightUpdate). Without memoization, PhoneListSortable
// re-renders → every SortableItem re-renders → useSortable inside builds a fresh pan gesture
// every render → SortableHandle's useEffect unregisters/re-registers each cycle. We split out
// the row so memo can short-circuit when only sortableProps' identity changed but its fields
// (all stable shared-value refs except itemsCount) are equivalent.
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
  expanded,
  onToggleExpanded,
}: SortablePhoneRowProps) {
  const handleToggle = useCallback(() => onToggleExpanded(item.id), [item.id, onToggleExpanded])
  return (
    <SortableItem
      data={item}
      {...sortableProps}
      containerHeight={SORTABLE_VIRTUAL_CONTAINER_HEIGHT}
      onMove={onMove}
      onDragStart={onDragStart}
    >
      <PhoneRowShell
        rowState={rowState}
        handlers={handlers}
        swatches={swatches}
        fallbackColor={fallbackColor}
        fallbackColorLabel={fallbackColorLabel}
        expanded={expanded}
        onToggleExpanded={handleToggle}
        dragHandle={
          <SortableItem.Handle>
            <View
              accessibilityRole="button"
              aria-label="Long-press to drag and reorder"
              style={dragHandleStaticStyle}
            >
              <Icon as={GripVertical} size="md" className="text-fg-muted" />
            </View>
          </SortableItem.Handle>
        }
      />
    </SortableItem>
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
  if (prev.expanded !== next.expanded) return false
  if (prev.onToggleExpanded !== next.onToggleExpanded) return false
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
