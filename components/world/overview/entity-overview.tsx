import { View } from 'react-native'

import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import type { CalendarSystem } from '@/lib/calendar'
import type { Entity } from '@/lib/db'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { chipPreview } from '@/lib/world'

import { CharacterOverviewBody } from './character-overview'
import { FactionOverviewBody } from './faction-overview'
import {
  ChipRow,
  PortraitSlot,
  Region,
  regionName,
  StatusRow,
  type KindBodyProps,
  type RegionPress,
} from './overview-parts'
import { ItemOverviewBody, LocationOverviewBody } from './place-overview'

export type OverviewVariant = 'panel' | 'peek'

export type EntityOverviewProps = {
  /** The committed row. */
  entity: Entity
  /** The branch's entities, for links and inverse lists. */
  entities: readonly Entity[]
  /** The branch's current world time in seconds (`branchWorldTime`). */
  worldTime: number
  calendar: CalendarSystem
  /** `peek` is the 440 px projection: compact portrait below the prose. */
  variant: OverviewVariant
  onRegionPress: RegionPress
  onOpenEntity: (id: string) => void
}

function KindBody(props: KindBodyProps) {
  switch (props.entity.kind) {
    case 'character':
      return <CharacterOverviewBody {...props} />
    case 'location':
      return <LocationOverviewBody {...props} />
    case 'item':
      return <ItemOverviewBody {...props} />
    case 'faction':
      return <FactionOverviewBody {...props} />
  }
}

/** world.md → Overview: read-mostly glance card; every region routes to its edit tab. */
export function EntityOverview({ variant, ...props }: EntityOverviewProps) {
  const { entity, onRegionPress } = props
  const isPhone = useTier() === 'phone'
  // world.md → Mobile expression: the 220 px portrait reflows below the prose on phone.
  const compact = variant === 'peek' || isPhone
  const description = entity.description?.trim() ?? ''
  const tags = chipPreview(entity.tags, entity.tags.length)
  return (
    <View testID="entity-overview" className="w-full min-w-0">
      <View className={cn('min-w-0', compact ? 'gap-2' : 'flex-row items-start gap-5')}>
        <View className="min-w-0 flex-1 gap-1">
          <StatusRow entity={entity} onRegionPress={onRegionPress} />
          <Region
            tab="identity"
            onRegionPress={onRegionPress}
            empty={description === ''}
            accessibleName={
              description === '' ? regionName(t('world:fields.description'), 'identity') : undefined
            }
            testID="overview-description"
          >
            <Text size="sm">{description}</Text>
          </Region>
          {compact ? <PortraitSlot entity={entity} size="md" /> : null}
          <KindBody {...props} />
          <Region
            label={t('world:overview.tags')}
            tab="settings"
            onRegionPress={onRegionPress}
            empty={tags.shown.length === 0}
            testID="overview-tags"
          >
            <ChipRow preview={tags} />
          </Region>
        </View>
        {compact ? null : <PortraitSlot entity={entity} size="lg" />}
      </View>
    </View>
  )
}
