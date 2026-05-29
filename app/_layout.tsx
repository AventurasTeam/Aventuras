import { BottomSheetModalProvider } from '@gorhom/bottom-sheet'
import { PortalHost } from '@rn-primitives/portal'
import { Stack } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'

import '@/global.css'
import { DensityProvider } from '@/lib/density'
import { ThemeProvider } from '@/lib/themes'

export default function RootLayout() {
  return (
    // eslint-disable-next-line react-native/no-inline-styles -- GestureHandlerRootView isn't NativeWind-wrapped; documented full-screen root pattern.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <ThemeProvider>
          <DensityProvider>
            <BottomSheetModalProvider>
              <Stack screenOptions={{ headerShown: false }} />
              <PortalHost />
            </BottomSheetModalProvider>
          </DensityProvider>
        </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  )
}
