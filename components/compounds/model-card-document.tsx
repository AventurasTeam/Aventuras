'use dom'

import '@/global.css'

import { type DOMProps } from 'expo/dom'
import { useEffect, type MouseEvent } from 'react'

import { renderDocumentHtml } from '@/lib/markdown'
import { ThemeProvider, useTheme } from '@/lib/themes'

// Model cards are markdown with embedded HTML (tables, badges); rendering them
// needs a real web document, so this follows the reader's 'use dom' pattern —
// WebView on native, inline on web. Sanitization runs through the shared
// lib/markdown pipeline (this file always compiles as a web bundle, so the
// real DOMPurify path applies on every platform).

// Reset only inside the WebView — on web this component renders inline in the
// page and a html/body reset would leak into the app document.
const WEBVIEW_RESET_CSS = 'html,body{margin:0;height:100%;background:transparent}'

const DOC_CSS =
  '.model-card-doc{height:100%;overflow-y:auto;padding:12px;font-size:13px;line-height:1.6;color:var(--fg-primary)}' +
  '.model-card-doc h1,.model-card-doc h2,.model-card-doc h3{font-size:1.1em;margin:0.8em 0 0.4em}' +
  '.model-card-doc p,.model-card-doc ul,.model-card-doc ol{margin:0.5em 0}' +
  '.model-card-doc table{border-collapse:collapse;display:block;max-width:100%;overflow-x:auto;margin:0.6em 0}' +
  '.model-card-doc th,.model-card-doc td{border:1px solid var(--border);padding:4px 8px;text-align:left}' +
  '.model-card-doc th{background:var(--bg-raised)}' +
  '.model-card-doc pre{overflow-x:auto;background:var(--bg-raised);padding:8px;border-radius:4px}' +
  '.model-card-doc code{font-family:monospace;font-size:0.9em}' +
  '.model-card-doc img{max-width:100%}' +
  '.model-card-doc a{color:var(--accent);text-decoration:underline}'

// ThemeProvider seeds from initialThemeId at mount only; re-apply later
// switches as prop updates, mirroring the reader document.
function ThemeSync({ themeId }: { themeId: string }) {
  const { setTheme } = useTheme()
  useEffect(() => {
    setTheme(themeId)
  }, [setTheme, themeId])
  return null
}

function DocBody({
  markdown,
  linkBase,
  onOpenLink,
  onFirstPaint,
}: {
  markdown: string
  linkBase: string
  onOpenLink?: (url: string) => void
  onFirstPaint?: () => void
}) {
  // Signals the host to drop its loading overlay — on native the WebView takes
  // seconds to boot its bundle, and until this fires the region is blank.
  useEffect(() => {
    const frame = requestAnimationFrame(() => onFirstPaint?.())
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once, at first paint
  }, [])

  // Anchors survive sanitize (only navigation event-handlers are stripped);
  // clicks route to the host so links open externally instead of navigating
  // the WebView / the app page. Model cards use relative hrefs liberally
  // (/org/repo, ./file) — resolve against the model source, not the WebView's
  // local bundle URL, before handing the URL over.
  const handleClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest('a')
    if (anchor == null) return
    event.preventDefault()
    const href = anchor.getAttribute('href')
    if (href == null || onOpenLink == null) return
    try {
      onOpenLink(new URL(href, linkBase).href)
    } catch {
      // Unresolvable href (malformed) — drop the click.
    }
  }
  return (
    <>
      <style>{DOC_CSS}</style>
      <div
        className="model-card-doc"
        onClickCapture={handleClickCapture}
        dangerouslySetInnerHTML={{ __html: renderDocumentHtml(markdown) }}
      />
    </>
  )
}

export default function ModelCardDocument({
  markdown,
  themeId,
  hostIsWebView,
  linkBase,
  onOpenLink,
  onFirstPaint,
}: {
  markdown: string
  themeId: string
  /** True when hosted in a native WebView; gates the html/body reset + theme seeding. */
  hostIsWebView: boolean
  /** Base URL relative hrefs resolve against (the model's source page). */
  linkBase: string
  onOpenLink?: (url: string) => void
  onFirstPaint?: () => void
  dom?: DOMProps
}) {
  if (!hostIsWebView) {
    // Inline on web: the page already carries global.css theme vars.
    return (
      <DocBody
        markdown={markdown}
        linkBase={linkBase}
        onOpenLink={onOpenLink}
        onFirstPaint={onFirstPaint}
      />
    )
  }
  return (
    <ThemeProvider initialThemeId={themeId}>
      <ThemeSync themeId={themeId} />
      <style>{WEBVIEW_RESET_CSS}</style>
      <DocBody
        markdown={markdown}
        linkBase={linkBase}
        onOpenLink={onOpenLink}
        onFirstPaint={onFirstPaint}
      />
    </ThemeProvider>
  )
}
