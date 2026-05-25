import { Plus } from 'lucide-react-native'
import { type ReactNode } from 'react'
import { View } from 'react-native'

import { Toolbar, type ToolbarSearchProps } from '@/components/compounds/toolbar'
import { IconAction } from '@/components/ui/icon-action'
import { cn } from '@/lib/utils'

type EntityListPaneProps = {
  /**
   * Dropdown trigger ("Characters ▾", "Threads ▾").
   */
  kindSelector?: ReactNode

  /**
   * Right-anchored on the kind-selector row. Visual: minimalist `[+]`
   * icon-action
   */
  addAction: {
    label: string
    onPress: () => void
  }

  /**
   * Search state — forwarded to `Toolbar.Search`. Mirrors the
   * Toolbar primitive's prop
   */
  search: ToolbarSearchProps

  /**
   * Chip strip — consumer renders chips with their own active state.
   */
  filterChips: ReactNode

  /**
   * Optional sort control (lore list uses this). Position is handled
   * by `Toolbar` — pass a `Toolbar.Sort` element (or any ReactNode;
   * Toolbar tolerates pass-throughs).
   */
  sortControl?: ReactNode

  /**
   * The virtualized list — consumer renders rows. Shell wraps in a
   * scroll container with width pin.
   */
  children: ReactNode
  emptyState: ReactNode

  /**
   * Consumer derives. Shell uses this to switch list vs empty
   * rendering.
   */
  isEmpty: boolean

  className?: string
}

export function EntityListPane({
  kindSelector,
  addAction,
  search,
  filterChips,
  sortControl,
  children,
  emptyState,
  isEmpty,
  className,
}: EntityListPaneProps) {
  return (
    <View className={cn('w-full flex-1 flex-col gap-3 bg-bg-base p-3', className)}>
      <View className="flex-row items-center gap-2">
        <View className="min-w-0 flex-1">{kindSelector}</View>
        <IconAction icon={Plus} label={addAction.label} onPress={addAction.onPress} />
      </View>

      <Toolbar>
        <Toolbar.Search {...search} />
        <Toolbar.FilterChips>{filterChips}</Toolbar.FilterChips>
        {sortControl}
      </Toolbar>

      <View className="min-h-0 flex-1">{isEmpty ? emptyState : children}</View>
    </View>
  )
}

export type { EntityListPaneProps }
