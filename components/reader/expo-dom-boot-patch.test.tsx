// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { useEffect, type ComponentType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// Replays patches/expo.patch in both boot orders; why:
// docs/implementation/lessons-learned/expo-dom-boot-script-races-the-bundle.md

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
    render(<Component />, { container: document.getElementById('root')! })
  },
}))

type PostMessage = (message: string) => void
type BootGlobals = {
  $$EXPO_DOM_HOST_OS?: string
  $$EXPO_INITIAL_PROPS?: unknown
  ReactNativeWebView?: { postMessage: PostMessage }
}
const win = window as unknown as BootGlobals

function DocumentUnderTest({ label, onReady }: { label: string; onReady: () => Promise<void> }) {
  useEffect(() => {
    void onReady()
  }, [onReady])
  return <p>{label}</p>
}

// A non-literal specifier keeps tsc out of expo's sources, which don't type-check in this repo.
function importExpoDom<T>(file: string): Promise<T> {
  return import(/* @vite-ignore */ `expo/src/dom/${file}`) as Promise<T>
}

/** The wrapper's boot script, as RNW evaluates it in the page (RNWebView.java wraps it so). */
async function hostBootScript(): Promise<string> {
  const { default: RawWebView } = await importExpoDom<{
    default: ComponentType<Record<string, unknown>>
  }>('webview-wrapper')
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
  const { registerDOMComponent } = await importExpoDom<{
    registerDOMComponent: (component: typeof DocumentUnderTest) => void
  }>('dom-entry')
  registerDOMComponent(DocumentUnderTest)
}

function nativeActionsPosted(postMessage: Mock<PostMessage>): string[] {
  return postMessage.mock.calls
    .map(([raw]) => JSON.parse(raw) as { type: string; data: { actionId?: string } })
    .filter((m) => m.type === '$$native_action')
    .map((m) => m.data.actionId ?? '')
}

const rootText = () => document.getElementById('root')!.textContent

describe('expo-dom boot order (patches/expo.patch)', () => {
  let postMessage: Mock<PostMessage>

  beforeEach(() => {
    vi.resetModules()
    // A release document: the entry skips its dev-only LogBox require.
    vi.stubGlobal('__DEV__', false)
    vi.stubEnv('NODE_ENV', 'production')
    captured.props = null
    postMessage = vi.fn<PostMessage>()
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

  it('mounts once and reaches the host when the boot script lands after the bundle', async () => {
    const script = await hostBootScript()

    await evaluateDocumentBundle()
    expect(rootText()).toBe('')

    runInPage(script)
    runInPage(script)

    await vi.waitFor(() => expect(rootText()).toBe('from host'))
    await vi.waitFor(() => expect(nativeActionsPosted(postMessage)).toEqual(['onReady']))
  })

  it('mounts at once when the boot script ran first', async () => {
    runInPage(await hostBootScript())

    await evaluateDocumentBundle()

    await vi.waitFor(() => expect(rootText()).toBe('from host'))
    await vi.waitFor(() => expect(nativeActionsPosted(postMessage)).toEqual(['onReady']))
  })
})
