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
import { GripVertical, Trash2 } from 'lucide-react-native'
import { memo, useCallback, useMemo, type CSSProperties, type ReactNode } from 'react'
import { Platform, Pressable, View } from 'react-native'
import DraggableFlatList, {
  ScaleDecorator,
  type RenderItemParams,
} from 'react-native-draggable-flatlist'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
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
// 180px ≈ 4 lines of monospace at the textarea's default size. Lets the prompt
// hint breathe without dominating the row; user can still scroll if longer.
const PROMPT_HINT_MIN_HEIGHT = 80

// Case-insensitive uniqueness check. Returns the set of category ids whose
// label collides with another row's label. Empty labels are NOT flagged here
// (the non-empty rule surfaces as its own per-row error).
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
  // Cheap unique enough for in-session UI; host overrides with cuid / nanoid
  // when persisted ids matter beyond the editor's lifetime.
  return `cat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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
    // `stacked` flips the inner editor from a side-by-side label/color row
    // into a vertical column. Phones can't fit ColorPicker's 8+ swatches next
    // to a flex-1 Input on a 360-400px width, so the Accordion-expanded
    // version always passes `stacked: true`.
    stacked: boolean
  }

// The inner editor body — used by both the desktop horizontal row and the phone
// Accordion expanded panel. Inputs and Textarea uncontrolled-from-outside per
// the host's controlled `categories` prop; debouncing / save-session lives in
// the host. Empty-label + duplicate-label errors surface inline below the
// label input.
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
  // Last-row delete is allowed (zero-state is recoverable via + Add category);
  // showing the count keeps the contract visible.
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
      <View className="pt-2">
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
      <View className="pt-1">
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

// Web: @dnd-kit/sortable item wrapper. Reads sortable transform/transition and
// applies the standard reorder visual. Keyboard sensor uses
// sortableKeyboardCoordinates so Space / arrow keys reorder accessibly.
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
      // Spread sortable's listeners/attributes onto the handle so only the
      // handle picks up gestures; the row body stays interactive (Input,
      // Switch, ColorPicker, Textarea can be focused and edited freely).
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

// Phone: collapsed Accordion-item header summarizes the category (enabled
// state, color dot, label). Expanded panel renders the same RowContent
// (without the drag handle — long-press drag is owned by the FlatList wrap).
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

function dotColorStyle(color: string) {
  return { backgroundColor: color }
}

function PhoneAccordionRow({
  rowState,
  handlers,
  swatches,
  fallbackColor,
  fallbackColorLabel,
  disabled,
  dragHandleProps,
}: {
  rowState: RowState
  handlers: RowHandlers
  swatches: ColorValue[]
  fallbackColor: ColorValue
  fallbackColorLabel: string
  disabled?: boolean
  dragHandleProps?: {
    onLongPress: () => void
  }
}) {
  return (
    <AccordionItem value={rowState.category.id}>
      <View className="flex-row items-center gap-1">
        {/* Long-press anywhere on the drag handle picks up the row in
            DraggableFlatList; releases on touch-up. Keeps reorder distinct
            from the Accordion's tap-to-expand. p-3 + size="md" + hitSlop=8
            gives a ≥44px touch target (iOS HIG / Material minimum) so the
            handle is reliably grabbable on phone. */}
        <Pressable
          onLongPress={dragHandleProps?.onLongPress}
          accessibilityRole="button"
          aria-label="Long-press to drag and reorder"
          disabled={disabled}
          hitSlop={8}
          className="p-3"
        >
          <Icon as={GripVertical} size="md" className="text-fg-muted" />
        </Pressable>
        <View className="flex-1">
          <AccordionTrigger>
            <PhoneRowSummary
              category={rowState.category}
              duplicateLabel={rowState.duplicateLabel}
              emptyLabel={rowState.emptyLabel}
              fallbackColor={fallbackColor}
            />
          </AccordionTrigger>
        </View>
      </View>
      <AccordionContent>
        <View className="px-3 pb-3">
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
      </AccordionContent>
    </AccordionItem>
  )
}

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
    <View className={cn('flex-col gap-2', disabled && 'opacity-50', className)}>
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

type ListProps = {
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
}: ListProps) {
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

function PhoneList({
  rowStates,
  handlers,
  swatches,
  fallbackColor,
  fallbackColorLabel,
  disabled,
  onReorder,
  categories,
}: ListProps) {
  // Accordion runs in single-open mode; reorder collapses the open row to keep
  // long-press drag from competing with a textarea inside an expanded panel.
  const handleDragEnd = useCallback(
    ({ from, to }: { from: number; to: number }) => {
      if (from === to) return
      onReorder(arrayMove(categories, from, to))
    },
    [categories, onReorder],
  )

  return (
    <Accordion type="single" collapsible>
      <DraggableFlatList
        data={rowStates}
        keyExtractor={(rowState) => rowState.category.id}
        onDragEnd={handleDragEnd}
        activationDistance={20}
        renderItem={({ item, drag }: RenderItemParams<RowState>) => (
          <ScaleDecorator>
            <PhoneAccordionRow
              rowState={item}
              handlers={handlers}
              swatches={swatches}
              fallbackColor={fallbackColor}
              fallbackColorLabel={fallbackColorLabel}
              disabled={disabled}
              dragHandleProps={{ onLongPress: drag }}
            />
          </ScaleDecorator>
        )}
      />
    </Accordion>
  )
}

export { SuggestionCategoriesEditor }
export type { SuggestionCategory, SuggestionCategoriesEditorProps }
