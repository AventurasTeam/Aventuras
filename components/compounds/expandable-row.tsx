import { ChevronDown, Trash2 } from 'lucide-react-native'
import { useEffect, useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'

import { Icon } from '@/components/ui/icon'
import { IconAction } from '@/components/ui/icon-action'
import { cn } from '@/lib/utils'

const CARET_FLIPPED = { transform: [{ rotate: '180deg' }] } as const

/**
 * Expand-state machinery for id-keyed editable row lists.
 * Prunes ids whose rows disappeared — a stale id would re-expand a recycled
 * row (no-harmless-id-leaks.md). Pruning ONLY: new-id auto-expand belongs to
 * the caller's add handler via `expandAdded`, so a hydrated resume or an
 * import batch never pops an editor open unasked.
 */
export function useRowExpansion(rows: readonly { id: string }[]): {
  expanded: ReadonlySet<string>
  toggle: (id: string) => void
  expandAdded: (id: string) => void
} {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    const currentIds = new Set(rows.map((r) => r.id))
    setExpanded((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const id of prev) {
        if (!currentIds.has(id)) {
          next.delete(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [rows])

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Must run in the same commit as the row's insertion into `rows` — it works
  // in wizard callers only because their add mutators commit synchronously.
  // An async add would have this id pruned on the next unrelated `rows`
  // change (the effect above sees no matching row yet) and render collapsed.
  function expandAdded(id: string) {
    setExpanded((prev) => new Set(prev).add(id))
  }

  return { expanded, toggle, expandAdded }
}

export type ExpandableRowProps = {
  /** Visual only — swaps the border to `border-danger`. Sets no `aria-invalid`; that's each field's own job. */
  invalid: boolean
  expanded: boolean
  onToggle: () => void
  onRemove: () => void
  removeLabel: string
  expandLabel: string
  collapseLabel: string
  /** Compact summary content (title line, preview, chips, inline errors). */
  compact: ReactNode
  /** Inline editor body, rendered only while expanded. */
  editor: ReactNode
  /** Extra compact-row action (e.g. a compact secondary action), left of remove. */
  compactAction?: ReactNode
}

/** Bordered row chrome: row-wide expand Pressable, remove action, aria-hidden caret. */
export function ExpandableRow({
  invalid,
  expanded,
  onToggle,
  onRemove,
  removeLabel,
  expandLabel,
  collapseLabel,
  compact,
  editor,
  compactAction,
}: ExpandableRowProps) {
  return (
    <View
      className={cn('rounded-md border bg-bg-base', invalid ? 'border-danger' : 'border-border')}
    >
      <View className="flex-row items-start gap-1">
        <Pressable
          accessibilityRole="button"
          aria-expanded={expanded}
          aria-label={expanded ? collapseLabel : expandLabel}
          onPress={onToggle}
          className="flex-1 flex-row items-start gap-2 py-row-y-lg pl-3"
        >
          <View className="min-w-0 flex-1 gap-1">{compact}</View>
        </Pressable>
        <View className="flex-row items-start gap-1 pr-3 pt-row-y-lg">
          {compactAction}
          <IconAction
            icon={Trash2}
            label={removeLabel}
            size="sm"
            variant="destructive"
            onPress={onRemove}
          />
          {/* Redundant pointer affordance for the row-wide Pressable above, which
              stays the single control assistive tech sees — two buttons carrying
              one action would read as a duplicate. RN derives both platforms'
              hiding from `aria-hidden` alone. The flip is a plain RN transform:
              it must reach neither react-native-svg (which can't resolve it) nor
              NativeWind (whose native output for it is unverified here). */}
          <Pressable
            aria-hidden
            focusable={false}
            onPress={onToggle}
            className="h-icon-action-sm w-icon-action-sm items-center justify-center"
          >
            <View style={expanded ? CARET_FLIPPED : undefined}>
              <Icon as={ChevronDown} size="sm" className="text-fg-muted" />
            </View>
          </Pressable>
        </View>
      </View>
      {expanded ? <View className="gap-4 px-3 pb-3">{editor}</View> : null}
    </View>
  )
}
