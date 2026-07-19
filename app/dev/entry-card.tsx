import { View } from 'react-native'

import EntryCardDevDocument from '@/components/dev/entry-card-dev-document'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { useTheme } from '@/lib/themes'

// EntryCard renders entry HTML in a web document only (single-document reader
// pivot), so the samples live in a 'use dom' host; the ThemePicker stays native
// because it drives the app-level theme store, and its id threads into the doc.
export default function EntryCardDevRoute() {
  const { theme } = useTheme()
  return (
    <View className="flex-1 bg-bg-base">
      <ThemePicker />
      <EntryCardDevDocument themeId={theme.id} dom={{ scrollEnabled: false, style: { flex: 1 } }} />
    </View>
  )
}
