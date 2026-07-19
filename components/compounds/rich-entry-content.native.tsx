import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking, StyleSheet, View, type LayoutChangeEvent } from 'react-native'

import { useTheme } from '@/lib/themes'

import type { RichEntryContentProps } from './rich-entry-content.types'
import RichEntryDocument from './rich-entry-dom'
import { useRichEntryActive } from './rich-entry-visibility'

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

// Boot-slot scheduler: a story-open renders the whole hydrated window, and
// letting every rich card spin up its WebView at once slows each boot and
// pressures Android's renderer (surface loss, process kills). Cards without a
// slot simply keep their underlay — the designed placeholder. LIFO grant
// order: the most recently mounted rows are the ones nearest the viewport,
// both at open (bottom rows mount last) and while scrolling.
const BOOT_CONCURRENCY = 3
let activeBoots = 0
const bootQueue: (() => void)[] = []

function requestBootSlot(grant: () => void): () => void {
  if (activeBoots < BOOT_CONCURRENCY) {
    activeBoots += 1
    grant()
    return () => {}
  }
  bootQueue.push(grant)
  return () => {
    const index = bootQueue.indexOf(grant)
    if (index >= 0) bootQueue.splice(index, 1)
  }
}

function releaseBootSlot(): void {
  const next = bootQueue.pop()
  if (next != null) {
    next()
    return
  }
  activeBoots -= 1
}

const styles = StyleSheet.create({
  booting: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
  // eslint-disable-next-line react-native/no-color-literals -- 'transparent' keeps the card bubble visible behind the WebView document; it is not a theme token.
  webview: { backgroundColor: 'transparent' },
})

// Scroll-past-and-back must not thrash WebViews: a card leaving the active
// band keeps its WebView briefly before downgrading to the underlay.
const TEARDOWN_DELAY_MS = 2000

export function RichEntryContent({ markedHtml, entryId, underlay }: RichEntryContentProps) {
  const { theme } = useTheme()
  const [ready, setReady] = useState(false)
  const [width, setWidth] = useState(0)
  const [webViewMounted, setWebViewMounted] = useState(false)
  const active = useRichEntryActive(entryId)

  const slotHeldRef = useRef(false)
  const cancelSlotRequestRef = useRef<(() => void) | null>(null)
  const teardownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadCountRef = useRef(0)

  useEffect(() => {
    if (active) {
      if (teardownTimerRef.current != null) {
        clearTimeout(teardownTimerRef.current)
        teardownTimerRef.current = null
      }
      if (!webViewMounted && cancelSlotRequestRef.current == null && !slotHeldRef.current) {
        let grantedSync = false
        const cancel = requestBootSlot(() => {
          grantedSync = true
          cancelSlotRequestRef.current = null
          slotHeldRef.current = true
          setWebViewMounted(true)
        })
        if (!grantedSync) cancelSlotRequestRef.current = cancel
      }
      return
    }
    if (!webViewMounted && cancelSlotRequestRef.current == null) return
    teardownTimerRef.current = setTimeout(() => {
      teardownTimerRef.current = null
      cancelSlotRequestRef.current?.()
      cancelSlotRequestRef.current = null
      if (slotHeldRef.current) {
        slotHeldRef.current = false
        releaseBootSlot()
      }
      loadCountRef.current = 0
      setReady(false)
      setWebViewMounted(false)
    }, TEARDOWN_DELAY_MS)
  }, [active, webViewMounted])

  useEffect(
    () => () => {
      if (teardownTimerRef.current != null) clearTimeout(teardownTimerRef.current)
      cancelSlotRequestRef.current?.()
      if (slotHeldRef.current) {
        slotHeldRef.current = false
        releaseBootSlot()
      }
    },
    [],
  )

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width)
  }, [])

  const cachedHeight = readCachedHeight(entryId, width, markedHtml)

  const handleReady = useCallback(async () => {
    setReady(true)
    if (slotHeldRef.current) {
      slotHeldRef.current = false
      releaseBootSlot()
    }
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
  const handleLoadEnd = useCallback(() => {
    loadCountRef.current += 1
    if (loadCountRef.current > 1) setReady(false)
  }, [])

  // Android can kill a WebView's renderer under memory pressure with no load
  // or ready signal — the card would sit blank forever. Remounting under a new
  // key boots a fresh WebView behind the re-bridged underlay.
  const [webViewEpoch, setWebViewEpoch] = useState(0)
  const handleRenderProcessGone = useCallback(() => {
    loadCountRef.current = 0
    setReady(false)
    setWebViewEpoch((epoch) => epoch + 1)
  }, [])

  return (
    <View
      onLayout={handleLayout}
      // eslint-disable-next-line react-native/no-inline-styles -- height is a runtime cache value; overflow rides along so the boot-frame underlay cannot exceed the claimed height.
      style={!ready && cachedHeight != null ? { height: cachedHeight, overflow: 'hidden' } : null}
    >
      {ready ? null : underlay}
      {webViewMounted ? (
        <View
          style={ready ? null : styles.booting}
          pointerEvents={ready ? 'auto' : 'none'}
          onLayout={handleWebViewLayout}
        >
          <RichEntryDocument
            key={webViewEpoch}
            markedHtml={markedHtml}
            themeVars={theme.colors}
            mode={theme.mode}
            onReady={handleReady}
            dom={{
              matchContents: true,
              scrollEnabled: false,
              onLoadEnd: handleLoadEnd,
              onShouldStartLoadWithRequest: handleShouldStartLoad,
              onRenderProcessGone: handleRenderProcessGone,
              style: styles.webview,
            }}
          />
        </View>
      ) : null}
    </View>
  )
}
