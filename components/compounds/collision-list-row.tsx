import { Platform, Pressable, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { POINTER_EVENTS_NONE } from '@/constants/styles'
import { cn } from '@/lib/utils'

import { ListRow, type ListRowProps } from './list-row'

type CollisionListRowProps = {
  row: ListRowProps
  collision: {
    otherName: string
    onJumpToOther: () => void
    onResolve: () => void
  }
}

export function CollisionListRow({ row, collision }: CollisionListRowProps) {
  return (
    <View>
      <ListRow {...row} />
      <View
        accessibilityRole="alert"
        accessibilityLabel="Collision warning"
        className={cn(
          'relative flex-row items-center gap-3 overflow-hidden border-l-[3px] border-warning px-row-x-md py-row-y-sm',
        )}
      >
        <View
          aria-hidden
          style={POINTER_EVENTS_NONE}
          className="absolute inset-0 bg-warning opacity-[.12]"
        />
        <Pressable
          onPress={collision.onJumpToOther}
          accessibilityRole="link"
          className={cn('shrink', Platform.select({ web: 'cursor-pointer' }))}
        >
          <Text size="sm" className="underline">
            {`⚠ Collides with ${collision.otherName}`}
          </Text>
        </Pressable>
        <View className="ml-auto">
          <Button variant="secondary" onPress={collision.onResolve}>
            <Text>Resolve →</Text>
          </Button>
        </View>
      </View>
    </View>
  )
}

export type { CollisionListRowProps }
