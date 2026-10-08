import { Platform, Pressable, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { t } from '@/lib/i18n'
import { railGroupOf, type RailCategory } from '@/lib/reader-rail'
import { cn } from '@/lib/utils'

/** patterns/entity.md → Entity surfacing: the peek's escalation to the row's panel. */
export function PeekFoot({
  category,
  onOpenInPanel,
}: {
  category: RailCategory
  onOpenInPanel: () => void
}) {
  const isPhone = useTier() === 'phone'
  return (
    <View className="flex-row items-center justify-end border-t border-border px-4 py-1.5">
      <Pressable
        accessibilityRole="link"
        onPress={onOpenInPanel}
        className={cn(
          'rounded-sm px-2 py-1 active:bg-tint-press',
          // touch.md → Touch-target floor.
          isPhone && 'min-h-[44px] justify-center',
          Platform.select({ web: 'cursor-pointer hover:bg-tint-hover' }),
        )}
      >
        <Text size="sm" className="font-medium">
          {railGroupOf(category) === 'plot'
            ? t('reader:peek.openInPlot')
            : t('reader:peek.openInWorld')}
        </Text>
      </Pressable>
    </View>
  )
}
