import { type ReactNode } from 'react'
import { Platform, Pressable, ScrollView, View } from 'react-native'

import { MasterDetailLayout } from '@/components/shells/master-detail-layout'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

const STORY_SETTINGS_RAIL_WIDTH = 240

type RailTab<TId extends string> = { id: TId; label: string }
type RailGroup<TId extends string> = { id: string; header: string; tabs: RailTab<TId>[] }

type StorySettingsShellProps<TId extends string> = {
  groups: RailGroup<TId>[]
  activeTab: TId | null
  onSelectTab: (id: TId) => void
  /**
   * Renders one tab's panel. Called for EVERY tab in `groups`, not
   * just the active one — every panel stays mounted and inactive
   * ones are hidden, so a section's draft survives a tab switch.
   * Unmounting would unpublish the section's dirty fields and
   * silently discard its edits, which the one-session-per-surface
   * contract forbids.
   */
  renderPanel: (id: TId) => ReactNode
  /** Mounted by the route only while the session is dirty. */
  saveBar?: ReactNode
}

export function StorySettingsShell<TId extends string>({
  groups,
  activeTab,
  onSelectTab,
  renderPanel,
  saveBar,
}: StorySettingsShellProps<TId>) {
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
                // RN-Web doesn't derive aria-selected from accessibilityState,
                // and role="tab" without it is an axe violation.
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
            {renderPanel(id)}
          </ScrollView>
        </View>
      ))}
      {/* Outside the scroller: the pattern anchors the bar to the pane bottom as a flex item, not a sticky overlay. */}
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
