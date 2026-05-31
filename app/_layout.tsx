import { BottomSheetModalProvider } from '@gorhom/bottom-sheet'
import { PortalHost } from '@rn-primitives/portal'
import { QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useEffect } from 'react'
import { I18nextProvider } from 'react-i18next'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'

import '@/global.css'
import { SettingsRecoveryScreen } from '@/components/shells/settings-recovery-screen'
import { Toaster } from '@/components/ui/toast'
import { useBootstrap } from '@/lib/boot'
import { queryClient } from '@/lib/cache'
import { db, ensureAppSettingsSingleton, useDbMigrations } from '@/lib/db'
import { DensityProvider } from '@/lib/density'
import { i18n } from '@/lib/i18n'
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
        <ThemeProvider>
          <DensityProvider>
            <SettingsRecoveryScreen onReset={resetSettings} />
          </DensityProvider>
        </ThemeProvider>
      </GestureHandlerRootView>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      {/* eslint-disable-next-line react-native/no-inline-styles -- GestureHandlerRootView isn't NativeWind-wrapped; documented full-screen root pattern. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <ThemeProvider>
            <DensityProvider>
              <I18nextProvider i18n={i18n}>
                <BottomSheetModalProvider>
                  <Stack screenOptions={{ headerShown: false }} />
                  <Toaster />
                  <PortalHost />
                </BottomSheetModalProvider>
              </I18nextProvider>
            </DensityProvider>
          </ThemeProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  )
}
