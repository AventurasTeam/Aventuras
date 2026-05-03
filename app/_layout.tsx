import { Stack } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { PortalHost } from '@rn-primitives/portal'
import { ThemeProvider } from '@/lib/themes/theme-provider'
import '@/global.css'

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <Stack screenOptions={{ headerShown: false }} />
        <PortalHost />
      </ThemeProvider>
    </GestureHandlerRootView>
  )
}
