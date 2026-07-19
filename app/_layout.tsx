import { BottomSheetModalProvider } from '@gorhom/bottom-sheet'
import { PortalHost } from '@rn-primitives/portal'
import { QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useEffect } from 'react'
import { I18nextProvider } from 'react-i18next'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context'

import { SettingsRecoveryScreen } from '@/components/shells/settings-recovery-screen'
import { CrashRecoveryModalHost } from '@/components/story/crash-recovery-modal-host'
import { Toaster } from '@/components/ui/toast'
import '@/global.css'
import { setAppearanceThemeId } from '@/lib/actions'
import { useBootstrap } from '@/lib/boot'
import { queryClient } from '@/lib/cache'
import { DrizzleStudioDevTools, db, ensureAppSettingsSingleton, useDbMigrations } from '@/lib/db'
import { DensityProvider } from '@/lib/density'
import { logger } from '@/lib/diagnostics'
import { i18n } from '@/lib/i18n'
import '@/lib/polyfills'
import { appSettingsStore } from '@/lib/stores'
import { ThemeProvider } from '@/lib/themes'

export default function RootLayout() {
  const { success, error } = useDbMigrations()
  const { phase, resetSettings } = useBootstrap(success)

  // Seed the app_settings singleton (idempotent) once migrations are applied.
  useEffect(() => {
    if (success) void ensureAppSettingsSingleton(db)
  }, [success])

  if (error) throw error
  if (!success || phase === 'loading') return null

  // Corrupt app_settings: halt pre-Router. Wrapped only in the providers the
  // recovery surface needs (theme tokens + layout); copy uses the import-time
  // i18n instance, no I18nextProvider required.
  if (phase === 'config-corrupt') {
    return (
      // eslint-disable-next-line react-native/no-inline-styles -- GestureHandlerRootView isn't NativeWind-wrapped; documented full-screen root pattern.
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <ThemeProvider>
            <DensityProvider>
              <SettingsRecoveryScreen onReset={resetSettings} />
            </DensityProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      {/* eslint-disable-next-line react-native/no-inline-styles -- GestureHandlerRootView isn't NativeWind-wrapped; documented full-screen root pattern. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <KeyboardProvider>
            <ThemeProvider
              initialThemeId={appSettingsStore.getAppSettings().appearance.themeId}
              onThemeChange={(id) =>
                void setAppearanceThemeId(id, { db }).catch((err) =>
                  logger.error('action_layer.theme_persist_failed', {
                    themeId: id,
                    error: err instanceof Error ? err.message : String(err),
                  }),
                )
              }
            >
              <DensityProvider>
                <I18nextProvider i18n={i18n}>
                  <BottomSheetModalProvider>
                    <Stack screenOptions={{ headerShown: false }} />
                    <CrashRecoveryModalHost />
                    <Toaster />
                    <PortalHost />
                    <DrizzleStudioDevTools />
                  </BottomSheetModalProvider>
                </I18nextProvider>
              </DensityProvider>
            </ThemeProvider>
          </KeyboardProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  )
}
