// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import type { registerDOMComponent } from 'expo/build/dom/dom-entry'
import type { getInjectEventScript } from 'expo/build/dom/injection'
import type RawWebView from 'expo/build/dom/webview-wrapper'
import { useEffect, type ComponentType } from 'react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
  type MockInstance,
} from 'vitest'

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
}
const win = window as unknown as BootGlobals

function DocumentUnderTest({ label, onReady }: { label: string; onReady: () => Promise<void> }) {
  useEffect(() => {
    void onReady()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount, like reader-document
  }, [])
  return <p>{label}</p>
}

// Typed from expo's shipped declarations; the non-literal specifier keeps tsc out of expo's
// sources, which don't type-check in this repo.
type ExpoDomModules = {
  'dom-entry': { registerDOMComponent: typeof registerDOMComponent }
  'webview-wrapper': { default: typeof RawWebView }
  injection: { getInjectEventScript: typeof getInjectEventScript }
}

function importExpoDom<F extends keyof ExpoDomModules>(file: F): Promise<ExpoDomModules[F]> {
  return import(/* @vite-ignore */ `expo/src/dom/${file}`)
}

/** The wrapper's boot script, wrapped as react-native-webview's RNCWebView.java evaluates it. */
async function hostBootScript(): Promise<string> {
  const { default: RawWebView } = await importExpoDom('webview-wrapper')
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

async function hostPropsScript(props: Record<string, string>): Promise<string> {
  const { getInjectEventScript } = await importExpoDom('injection')
  return getInjectEventScript({ type: '$$props', data: { names: ['onReady'], props } })
}

function runInPage(script: string) {
  new Function(script)()
}

/** Evaluates the document bundle's entry, as `expo/dom/entry.js` does in the WebView. */
async function evaluateDocumentBundle() {
  const { registerDOMComponent } = await importExpoDom('dom-entry')
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
  let windowListeners: MockInstance<typeof window.addEventListener>

  beforeEach(() => {
    vi.resetModules()
    // The wrapper reads __DEV__ on import, and vitest doesn't define it.
    vi.stubGlobal('__DEV__', false)
    // A release document: the entry skips its dev-only LogBox require.
    vi.stubEnv('NODE_ENV', 'production')
    captured.props = null
    postMessage = vi.fn<PostMessage>()
    vi.stubGlobal('ReactNativeWebView', { postMessage })
    windowListeners = vi.spyOn(window, 'addEventListener')
    document.body.innerHTML = '<div id="root"></div>'
  })

  afterEach(() => {
    cleanup()
    // A boot listener left by a test that failed early would mount a second root in the next one.
    for (const [type, listener] of windowListeners.mock.calls) {
      if (type === '$$dom_boot') window.removeEventListener(type, listener)
    }
    windowListeners.mockRestore()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    // The entry sets this directly, so unstubAllEnvs doesn't clear it.
    delete process.env.EXPO_DOM_HOST_OS
    delete win.$$EXPO_DOM_HOST_OS
    delete win.$$EXPO_INITIAL_PROPS
  })

  it('mounts once and talks both ways when the boot script lands after the bundle', async () => {
    const bootScript = await hostBootScript()
    const propsScript = await hostPropsScript({ label: 'updated' })

    await evaluateDocumentBundle()
    expect(rootText()).toBe('')

    runInPage(bootScript)
    await vi.waitFor(() => expect(rootText()).toBe('from host'))
    await vi.waitFor(() => expect(nativeActionsPosted(postMessage)).toEqual(['onReady']))

    runInPage(bootScript)
    runInPage(propsScript)
    await vi.waitFor(() => expect(rootText()).toBe('updated'))
    expect(nativeActionsPosted(postMessage)).toEqual(['onReady'])
  })

  it('mounts without waiting for the boot event when the script ran first', async () => {
    runInPage(await hostBootScript())

    await evaluateDocumentBundle()

    await vi.waitFor(() => expect(rootText()).toBe('from host'))
    await vi.waitFor(() => expect(nativeActionsPosted(postMessage)).toEqual(['onReady']))
  })
})
