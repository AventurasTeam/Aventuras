import { useEffect, useMemo, useRef, type CSSProperties } from 'react'

import { sanitizeRichHtml } from '@/lib/markdown'

import type { RichEntryContentProps } from './rich-entry-content.types'

// Containment establishes the host as the containing block for position:fixed/
// absolute descendants and clips painting to its box — a rich entry can't lay a
// full-viewport overlay over app chrome (it renders inline in the main document
// on web/Electron). Layout containment also opens a stacking context, so an
// entry's z-index can't outrank app chrome.
const HOST_STYLE: CSSProperties = { contain: 'layout paint' }

// Mirrors global.css's .narrative-html baseline — document class selectors
// don't reach into a shadow tree, only inherited properties do. Entry styles
// come after, so provider CSS wins ties.
const BASELINE_CSS =
  'p{margin:4px 0}blockquote{border-left:2px solid var(--border);padding-left:8px;font-style:italic}code{font-family:var(--font-mono)}'

export function RichEntryContent({ markedHtml }: RichEntryContentProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const html = useMemo(() => sanitizeRichHtml(markedHtml), [markedHtml])

  useEffect(() => {
    const host = hostRef.current
    if (host == null) return
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>${BASELINE_CSS}</style>${html}`
  }, [html])

  return <div ref={hostRef} style={HOST_STYLE} />
}
