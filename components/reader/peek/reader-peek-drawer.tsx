import { useEffect } from 'react'

import { useRailCollapse } from '@/components/reader/rail/use-rail-collapse'
import type { RailData } from '@/components/reader/rail/use-rail-data'
import { useRailPeek } from '@/components/reader/rail/use-rail-peek'

import { PeekDrawer } from './peek-drawer'

export type ReaderPeekDrawerProps = {
  data: RailData
  isFocused: boolean
  storyId: string | null
  blocked: boolean
  blockedReason: string | undefined
  /** Routes after the peek has closed. */
  onNavigate: (href: string) => void
}

/** The reader's desktop / tablet peek over `readerRailStore`'s `display.peek`. */
export function ReaderPeekDrawer({
  data,
  isFocused,
  storyId,
  blocked,
  blockedReason,
  onNavigate,
}: ReaderPeekDrawerProps) {
  const { peek, closePeek } = useRailPeek()
  const { collapsed } = useRailCollapse()

  // Peek implies rail open. The reducer closes the peek on every collapse it sees; a preference
  // flipped outside it (a settings import) would otherwise leave one to resurface on the next expand.
  useEffect(() => {
    if (collapsed && peek != null) closePeek()
  }, [collapsed, peek, closePeek])

  return (
    <PeekDrawer
      data={data}
      visible={isFocused && !collapsed}
      peek={peek}
      storyId={storyId}
      blocked={blocked}
      blockedReason={blockedReason}
      onClose={closePeek}
      onOpenInPanel={(href) => {
        // layout.md → Stacking: dismiss first, then navigate.
        closePeek()
        onNavigate(href)
      }}
    />
  )
}
