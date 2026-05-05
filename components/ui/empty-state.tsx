import * as React from 'react'
import { View, type ViewProps } from 'react-native'

import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

/**
 * EmptyState — centered placeholder for zero-row scopes.
 *
 * Per [lists.md → Empty list / table state](../../docs/ui/patterns/lists.md#empty-list--table-state):
 * title + optional sub-text, centered. **No CTA inside the
 * placeholder** — the host surface (toolbar, footer +New button,
 * etc.) already exposes the affordance and the placeholder
 * intentionally doesn't duplicate it.
 *
 * The component centers its block horizontally; consumers add
 * `flex-1` (or fixed height) on the parent or via `className` to
 * fill a list-pane body. For the table-tab "empty row" shape, drop
 * the centering padding by overriding `className` and let the row
 * area own the layout.
 *
 * `subtext` accepts a `ReactNode` so consumers can inline bold
 * markers like `+ Add` (per the canonical sub-text wording) without
 * needing a richer contract.
 */
type EmptyStateProps = ViewProps & {
  /** Single-sentence title. Kind-specific (e.g. "No threads on this branch yet."). */
  title: string
  /**
   * Optional sub-text. Names the typical author of these rows.
   * Accepts a `ReactNode` so consumers can include inline bold
   * (e.g. wrapping `+ Add` in `<Text className="font-medium">`).
   */
  subtext?: React.ReactNode
  className?: string
}

export function EmptyState({ title, subtext, className, ...props }: EmptyStateProps) {
  return (
    <View
      accessibilityRole="text"
      className={cn('items-center justify-center px-6 py-12', className)}
      {...props}
    >
      <Text className="text-center text-base font-medium text-fg-primary">{title}</Text>
      {subtext && (
        <Text className="mt-2 max-w-md text-center text-sm text-fg-secondary">{subtext}</Text>
      )}
    </View>
  )
}

export type { EmptyStateProps }
