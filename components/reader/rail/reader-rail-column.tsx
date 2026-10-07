import { useMemo } from 'react'

import { useGlobalHotkey } from '@/hooks/use-global-hotkey'
import { matchesRailToggleShortcut, type RailCategory } from '@/lib/reader-rail'
import { readerRailStore } from '@/lib/stores'

import { BrowseRail } from './browse-rail'
import { RailColumn } from './rail-column'
import { RailStrip } from './rail-strip'
import { useRailCollapse } from './use-rail-collapse'
import { railStripOf, type RailData } from './use-rail-data'

export type ReaderRailColumnProps = {
  data: RailData
  /** The reader screen's focus; a pushed-under reader must not answer the shortcut. */
  isFocused: boolean
  onRowPress: (category: RailCategory, id: string) => void
}

export function ReaderRailColumn({ data, isFocused, onRowPress }: ReaderRailColumnProps) {
  const view = readerRailStore.useView()
  const { collapsed, setCollapsed } = useRailCollapse()
  const strip = useMemo(() => railStripOf(data), [data])
  // reader-composer.md: the shortcut toggles regardless of focus, a text field included. Capture
  // phase: RN-Web's TextInput stops every keydown from bubbling.
  useGlobalHotkey(matchesRailToggleShortcut, () => setCollapsed(!collapsed), {
    capture: true,
    enabled: isFocused,
  })

  return (
    <RailColumn
      collapsed={collapsed}
      expanded={
        <BrowseRail
          data={data}
          view={view}
          onViewChange={(next) => readerRailStore.setView(next)}
          onCategoryChange={(category) => readerRailStore.setCategory(category)}
          onRowPress={onRowPress}
          onCollapse={() => setCollapsed(true)}
        />
      }
      strip={
        <RailStrip
          model={strip}
          onExpand={() => setCollapsed(false)}
          onExpandTo={(category) => {
            readerRailStore.setCategory(category)
            setCollapsed(false)
          }}
        />
      }
    />
  )
}
