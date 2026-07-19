'use dom'

import '@/global.css'

import { useDOMImperativeHandle, type DOMImperativeFactory, type DOMProps } from 'expo/dom'
import { useCallback, useEffect, useRef, type MouseEvent, type Ref } from 'react'

import type {
  ReaderSurfaceHandle,
  ReaderSurfaceProps,
} from '@/components/reader/reader-document-types'
import { ReaderSurface } from '@/components/reader/reader-surface'
import { DensityProvider } from '@/lib/density'
import { ThemeProvider, useTheme } from '@/lib/themes'

export interface ReaderDocumentRef extends DOMImperativeFactory {
  jumpToBottom: () => void
}

type ReaderDocumentProps = ReaderSurfaceProps & {
  themeId: string
  /** Bumped by the host after onReady — forces a full prop re-emission. */
  syncNonce: number
  onReady: () => Promise<void>
  onFirstPaint: () => Promise<void>
  ref: Ref<ReaderDocumentRef>
  dom?: DOMProps
}

// .reader-doc-root claims the viewport explicitly: expo-dom's mount root is a
// flex container in which plain block elements collapse to zero width.
const RESET_CSS =
  'html,body{margin:0;height:100%;background:transparent}' +
  '.reader-doc-root{position:fixed;inset:0}'

// ThemeProvider seeds from initialThemeId at mount only; the document is
// long-lived, so later theme switches arrive as prop updates and re-apply here.
function ThemeSync({ themeId }: { themeId: string }) {
  const { setTheme } = useTheme()
  useEffect(() => {
    setTheme(themeId)
  }, [setTheme, themeId])
  return null
}

export default function ReaderDocument({
  themeId,
  syncNonce: _syncNonce,
  onReady,
  onFirstPaint,
  ref,
  ...surfaceProps
}: ReaderDocumentProps) {
  const surfaceRef = useRef<ReaderSurfaceHandle>(null)

  useDOMImperativeHandle(
    ref,
    () => ({
      jumpToBottom: () => surfaceRef.current?.jumpToBottom(),
    }),
    [],
  )

  // Defense in depth behind the sanitize story: inline styles, data: images,
  // and same-document resources only. Dev exempt (Metro/HMR needs network).
  useEffect(() => {
    if (__DEV__) return
    const meta = document.createElement('meta')
    meta.httpEquiv = 'Content-Security-Policy'
    meta.content =
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'self' data:"
    document.head.prepend(meta)
    return () => meta.remove()
  }, [])

  // Readiness handshake: fires once per document boot (first load AND every
  // recovery reload re-run this module). Prop emissions before this are lost.
  useEffect(() => {
    void onReady()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per boot; onReady identity churns across bridge re-emissions
  }, [])

  // First-paint signal: once per boot, after the first non-empty rows commit.
  const paintedRef = useRef(false)
  const rowCount = surfaceProps.rows.length
  useEffect(() => {
    if (paintedRef.current || rowCount === 0) return
    paintedRef.current = true
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void onFirstPaint()
      })
    })
  }, [rowCount, onFirstPaint])

  // Entry hrefs are stripped at sanitize; an anchor with one is a sanitize
  // regression, so the click is swallowed — the WebView must never navigate.
  // composedPath, not target.closest: rich entries live in shadow roots, and
  // retargeting rewrites event.target to the shadow host — the anchor is only
  // reachable through the composed path. The host-side nav lock is the
  // backstop for anything that slips past preventDefault.
  const handleClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const anchor = event.nativeEvent
      .composedPath()
      .find(
        (node): node is HTMLAnchorElement =>
          node instanceof HTMLAnchorElement && node.hasAttribute('href'),
      )
    if (anchor != null) event.preventDefault()
  }, [])

  return (
    <ThemeProvider initialThemeId={themeId}>
      <DensityProvider>
        <ThemeSync themeId={themeId} />
        <style>{RESET_CSS}</style>
        <div className="reader-doc-root bg-bg-base" onClickCapture={handleClickCapture}>
          <ReaderSurface {...surfaceProps} ref={surfaceRef} />
        </div>
      </DensityProvider>
    </ThemeProvider>
  )
}
