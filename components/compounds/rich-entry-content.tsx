import { useEffect, useMemo, useRef } from 'react'

import { sanitizeRichHtml } from '@/lib/markdown'

import type { RichEntryContentProps } from './rich-entry-content.types'

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

  return <div ref={hostRef} />
}
