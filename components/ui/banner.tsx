import { TriangleAlert } from 'lucide-react-native'
import { Platform, Pressable, View } from 'react-native'

import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

type BannerProps = {
  message: string
  ctaLabel: string
  onCta: () => void
  className?: string
}

/** Persistent warn bar above story-list content. Non-dismissible — the underlying state is the dismiss. */
export function Banner({ message, ctaLabel, onCta, className }: BannerProps) {
  return (
    <View
      accessibilityRole="alert"
      className={cn(
        'relative w-full flex-row items-center gap-2 border-b border-warning px-4 py-2.5',
        className,
      )}
    >
      <View
        aria-hidden
        pointerEvents="none"
        className="absolute inset-0 bg-warning opacity-[.12]"
      />
      <Icon as={TriangleAlert} size="sm" className="text-warning" />
      <Text size="sm" className="flex-1 text-fg-primary">
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
        onPress={onCta}
        className={cn(
          Platform.select({
            web: 'cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
          }),
        )}
      >
        <Text size="sm" className="font-medium text-fg-primary underline">
          {ctaLabel}
        </Text>
      </Pressable>
    </View>
  )
}

export type { BannerProps }
