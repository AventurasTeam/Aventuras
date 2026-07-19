'use dom'

import '@/global.css'

import type { DOMProps } from 'expo/dom'
import { useEffect, useRef } from 'react'

import { EntryCard } from '@/components/compounds/entry-card'
import { EntryWindow } from '@/components/reader/entry-window'
import type { StoryEntry } from '@/lib/db'
import { ThemeProvider } from '@/lib/themes'

// SPIKE — go/no-go evidence for the single-document reader pivot (one WebView
// hosting the existing web reader surface instead of a WebView per rich
// entry). Read-only: no streaming, editing, paging, or autoscroll host.
// Throwaway; retired by the pivot's design pass.

const noop = () => {}

const RESET_CSS = 'html,body{margin:0;height:100%;background:transparent}'

export default function ReaderDocumentSpike({
  rows,
  themeId,
  onFirstPaint,
}: {
  rows: StoryEntry[]
  themeId: string
  onFirstPaint: () => Promise<void>
  dom?: DOMProps
}) {
  const announcedRef = useRef(false)
  useEffect(() => {
    if (announcedRef.current) return
    announcedRef.current = true
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void onFirstPaint()
      })
    })
  }, [onFirstPaint])

  return (
    <ThemeProvider initialThemeId={themeId}>
      <style>{RESET_CSS}</style>
      {/* eslint-disable-next-line react-native/no-inline-styles -- plain DOM div in a 'use dom' document, not an RN view */}
      <div style={{ height: '100vh' }}>
        <EntryWindow
          rows={rows}
          renderRow={(row: StoryEntry) => (
            // eslint-disable-next-line react-native/no-inline-styles -- plain DOM div in a 'use dom' document, not an RN view
            <div style={{ maxWidth: 860, margin: '0 auto', width: '100%', padding: '8px 28px' }}>
              <EntryCard
                kind={row.kind}
                content={row.content}
                entryId={row.id}
                meta={row.metadata ?? undefined}
                reasoning={row.metadata?.reasoning}
              />
            </div>
          )}
          onNearTop={noop}
          onNearBottomChange={noop}
          onScrollPositionChange={noop}
        />
      </div>
    </ThemeProvider>
  )
}
