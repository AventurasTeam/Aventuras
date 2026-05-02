import { ScrollView, View } from 'react-native'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { useTheme } from '@/lib/themes/use-theme'

export function ThemePicker() {
  const { theme, setTheme, themes } = useTheme()
  return (
    <View className="sticky top-0 flex-col gap-2 border-b border-border bg-bg-base p-4">
      <Text variant="muted" size="sm">
        Theme
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row gap-2">
          {themes.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant={t.id === theme.id ? 'primary' : 'secondary'}
              onPress={() => setTheme(t.id)}
            >
              <Text>{t.name}</Text>
            </Button>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}
