import { useCallback, useRef, useState } from 'react'
import { Linking, StyleSheet, View, type LayoutChangeEvent } from 'react-native'

import { useTheme } from '@/lib/themes'

import type { RichEntryContentProps } from './rich-entry-content.types'
import RichEntryDocument from './rich-entry-dom'

type CachedHeight = { content: string; height: number }

// Session-scoped: remounting cards claim their measured height instantly, so
// the underlay bridges only WebView boot. Persisting is deferred until
// validation shows re-measure pain. Content rides in the value so an edited
// entry misses instead of inheriting a stale height.
const heightCache = new Map<string, CachedHeight>()
const HEIGHT_CACHE_CAP = 300

function cacheKey(entryId: string, width: number): string {
  return `${entryId}:${Math.round(width)}`
}

function readCachedHeight(
  entryId: string | undefined,
  width: number,
  content: string,
): number | undefined {
  if (entryId == null || width === 0) return undefined
  const hit = heightCache.get(cacheKey(entryId, width))
  return hit != null && hit.content === content ? hit.height : undefined
}

function writeCachedHeight(entryId: string, width: number, content: string, height: number): void {
  if (heightCache.size >= HEIGHT_CACHE_CAP) {
    const oldest = heightCache.keys().next().value
    if (oldest != null) heightCache.delete(oldest)
  }
  heightCache.set(cacheKey(entryId, width), { content, height })
}

const styles = StyleSheet.create({
  booting: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
  // eslint-disable-next-line react-native/no-color-literals -- 'transparent' keeps the card bubble visible behind the WebView document; it is not a theme token.
  webview: { backgroundColor: 'transparent' },
})

export function RichEntryContent({ markedHtml, entryId, underlay }: RichEntryContentProps) {
  const { theme } = useTheme()
  const [ready, setReady] = useState(false)
  const [width, setWidth] = useState(0)

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width)
  }, [])

  const cachedHeight = readCachedHeight(entryId, width, markedHtml)

  const handleReady = useCallback(async () => {
    setReady(true)
  }, [])

  const handleWebViewLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { height } = event.nativeEvent.layout
      if (!ready || entryId == null || width === 0 || height === 0) return
      writeCachedHeight(entryId, width, markedHtml, height)
    },
    [ready, entryId, width, markedHtml],
  )

  // Provider-authored <a href> must never navigate the card's document away.
  // The card's own document URL stays allowed — Android WebViews reload their
  // document after surface loss (e.g. list clipping detach), and blocking
  // that recovery load would freeze the card blank. Everything else is
  // foreign: http(s) routes to the system browser, the rest is dropped.
  const documentUrlRef = useRef<string | null>(null)
  const handleShouldStartLoad = useCallback((request: { url: string }) => {
    if (documentUrlRef.current == null || request.url === documentUrlRef.current) {
      documentUrlRef.current = request.url
      return true
    }
    if (/^https?:/i.test(request.url)) void Linking.openURL(request.url)
    return false
  }, [])

  // A load finishing after the swap means the WebView reloaded (surface loss
  // recovery): its fresh document repaints from scratch, so drop back to the
  // underlay and let the new onReady swap again.
  const loadCountRef = useRef(0)
  const handleLoadEnd = useCallback(() => {
    loadCountRef.current += 1
    if (loadCountRef.current > 1) setReady(false)
  }, [])

  return (
    <View
      onLayout={handleLayout}
      // eslint-disable-next-line react-native/no-inline-styles -- height is a runtime cache value; overflow rides along so the boot-frame underlay cannot exceed the claimed height.
      style={!ready && cachedHeight != null ? { height: cachedHeight, overflow: 'hidden' } : null}
    >
      {ready ? null : underlay}
      <View
        style={ready ? null : styles.booting}
        pointerEvents={ready ? 'auto' : 'none'}
        onLayout={handleWebViewLayout}
      >
        <RichEntryDocument
          markedHtml={markedHtml}
          themeVars={theme.colors}
          mode={theme.mode}
          onReady={handleReady}
          dom={{
            matchContents: true,
            scrollEnabled: false,
            onLoadEnd: handleLoadEnd,
            onShouldStartLoadWithRequest: handleShouldStartLoad,
            style: styles.webview,
          }}
        />
      </View>
    </View>
  )
}
