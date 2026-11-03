// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { useEffect, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// patches/expo.patch: on Android, react-native-webview runs the wrapper's boot script (host OS +
// initial props) from onPageStarted with evaluateJavascript, which can land after the document's
// bundle has run. Unpatched, the entry throws and the document never mounts. These tests replay
// both orders with the wrapper's own script against the document runtime.

const captured: { props: Record<string, unknown> | null } = { props: null }

vi.mock('expo/src/dom/webview/RNWebView', () => ({
  default: (props: Record<string, unknown>) => {
    captured.props = props
    return null
  },
}))
vi.mock('expo/src/dom/webview/ExpoDOMWebView', () => ({ default: undefined }))
vi.mock('@expo/metro-runtime', () => ({}))
// The DOM bundle's launcher mounts into #root through AppRegistry; a plain root is enough here.
vi.mock('expo/src/launch/registerRootComponent', () => ({
  default: (Component: ComponentType) => {
    createRoot(document.getElementById('root')!).render(<Component />)
  },
}))

type BootGlobals = {
  $$EXPO_DOM_HOST_OS?: string
  $$EXPO_INITIAL_PROPS?: unknown
  ReactNativeWebView?: { postMessage: (message: string) => void }
}
const win = window as unknown as BootGlobals

function DocumentUnderTest({ label, onReady }: { label: string; onReady: () => Promise<void> }) {
  useEffect(() => {
    void onReady()
  }, [onReady])
  return <p>{label}</p>
}

/** The wrapper's boot script, as RNW evaluates it in the page (RNWebView.java wraps it so). */
async function hostBootScript(): Promise<string> {
  const { default: RawWebView } = await import('expo/src/dom/webview-wrapper')
  render(
    <RawWebView
      filePath="reader-document.html"
      dom={{ overrideUri: 'file:///android_asset/www.bundle/reader-document.html' }}
      label="from host"
      onReady={async () => {}}
    />,
  )
  const script = captured.props?.injectedJavaScriptBeforeContentLoaded
  if (typeof script !== 'string') throw new Error('wrapper rendered no boot script')
  return `(function() {\n${script};\n})();`
}

function runInPage(script: string) {
  new Function(script)()
}

/** Evaluates the document bundle's entry, as `expo/dom/entry.js` does in the WebView. */
async function evaluateDocumentBundle() {
  const { registerDOMComponent } = await import('expo/src/dom/dom-entry')
  registerDOMComponent(DocumentUnderTest)
}

function nativeActionsPosted(postMessage: ReturnType<typeof vi.fn>): string[] {
  return postMessage.mock.calls
    .map(([raw]) => JSON.parse(raw as string) as { type: string; data: { actionId?: string } })
    .filter((m) => m.type === '$$native_action')
    .map((m) => m.data.actionId ?? '')
}

describe('expo-dom boot order (patches/expo.patch)', () => {
  let postMessage: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    // A release document: the entry skips its dev-only LogBox require.
    vi.stubGlobal('__DEV__', false)
    vi.stubEnv('NODE_ENV', 'production')
    captured.props = null
    postMessage = vi.fn()
    win.ReactNativeWebView = { postMessage }
    document.body.innerHTML = '<div id="root"></div>'
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    delete win.$$EXPO_DOM_HOST_OS
    delete win.$$EXPO_INITIAL_PROPS
    delete win.ReactNativeWebView
  })

  it('mounts and reaches the host when the boot script lands after the bundle', async () => {
    const script = await hostBootScript()

    await evaluateDocumentBundle()
    expect(document.getElementById('root')!.textContent).toBe('')

    runInPage(script)

    await vi.waitFor(() => expect(document.getElementById('root')!.textContent).toBe('from host'))
    await vi.waitFor(() => expect(nativeActionsPosted(postMessage)).toEqual(['onReady']))
  })

  it('mounts at once when the boot script ran first', async () => {
    runInPage(await hostBootScript())

    await evaluateDocumentBundle()

    await vi.waitFor(() => expect(document.getElementById('root')!.textContent).toBe('from host'))
    await vi.waitFor(() => expect(nativeActionsPosted(postMessage)).toEqual(['onReady']))
  })
})
