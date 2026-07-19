'use dom'

import '@/global.css'

import type { DOMProps } from 'expo/dom'
import { useEffect, useLayoutEffect, useRef } from 'react'

import { EntryCard } from '@/components/compounds/entry-card'
import type { StoryEntry } from '@/lib/db'
import { ThemeProvider } from '@/lib/themes'

// SPIKE — go/no-go evidence for the single-document reader pivot (one WebView
// hosting the web reader surface instead of a WebView per rich entry).
// Read-only: no streaming, editing, paging, or autoscroll host.
//
// Deliberately NOT the shared EntryWindow: JS virtualizers correct estimated
// offsets by writing scrollTop mid-scroll, which stutters touch flings (spike
// finding). Here rows are plain flow + `content-visibility: auto`, so the
// engine culls off-screen cards and anchors scroll natively — the document
// reader's candidate virtualization strategy.
//
// Throwaway; retired by the pivot's design pass.

const RESET_CSS =
  'html,body{margin:0;height:100%;background:transparent}' +
  '.spike-scroll{position:fixed;inset:0;overflow-y:auto}' +
  '.spike-row{content-visibility:auto;contain-intrinsic-size:auto 160px;max-width:860px;margin:0 auto;padding:8px 28px}'

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
  const scrollRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el != null) el.scrollTop = el.scrollHeight
  }, [rows])

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
      <div ref={scrollRef} className="spike-scroll">
        {rows.map((row) => (
          <div key={row.id} className="spike-row">
            <EntryCard
              kind={row.kind}
              content={row.content}
              entryId={row.id}
              meta={row.metadata ?? undefined}
              reasoning={row.metadata?.reasoning}
            />
          </div>
        ))}
      </div>
    </ThemeProvider>
  )
}
