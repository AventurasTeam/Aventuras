import { ChevronDown, Trash2 } from 'lucide-react-native'
import { useEffect, useState, type ReactNode } from 'react'
import { Pressable, View, type ViewProps } from 'react-native'

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
  /**
   * Compact summary content (title line, preview, chips, inline errors). Its
   * **first line** must be a control-height line box (`min-h-control-sm` plus
   * vertical centring): the action cluster centres on one, so a bare text line
   * leaves the summary sitting above the actions.
   */
  compact: ReactNode
  /** Inline editor body, rendered only while expanded. */
  editor: ReactNode
  /** Extra compact-row action (e.g. a compact secondary action), left of remove. */
  compactAction?: ReactNode
  /**
   * E2E scope anchor on the row container (docs/testing.md → Selector
   * strategy). Rows carry identical expand / remove / field names and several
   * can be open at once, so a locator has no other way to say "inside row X".
   * `testID` renders as `data-testid`; `dataSet` as hyphenated `data-*`.
   */
  testID?: string
  dataSet?: Record<string, string>
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
  testID,
  dataSet,
}: ExpandableRowProps) {
  return (
    <View
      // `dataSet` is RN-Web-only and absent from RN's ViewProps; native drops it.
      {...({ testID, dataSet } as ViewProps)}
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
        {/* Centred on a control-height line box: a Button-sized compact action
            beside 22px icon-actions parks their centres 7px apart if top-aligned,
            and the min-height holds the cluster on the summary's FIRST line. */}
        <View className="flex-row py-row-y-lg pr-3">
          {/* Inner element owns the line box: min-height is border-box, so on the
              padded element the padding absorbs it and icon-only clusters collapse. */}
          <View className="min-h-control-sm flex-row items-center gap-1">
            {compactAction}
            <IconAction
              icon={Trash2}
              label={removeLabel}
              size="sm"
              variant="destructive"
              onPress={onRemove}
            />
            {/* Pointer-only duplicate of the row-wide Pressable; `aria-hidden` leaves
              one control for assistive tech. The flip must stay a plain RN transform —
              react-native-svg can't resolve it, NativeWind's native output is unverified. */}
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
      </View>
      {expanded ? <View className="gap-4 px-3 pb-3">{editor}</View> : null}
    </View>
  )
}
