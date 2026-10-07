import { useContext } from 'react'
import { Platform, Pressable, View, type ViewStyle } from 'react-native'

import { Heading } from '@/components/ui/heading'
import { ScrollComponentContext } from '@/components/ui/scroll-component'
import { Text } from '@/components/ui/text'
import { POINTER_EVENTS_NONE } from '@/constants/styles'
import { t } from '@/lib/i18n'
import { RAIL_GROUPS, type RailCategory, type RailGroup } from '@/lib/reader-rail'
import type { RecentlyClassified, RowCategory } from '@/lib/row-signals'
import { cn } from '@/lib/utils'

import { railCategoryLabel } from './rail-modules'
import { TintLayer } from './tint-layer'

const GROUP_ORDER: readonly RailGroup[] = ['world', 'plot']

// In the Sheet the scroll view is gorhom's Animated one, which NativeWind never styles.
const FILL = { flex: 1 } satisfies ViewStyle

export type RailSheetCategoriesProps = {
  value: RailCategory
  tints: ReadonlyMap<RowCategory, RecentlyClassified>
  onPick: (category: RailCategory) => void
}

export function RailSheetCategories({ value, tints, onPick }: RailSheetCategoriesProps) {
  const Scroll = useContext(ScrollComponentContext)
  return (
    <Scroll keyboardShouldPersistTaps="handled" style={FILL}>
      <View className="pb-3">
        {GROUP_ORDER.map((group) => {
          const categories: readonly RailCategory[] = RAIL_GROUPS[group]
          return (
            <View key={group}>
              <Heading
                level={4}
                size="xs"
                variant="muted"
                className="px-row-x-md pb-1 pt-3 uppercase"
              >
                {t(`reader:rail.groups.${group}`)}
              </Heading>
              {categories.map((category) => (
                <CategoryRow
                  key={category}
                  category={category}
                  selected={category === value}
                  tint={tints.get(category)}
                  onPress={() => onPick(category)}
                />
              ))}
            </View>
          )
        })}
      </View>
    </Scroll>
  )
}

function CategoryRow({
  category,
  selected,
  tint,
  onPress,
}: {
  category: RailCategory
  selected: boolean
  tint: RecentlyClassified | undefined
  onPress: () => void
}) {
  const label = railCategoryLabel(category)
  return (
    <Pressable
      accessibilityRole="button"
      aria-label={label}
      aria-selected={selected}
      onPress={onPress}
      className={cn(
        'relative min-h-[44px] flex-row items-center px-row-x-md active:bg-tint-press',
        selected && 'bg-bg-sunken',
        Platform.select({
          web: 'cursor-pointer outline-none hover:bg-tint-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring',
        }),
      )}
    >
      <TintLayer tint={tint} testID={`rail-sheet-tint-${category}`} />
      {selected ? (
        <View
          aria-hidden
          className="absolute bottom-0 right-0 top-0 w-[3px] bg-accent"
          style={POINTER_EVENTS_NONE}
        />
      ) : null}
      <Text className="font-medium">{label}</Text>
    </Pressable>
  )
}
