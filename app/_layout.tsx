import 'react-native-gesture-handler'
import { Stack } from 'expo-router'
import { PortalHost } from '@rn-primitives/portal'
import { ThemeProvider } from '@/lib/themes/theme-provider'
import '@/global.css'

export default function RootLayout() {
  return (
    <ThemeProvider>
      <Stack screenOptions={{ headerShown: false }} />
      <PortalHost />
    </ThemeProvider>
  )
}
