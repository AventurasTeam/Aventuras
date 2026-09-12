import { Platform, Pressable, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { POINTER_EVENTS_NONE } from '@/constants/styles'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

import { ListRow, type ListRowProps } from './list-row'

type CollisionListRowProps = {
  row: ListRowProps
  collision: {
    otherName: string
    onJumpToOther: () => void
    onResolve: () => void
    /** Keeps Resolve visible but inert; `resolveDisabledReason` is its tooltip and a11y hint. */
    resolveDisabled?: boolean
    resolveDisabledReason?: string
  }
}

export function CollisionListRow({ row, collision }: CollisionListRowProps) {
  const resolveDisabled = collision.resolveDisabled === true
  return (
    <View>
      <ListRow {...row} />
      <View
        accessibilityRole="alert"
        accessibilityLabel={t('collisionRow.warning')}
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
            {t('collisionRow.collidesWith', { name: collision.otherName })}
          </Text>
        </Pressable>
        <View className="ml-auto">
          <Button
            variant="secondary"
            onPress={collision.onResolve}
            disabled={resolveDisabled}
            disabledReason={resolveDisabled ? collision.resolveDisabledReason : undefined}
          >
            <Text>{t('collisionRow.resolve')}</Text>
          </Button>
        </View>
      </View>
    </View>
  )
}

export type { CollisionListRowProps }
