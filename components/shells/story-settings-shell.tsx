import { type ReactElement, type ReactNode } from 'react'
import { Platform, Pressable, ScrollView, View } from 'react-native'

import { MasterDetailLayout } from '@/components/shells/master-detail-layout'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

const STORY_SETTINGS_RAIL_WIDTH = 240

type RailTab<TId extends string> = { id: TId; label: string }
type RailGroup<TId extends string> = {
  id: string
  header: string
  tabs: readonly RailTab<TId>[]
}

type StorySettingsShellProps<TId extends string, TPanelData> = {
  groups: readonly RailGroup<TId>[]
  activeTab: TId | null
  onSelectTab: (id: TId) => void
  /**
   * Everything the panels read, resolved once by the owner. Threaded
   * through so a panel takes its data from the surface that owns the
   * screen rather than reaching into a store whose readiness it can't
   * see.
   */
  panelData: TPanelData
  /**
   * Renders one tab's panel. Called for EVERY tab in `groups`, not
   * just the active one — every panel stays mounted and inactive
   * ones are hidden, so a section's draft survives a tab switch.
   * Unmounting would unpublish the section's dirty fields and
   * silently discard its edits, which the one-session-per-surface
   * contract forbids.
   *
   * Returns an element, not a `ReactNode`: a `switch` over the tab union that
   * misses a case would otherwise return `undefined` and compile.
   */
  renderPanel: (id: TId, data: TPanelData) => ReactElement
  /** Rendered at the bottom of the detail pane, outside the panel scroller. */
  saveBar?: ReactNode
}

export function StorySettingsShell<TId extends string, TPanelData>({
  groups,
  activeTab,
  onSelectTab,
  panelData,
  renderPanel,
  saveBar,
}: StorySettingsShellProps<TId, TPanelData>) {
  const tabIds = groups.flatMap((group) => group.tabs.map((tab) => tab.id))

  const rail = (
    <ScrollView
      accessibilityRole="tablist"
      className="flex-1"
      contentContainerClassName="gap-3 p-3"
    >
      {groups.map((group) => (
        <View key={group.id} className="gap-1">
          <Text variant="muted" size="xs" className="px-row-x-md uppercase">
            {group.header}
          </Text>
          {group.tabs.map((tab) => {
            const selected = tab.id === activeTab
            return (
              <Pressable
                key={tab.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                // RN-Web doesn't map accessibilityState.selected to
                // aria-selected, so AT reports every tab unselected without it.
                aria-selected={selected}
                onPress={() => onSelectTab(tab.id)}
                className={cn(
                  'rounded-md px-row-x-md py-row-y-md',
                  selected ? 'bg-tint-press' : Platform.select({ web: 'hover:bg-tint-hover' }),
                )}
              >
                <Text className={selected ? 'font-medium text-fg-primary' : 'text-fg-secondary'}>
                  {tab.label}
                </Text>
              </Pressable>
            )
          })}
        </View>
      ))}
    </ScrollView>
  )

  const detailPane = (
    <View className="min-h-0 flex-1">
      {tabIds.map((id) => (
        <View key={id} className={cn('min-h-0 flex-1', id !== activeTab && 'hidden')}>
          <ScrollView className="flex-1" contentContainerClassName="gap-4 p-4">
            {renderPanel(id, panelData)}
          </ScrollView>
        </View>
      ))}
      {/* Outside the scroller — see docs/ui/patterns/save-sessions.md → Positioning. */}
      {saveBar}
    </View>
  )

  return (
    <MasterDetailLayout
      isRowSelected={activeTab != null}
      listPaneWidth={STORY_SETTINGS_RAIL_WIDTH}
      listPane={rail}
      detailPane={detailPane}
    />
  )
}

export { STORY_SETTINGS_RAIL_WIDTH }
export type { RailGroup, RailTab, StorySettingsShellProps }
