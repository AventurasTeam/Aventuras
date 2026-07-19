'use dom'

import type { DOMProps } from 'expo/dom'
import { useEffect, useMemo, useRef } from 'react'

import { sanitizeRichHtml } from '@/lib/markdown'

const BASELINE_CSS =
  'body{margin:0;background:transparent;color:var(--fg-primary);font-family:system-ui,sans-serif;overflow-wrap:break-word}p{margin:4px 0}blockquote{border-left:2px solid var(--border);padding-left:8px;font-style:italic}code{font-family:monospace}img{max-width:100%}'

export default function RichEntryDocument({
  markedHtml,
  themeVars,
  mode,
  onReady,
}: {
  markedHtml: string
  themeVars: Record<string, string>
  mode: 'light' | 'dark'
  onReady: () => Promise<void>
  dom?: DOMProps
}) {
  // This file is bundled as a web bundle even on native, so the real
  // (postcss-backed) sanitizer resolves here — the WebView document is where
  // native rich content gets sanitized.
  const html = useMemo(() => sanitizeRichHtml(markedHtml), [markedHtml])

  useEffect(() => {
    for (const [key, value] of Object.entries(themeVars)) {
      document.documentElement.style.setProperty(key, value)
    }
    document.documentElement.style.colorScheme = mode
  }, [themeVars, mode])

  // Defense in depth behind the scrub: a scrub gap still cannot fetch.
  // Meta-CSP applies from insertion time — the already-loaded component bundle
  // keeps running. Dev is exempt (HMR needs its websocket).
  useEffect(() => {
    if (__DEV__) return
    const meta = document.createElement('meta')
    meta.httpEquiv = 'Content-Security-Policy'
    meta.content = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"
    document.head.appendChild(meta)
  }, [])

  const announcedRef = useRef(false)
  useEffect(() => {
    if (announcedRef.current) return
    announcedRef.current = true
    // Double rAF: the underlay swap must land after this document has painted.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void onReady()
      })
    })
  }, [onReady])

  return (
    <>
      <style>{BASELINE_CSS}</style>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </>
  )
}
