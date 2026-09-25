import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { charactersAt, holdersOf, itemsAt, locationAncestors, stateOf } from '@/lib/world'

import { NamesRegion, Region, type KindBodyProps } from './overview-parts'

const PREVIEW = 3

function countLabel(label: string, value: number): string {
  return t('labelWithCount', { label, value })
}

function moreMeta(total: number): string | undefined {
  return total > PREVIEW ? t('world:overview.more', { count: total - PREVIEW }) : undefined
}

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
  const people = charactersAt(entity.id, entities)
  const things = itemsAt(entity.id, entities)
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
      <NamesRegion
        label={countLabel(t('world:overview.charactersHere'), people.length)}
        tab="connections"
        onRegionPress={onRegionPress}
        targets={people.slice(0, PREVIEW)}
        meta={moreMeta(people.length)}
        derived
        testID="overview-characters-here"
      />
      <NamesRegion
        label={countLabel(t('world:overview.itemsHere'), things.length)}
        tab="connections"
        onRegionPress={onRegionPress}
        targets={things.slice(0, PREVIEW)}
        meta={moreMeta(things.length)}
        derived
        testID="overview-items-here"
      />
    </>
  )
}

// world.md → Item Overview. Both positions render when they disagree (shown, not fixed).
export function ItemOverviewBody({ entity, entities, onRegionPress }: KindBodyProps) {
  const state = stateOf(entity, 'item')
  const byId = new Map(entities.map((e) => [e.id, e]))
  const holders = holdersOf(entity.id, entities)
  const at = state.at_location_id == null ? [] : [byId.get(state.at_location_id) ?? null]
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
