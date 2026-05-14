import * as React from 'react'
import { View } from 'react-native'

import { useTier } from '@/hooks/use-tier'
import { cn } from '@/lib/utils'

/**
 * MasterDetailLayout — tier-aware 2-pane shell for master-detail
 * surfaces (World, Plot). Sits inside the body region of a
 * [`ScreenShell`](./screen-shell.tsx) and arranges the master list
 * pane next to the detail pane.
 *
 * Owns:
 * - **Tier dispatch** via [`useTier()`](../../hooks/use-tier.ts).
 *   - tablet / desktop (≥ 640 px) → 2-pane side-by-side. List pane is
 *     `flex-none` at `listPaneWidth` (default 340 px per
 *     [`world.md → Layout`](../../docs/ui/screens/world/world.md#layout));
 *     detail pane is `flex-1` with `min-w-0` so its content can shrink.
 *     Vertical divider between panes (`border-l` on detail pane).
 *   - phone (< 640 px) → list-first. When `isRowSelected` is false the
 *     list pane fills the surface; when true the detail pane fills the
 *     surface (full-screen route within the surface). Both panes stay
 *     mounted regardless — only `display` toggles — so internal pane
 *     state (scroll position, composer draft, dirty save-session)
 *     survives every list ↔ detail transition per
 *     [`collapse.md → State preservation on reflow`](../../docs/ui/foundations/mobile/collapse.md#state-preservation-on-reflow).
 * - **Sub-header positioning** above the panes when `subHeader` is
 *   non-null. Thin horizontal strip with a bottom border. Consumer
 *   passes a BreadcrumbTitle-like ReactNode (e.g.,
 *   `Characters / Kael Vex`) per
 *   [`principles.md → Master-detail sub-header`](../../docs/ui/principles.md#master-detail-sub-header).
 *   Reactive content is consumer territory — the shell only positions
 *   the slot.
 *
 * Does NOT own:
 * - **Row selection state** — consumer's responsibility (router
 *   param, parent useState, etc.). Shell takes `isRowSelected` as a
 *   derived boolean.
 * - **Sub-header content** — segments, tap handlers, truncation popover,
 *   and the
 *   [Breadcrumb tappability](../../docs/ui/principles.md#breadcrumb-tappability)
 *   wiring all live in the consumer-rendered ReactNode.
 * - **Pane internals** — `listPane` and `detailPane` are opaque slots;
 *   shell never reaches inside them.
 * - **Cross-tier animation** — phone list ↔ detail transitions just
 *   toggle `display` for v1. The
 *   [collapse spec](../../docs/ui/foundations/mobile/collapse.md#two-pane-navigation-surfaces-world-plot-settings)
 *   describes a slide-in route; that's a polish pass (TODO).
 * - **Open-sheet auto-dismiss on tier transition** — session-7
 *   implementation guidance, not a shell contract clause.
 *
 * Spec: [`collapse.md`](../../docs/ui/foundations/mobile/collapse.md)
 * (tier behavior) +
 * [`layout.md`](../../docs/ui/foundations/mobile/layout.md) (2-pane
 * surface bindings) +
 * [`principles.md → Master-detail sub-header`](../../docs/ui/principles.md#master-detail-sub-header)
 * (sub-header placement).
 */

type MasterDetailLayoutProps = {
  /**
   * Master pane content — typically
   * [`<EntityListPane>`](./entity-list-pane.tsx). Always rendered on
   * tablet / desktop (visible in the left column). On phone: visible
   * when `isRowSelected` is false (list-first state).
   */
  listPane: React.ReactNode

  /**
   * Detail pane content — typically
   * [`<DetailPane>`](./detail-pane.tsx). Always rendered on tablet /
   * desktop (visible in the right column). On phone: visible when
   * `isRowSelected` is true (full-screen route within the surface).
   */
  detailPane: React.ReactNode

  /**
   * Whether a row is currently selected. Drives phone tier
   * rendering:
   *
   * - `false` → render `listPane` (list-first state)
   * - `true`  → render `detailPane` (detail route)
   *
   * On tablet / desktop, both panes are always visible side-by-side
   * and this prop is ignored.
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
  subHeader?: React.ReactNode

  /**
   * List pane width on tablet / desktop. Defaults to 340 px per
   * [`world.md → Layout`](../../docs/ui/screens/world/world.md#layout).
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

  // On phone, both panes stay mounted so internal state (scroll,
  // composer, dirty session) survives every list ↔ detail transition
  // per collapse.md → State preservation. We toggle display rather
  // than conditional-render. On tablet / desktop, both panes are
  // always visible side-by-side.
  //
  // TODO(polish): collapse.md mentions a slide-in animation for the
  // phone tier transition. v1 ships with an instant display toggle;
  // animation is a polish pass — likely a Reanimated shared element
  // or layout transition, scoped after the wider Reader-rail sheet
  // animation work in session 7.
  const showListOnPhone = !isRowSelected
  const showDetailOnPhone = isRowSelected

  return (
    <View className={cn('flex-1 flex-col bg-bg-base', className)}>
      {/* Sub-header strip — sits above the panes, below the parent
          ScreenShell's top-bar / chip-strip / progress-strip stack.
          Thin horizontal strip with its own bottom border separator
          per principles.md → Master-detail sub-header. Render is
          gated so the layout collapses cleanly when consumers omit
          the slot (e.g., surfaces that already carry the breadcrumb
          inline in the top bar). */}
      {subHeader != null ? (
        <View className="flex-row items-center border-b border-border bg-bg-base px-row-x-md py-row-y-sm">
          {subHeader}
        </View>
      ) : null}

      {/* Panes container — flex-row on tablet / desktop, single
          column on phone. min-h-0 + flex-1 lets the inner panes own
          their own vertical scroll without pushing the parent. */}
      <View className={cn('min-h-0 flex-1', isPhone ? 'flex-col' : 'flex-row')}>
        {/* List pane.
            - tablet / desktop: fixed width via inline style (Tailwind
              arbitrary classes can't be safely interpolated for
              consumer-overridable values).
            - phone: full-width, display toggled by isRowSelected. */}
        <View
          style={
            isPhone
              ? { display: showListOnPhone ? 'flex' : 'none' }
              : { width: listPaneWidth, flexGrow: 0, flexShrink: 0 }
          }
          className={cn(
            'flex-col',
            isPhone ? 'min-h-0 flex-1' : 'min-h-0',
            // On phone we want the visible pane to occupy the full
            // surface; on wide tiers the list is fixed-width and the
            // detail flexes.
          )}
        >
          {listPane}
        </View>

        {/* Detail pane.
            - tablet / desktop: flex-1 + min-w-0 so the body can
              shrink within the row; vertical divider on the left
              edge separates from the list pane.
            - phone: full-width, display toggled by isRowSelected.
              No divider on phone (panes never sit side-by-side). */}
        <View
          style={isPhone ? { display: showDetailOnPhone ? 'flex' : 'none' } : undefined}
          className={cn(
            'flex-col',
            isPhone ? 'min-h-0 flex-1' : 'min-h-0 min-w-0 flex-1 border-l border-border',
          )}
        >
          {detailPane}
        </View>
      </View>
    </View>
  )
}

export type { MasterDetailLayoutProps }
