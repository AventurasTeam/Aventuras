import { type ReactNode } from 'react'
import { View } from 'react-native'

import { useTier } from '@/hooks/use-tier'
import { cn } from '@/lib/utils'

type MasterDetailLayoutProps = {
  /**
   * Master pane content — typically
   * [`<EntityListPane>`](./entity-list-pane.tsx). Always rendered on
   * tablet / desktop (visible in the left column). On phone: visible
   * when `isRowSelected` is false (list-first state).
   */
  listPane: ReactNode

  /**
   * Detail pane content — typically
   * [`<DetailPane>`](./detail-pane.tsx). Always rendered on tablet /
   * desktop (visible in the right column). On phone: visible when
   * `isRowSelected` is true (full-screen route within the surface).
   */
  detailPane: ReactNode

  /**
   * Whether a row is currently selected. Drives phone tier
   * rendering:
   *
   * - `false` → render `listPane` (list-first state)
   * - `true`  → render `detailPane` (detail route)
   */
  isRowSelected: boolean

  /**
   * Optional sub-header content rendered ABOVE both panes.
   * Consumer passes a BreadcrumbTitle-like ReactNode
   * (e.g. `Characters / Kael`,  `Threads / Crown's bargain`). On
   * phone in list-first state consumers typically show just the
   * kind segment since no row is selected. Render is gated on
   * `subHeader != null` — when omitted, the panes start at the top.
   */
  subHeader?: ReactNode

  /**
   * List pane width on tablet / desktop. Defaults to 340 px.
   * Override only if a surface has a different width constraint.
   * Ignored on phone (panes are full-width there).
   */
  listPaneWidth?: number

  className?: string
}

const DEFAULT_LIST_PANE_WIDTH = 340

export function MasterDetailLayout({
  listPane,
  detailPane,
  isRowSelected,
  subHeader,
  listPaneWidth = DEFAULT_LIST_PANE_WIDTH,
  className,
}: MasterDetailLayoutProps) {
  const tier = useTier()
  const isPhone = tier === 'phone'

  const showListOnPhone = !isRowSelected
  const showDetailOnPhone = isRowSelected

  return (
    <View className={cn('flex-1 flex-col bg-bg-base', className)}>
      {subHeader != null ? (
        <View className="flex-row items-center border-b border-border bg-bg-base px-row-x-md py-row-y-sm">
          {subHeader}
        </View>
      ) : null}

      <View className={cn('min-h-0 flex-1', isPhone ? 'flex-col' : 'flex-row')}>
        <View
          style={!isPhone ? { width: listPaneWidth } : undefined}
          className={cn(
            'flex-col',
            isPhone ? 'min-h-0 flex-1' : 'min-h-0 flex-none',
            isPhone && !showListOnPhone && 'hidden',
          )}
        >
          {listPane}
        </View>

        <View
          className={cn(
            'flex-col',
            isPhone ? 'min-h-0 flex-1' : 'min-h-0 min-w-0 flex-1 border-l border-border',
            isPhone && !showDetailOnPhone && 'hidden',
          )}
        >
          {detailPane}
        </View>
      </View>
    </View>
  )
}

export type { MasterDetailLayoutProps }
