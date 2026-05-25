import { PortalHost } from '@rn-primitives/portal'
import { Stack } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'

import { DensityProvider } from '@/lib/density/density-provider'
import { ThemeProvider } from '@/lib/themes/theme-provider'
import '@/global.css'

export default function RootLayout() {
  return (
    // eslint-disable-next-line react-native/no-inline-styles -- GestureHandlerRootView isn't NativeWind-wrapped; documented full-screen root pattern.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <ThemeProvider>
          <DensityProvider>
            <Stack screenOptions={{ headerShown: false }} />
            <PortalHost />
          </DensityProvider>
        </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  )
}
