'use dom'

import '@/global.css'

import { useDOMImperativeHandle, type DOMImperativeFactory, type DOMProps } from 'expo/dom'
import { useCallback, useEffect, useLayoutEffect, useRef, type MouseEvent, type Ref } from 'react'

import type { EditBridgeAnswer } from '@/components/reader/edit-bridge-requests'
import type {
  ReaderSurfaceHandle,
  ReaderSurfaceProps,
} from '@/components/reader/reader-document-types'
import { ReaderSurface } from '@/components/reader/reader-surface'
import { DensityProvider } from '@/lib/density'
import { ThemeProvider, useTheme } from '@/lib/themes'

type DOMImperativeArg = Parameters<DOMImperativeFactory[string]>[number]

export interface ReaderDocumentRef extends DOMImperativeFactory {
  // The factory's index signature takes any JSONValue, so a typed parameter won't compile.
  jumpToBottom: (sliceKey: DOMImperativeArg) => void
  jumpToEntry: (entryId: DOMImperativeArg, sliceKey: DOMImperativeArg) => void
  // These return nothing over the bridge: each answers its request id through onEditAnswer.
  queryEditSession: (requestId: DOMImperativeArg) => void
  commitDraft: (requestId: DOMImperativeArg) => void
  discardDraft: () => void
}

type ReaderDocumentProps = ReaderSurfaceProps & {
  themeId: string
  /** Bumped by the host after onReady — forces a full prop re-emission. */
  syncNonce: number
  onReady: () => Promise<void>
  onFirstPaint: () => Promise<void>
  /** Answers the host's edit requests by id. Must settle, never reject. */
  onEditAnswer: (requestId: string, answer: EditBridgeAnswer) => Promise<void>
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
  onEditAnswer,
  ref,
  ...surfaceProps
}: ReaderDocumentProps) {
  const surfaceRef = useRef<ReaderSurfaceHandle>(null)
  // Each bridge emission hands the document a fresh callback proxy; the handle reads the latest.
  const onEditAnswerRef = useRef(onEditAnswer)
  useLayoutEffect(() => {
    onEditAnswerRef.current = onEditAnswer
  })

  useDOMImperativeHandle(
    ref,
    () => ({
      jumpToBottom: (sliceKey) => surfaceRef.current?.jumpToBottom(Number(sliceKey)),
      jumpToEntry: (entryId, sliceKey) =>
        surfaceRef.current?.jumpToEntry(String(entryId), Number(sliceKey)),
      queryEditSession: (requestId) => {
        const session = surfaceRef.current?.editSession() ?? null
        void onEditAnswerRef.current(String(requestId), { kind: 'query', session })
      },
      commitDraft: (requestId) => {
        // A rejection here would re-reject inside the WebView unlogged; answering lets the host
        // keep its dialog up with a reason.
        void (surfaceRef.current?.commitDraft() ?? Promise.resolve({ ok: true as const }))
          .catch(() => ({ ok: false as const }))
          .then((result) => onEditAnswerRef.current(String(requestId), { kind: 'commit', result }))
      },
      discardDraft: () => surfaceRef.current?.discardDraft(),
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
