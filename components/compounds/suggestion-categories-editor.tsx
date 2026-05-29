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
import { useDensity } from '@/lib/density'
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
// Cover the lib's post-gesture withSpring settle (~300ms) so the dropped row stays on top.
const DROP_HOLD_MS = 350
// First-frame estimates only — actual heights measured via handleLayout. Derived from
// --row-py-lg + drag handle padding + grip icon size; retune if any of those change.
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
    <View className={stacked ? 'flex-col gap-1' : 'min-h-control-md justify-center'}>
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
      <View className={cn('flex-1 flex-col', stacked ? 'gap-3' : 'gap-2')}>
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
  // Raw <button>: dnd-kit's listeners need to spread onto the DOM element. IconAction's
  // wrapper drops them.
  const dragHandle = (
    <button
      type="button"
      aria-label="Drag to reorder"
      {...listeners}
      {...attributes}
      disabled={disabled}
      className="cursor-grab self-start rounded-sm p-2 text-fg-muted hover:text-fg-primary active:cursor-grabbing disabled:cursor-default disabled:opacity-50"
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
  // Split on platform, not tier: WebList uses dnd-kit + DOM elements that crash on native,
  // so any native runtime (including tablets) must take the PhoneList path.
  const isNative = Platform.OS !== 'web'

  const duplicateIds = useMemo(() => findDuplicateLabelIds(categories), [categories])

  // Ref so handlers stay stable across keystrokes — otherwise they re-create on every
  // categories change and defeat memo(RowContent)/memo(SortablePhoneRow).
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
    <Button variant="ghost" onPress={handleAdd} disabled={disabled} aria-label="Add category">
      <Text>+ Add category</Text>
    </Button>
  )

  return (
    <View className={cn('flex-col gap-2', className)} style={disabled ? DIMMED_STYLE : undefined}>
      {isNative ? (
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

// Inlined react-native-reanimated-dnd's internal listToObject (not re-exported).
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

  const prevIdsRef = useRef<Set<string>>(new Set(categories.map((c) => c.id)))
  useEffect(() => {
    const currentIds = new Set(categories.map((c) => c.id))
    const newIds: string[] = []
    for (const id of currentIds) {
      if (!prevIdsRef.current.has(id)) newIds.push(id)
    }
    prevIdsRef.current = currentIds
    setExpandedIds((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const id of prev) {
        if (!currentIds.has(id)) {
          next.delete(id)
          changed = true
        }
      }
      if (newIds.length === 1 && !next.has(newIds[0]!)) {
        next.add(newIds[0]!)
        changed = true
      }
      return changed ? next : prev
    })
  }, [categories])

  const density = useDensity()
  const sortableList = useSortableList<SuggestionCategory>({
    data: categories,
    enableDynamicHeights: true,
    estimatedItemHeight: COLLAPSED_ROW_HEIGHT_BY_DENSITY[density.resolved],
    itemKeyExtractor: (item) => item.id,
  })

  const positionsSV = sortableList.positions
  const idSetSignature = useMemo(() => categories.map((c) => c.id).join('|'), [categories])
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

  // Ref via render so handleDrop reads the latest array when its scheduleOnRN callback runs.
  const categoriesRef = useRef(categories)
  categoriesRef.current = categories

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
  const handleDrop = useCallback(
    (_id: string, _finalPosition: number, allPositions?: { [id: string]: number }) => {
      if (dropTimerRef.current) clearTimeout(dropTimerRef.current)
      dropTimerRef.current = setTimeout(() => {
        setDraggedId(null)
        dropTimerRef.current = null
      }, DROP_HOLD_MS)
      if (!allPositions) return
      const current = categoriesRef.current
      const next: SuggestionCategory[] = new Array(current.length)
      let placed = 0
      for (const c of current) {
        const pos = allPositions[c.id]
        if (typeof pos !== 'number' || pos < 0 || pos >= current.length) return
        if (next[pos] !== undefined) return
        next[pos] = c
        placed++
      }
      if (placed !== current.length) return
      let changed = false
      for (let i = 0; i < current.length; i++) {
        if (next[i]!.id !== current[i]!.id) {
          changed = true
          break
        }
      }
      if (!changed) return
      onReorder(next as SuggestionCategory[])
    },
    [onReorder],
  )

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

// ~infinite viewport so the lib's internal auto-scroll never engages (editor lives in a host
// ScrollView). Not MAX_SAFE_INTEGER because the lib does arithmetic on this value.
const SORTABLE_VIRTUAL_CONTAINER_HEIGHT = 9999

type SortablePhoneRowProps = {
  item: SuggestionCategory
  sortableProps: ReturnType<ReturnType<typeof useSortableList<SuggestionCategory>>['getItemProps']>
  rowState: RowState
  handlers: RowHandlers
  swatches: ColorValue[]
  fallbackColor: ColorValue
  fallbackColorLabel: string
  onDragStart: (id: string) => void
  onDrop: (id: string, position: number, allPositions?: { [id: string]: number }) => void
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
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !!disabled }}
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

// Keep in sync with SortablePhoneRowProps — missed fields fail open (silent staleness, no
// type error).
function sortablePhoneRowPropsEqual(prev: SortablePhoneRowProps, next: SortablePhoneRowProps) {
  if (prev.item !== next.item) return false
  if (prev.rowState !== next.rowState) return false
  if (prev.handlers !== next.handlers) return false
  if (prev.swatches !== next.swatches) return false
  if (prev.fallbackColor !== next.fallbackColor) return false
  if (prev.fallbackColorLabel !== next.fallbackColorLabel) return false
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
