import { BottomSheetModalProvider } from '@gorhom/bottom-sheet'
import { PortalHost } from '@rn-primitives/portal'
import type { Preview } from '@storybook/react-native-web-vite'
import { useEffect, type ReactNode } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { DensityProvider, useDensity, type DensitySetting } from '@/lib/density'
import { themes as registryThemes, ThemeProvider, useTheme } from '@/lib/themes'

import '../global.css'

function ThemeApplier({ themeId, children }: { themeId: string; children: ReactNode }) {
  const { setTheme } = useTheme()
  useEffect(() => setTheme(themeId), [themeId, setTheme])
  return <>{children}</>
}

function DensityApplier({ setting, children }: { setting: DensitySetting; children: ReactNode }) {
  const { setSetting } = useDensity()
  useEffect(() => setSetting(setting), [setting, setSetting])
  return <>{children}</>
}

// Radix Dialog / Popover lock `document.body` (data-scroll-locked +
// pointer-events: none) while open and clear it on unmount. Stories
// that leave a Radix overlay open (e.g. CollisionResolveDialog's
// *Loading variants) unmount their content between vitest stories,
// but the body attributes can persist across story boundaries and
// block clicks in the next test. Strip them eagerly on unmount.
function BodyLockReset({ children }: { children: ReactNode }) {
  useEffect(() => {
    const clear = () => {
      if (typeof document === 'undefined') return
      document.body.removeAttribute('data-scroll-locked')
      document.body.style.pointerEvents = ''
    }
    clear()
    return clear
  }, [])
  return <>{children}</>
}

const themeOptions = registryThemes.map((t) => ({ value: t.id, title: t.name }))

// Storybook web has no real OS safe-area to read, and
// `useSafeAreaInsets` throws without a Provider. Provide flat zero
// metrics — the dev page on native still uses the real Provider via
// app/_layout.tsx through expo-router defaults.
const STORYBOOK_SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}

const STORYBOOK_GH_ROOT_STYLE = { flex: 1 }

const densityOptions: { value: DensitySetting; title: string }[] = [
  { value: 'default', title: 'Default (per tier)' },
  { value: 'compact', title: 'Compact' },
  { value: 'regular', title: 'Regular' },
  { value: 'comfortable', title: 'Comfortable' },
]

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    a11y: {
      test: 'todo',
      // Suppress axe rule that flags `aria-autocomplete="none"` on
      // Select's trigger. The attribute is set by @radix-ui/react-select
      // (which @rn-primitives/select wraps on web) and reflects an
      // intentional WAI-ARIA semantic — radix is communicating "no
      // autocomplete" to AT users, but axe's strict reading only
      // allows the attribute on combobox/textbox/searchbox roles.
      // The fix is upstream in radix; we suppress noise here.
      config: {
        rules: [{ id: 'aria-allowed-attr', enabled: false }],
      },
    },
  },
  globalTypes: {
    theme: {
      description: 'Active theme (drives useTheme context)',
      defaultValue: registryThemes[0].id,
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: themeOptions,
        dynamicTitle: true,
      },
    },
    density: {
      description: 'Active density (drives useDensity context)',
      defaultValue: 'default',
      toolbar: {
        title: 'Density',
        icon: 'ruler',
        items: densityOptions,
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const themeId = (context.globals.theme as string) ?? registryThemes[0].id
      const densitySetting = (context.globals.density as DensitySetting) ?? 'default'
      return (
        <BodyLockReset>
          {/* Mirrors the runtime app/_layout provider stack so Sheet
              (BottomSheetModal) and gesture-handler-based primitives
              work in Storybook. BottomSheetModalProvider sits inside
              ThemeProvider so theme context propagates through the
              sheet's internal portal. */}
          <GestureHandlerRootView style={STORYBOOK_GH_ROOT_STYLE}>
            <SafeAreaProvider initialMetrics={STORYBOOK_SAFE_AREA_METRICS}>
              <ThemeProvider>
                <DensityProvider>
                  <ThemeApplier themeId={themeId}>
                    <DensityApplier setting={densitySetting}>
                      <BottomSheetModalProvider>
                        <Story />
                        {/* @rn-primitives/portal host for popover consumers. */}
                        <PortalHost />
                      </BottomSheetModalProvider>
                    </DensityApplier>
                  </ThemeApplier>
                </DensityProvider>
              </ThemeProvider>
            </SafeAreaProvider>
          </GestureHandlerRootView>
        </BodyLockReset>
      )
    },
  ],
}

export default preview
