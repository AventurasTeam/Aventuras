import { useMemo, useRef } from 'react'
import type { View } from 'react-native'

import { useGlobalHotkey } from '@/hooks/use-global-hotkey'
import { matchesRailToggleShortcut } from '@/lib/reader-rail'
import { readerRailStore } from '@/lib/stores'

import { BrowseRail } from './browse-rail'
import { RailColumn } from './rail-column'
import { RailStrip } from './rail-strip'
import { useRailCollapse } from './use-rail-collapse'
import { railStripOf, type RailData } from './use-rail-data'
import { useRailPeek } from './use-rail-peek'

export type ReaderRailColumnProps = {
  data: RailData
  /** The reader screen's focus; a pushed-under reader must not answer the shortcut. */
  isFocused: boolean
}

export function ReaderRailColumn({ data, isFocused }: ReaderRailColumnProps) {
  const view = readerRailStore.useView()
  const { collapsed, setCollapsed } = useRailCollapse()
  const { openPeek } = useRailPeek()
  const strip = useMemo(() => railStripOf(data), [data])
  const collapseRef = useRef<View>(null)
  const expandRef = useRef<View>(null)
  // reader-composer.md: the shortcut toggles regardless of focus, a text field included. Capture
  // phase: RN-Web's TextInput stops every keydown from bubbling.
  useGlobalHotkey(matchesRailToggleShortcut, () => setCollapsed(!collapsed), {
    capture: true,
    enabled: isFocused,
  })

  return (
    <RailColumn
      collapsed={collapsed}
      expandedToggleRef={collapseRef}
      stripToggleRef={expandRef}
      expanded={
        <BrowseRail
          data={data}
          view={view}
          onViewChange={(next) => readerRailStore.setView(next)}
          onCategoryChange={(category) => readerRailStore.setCategory(category)}
          onRowPress={openPeek}
          onCollapse={() => setCollapsed(true)}
          collapseRef={collapseRef}
        />
      }
      strip={
        <RailStrip
          model={strip}
          expandRef={expandRef}
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
