import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { charactersAt, holdersOf, itemsAt, locationAncestors, stateOf } from '@/lib/world'

import {
  DerivedNamesRegion,
  NamesRegion,
  refTargets,
  Region,
  type KindBodyProps,
} from './overview-parts'

function ConditionRegion({
  condition,
  onRegionPress,
}: {
  condition: string | undefined
  onRegionPress: KindBodyProps['onRegionPress']
}) {
  const value = condition?.trim() ?? ''
  return (
    <Region
      label={t('world:overview.condition')}
      tab="identity"
      onRegionPress={onRegionPress}
      empty={value === ''}
      testID="overview-condition"
    >
      <Text size="sm">{value}</Text>
    </Region>
  )
}

// world.md → Location Overview.
export function LocationOverviewBody({ entity, entities, onRegionPress }: KindBodyProps) {
  const state = stateOf(entity, 'location')
  const ancestors = locationAncestors(entity.id, entities)
  return (
    <>
      <NamesRegion
        label={t('world:overview.partOf')}
        tab="connections"
        onRegionPress={onRegionPress}
        targets={ancestors}
        joiner={` ${t('world:overview.within')} `}
        testID="overview-part-of"
      />
      <ConditionRegion condition={state.condition} onRegionPress={onRegionPress} />
      <DerivedNamesRegion
        label={t('world:overview.charactersHere')}
        onRegionPress={onRegionPress}
        entities={charactersAt(entity.id, entities)}
        testID="overview-characters-here"
      />
      <DerivedNamesRegion
        label={t('world:overview.itemsHere')}
        onRegionPress={onRegionPress}
        entities={itemsAt(entity.id, entities)}
        testID="overview-items-here"
      />
    </>
  )
}

// world.md → Item Overview. Both positions render when they disagree (shown, not fixed).
export function ItemOverviewBody({ entity, entities, onRegionPress }: KindBodyProps) {
  const state = stateOf(entity, 'item')
  const holders = holdersOf(entity.id, entities)
  const at = refTargets(state.at_location_id, entities)
  return (
    <>
      <ConditionRegion condition={state.condition} onRegionPress={onRegionPress} />
      {holders.length > 0 ? (
        <NamesRegion
          label={t('world:overview.heldBy')}
          tab="connections"
          onRegionPress={onRegionPress}
          targets={holders}
          testID="overview-held-by"
        />
      ) : null}
      {at.length > 0 || holders.length === 0 ? (
        <NamesRegion
          label={t('world:overview.position')}
          tab="connections"
          onRegionPress={onRegionPress}
          targets={at}
          testID="overview-position"
        />
      ) : null}
    </>
  )
}
