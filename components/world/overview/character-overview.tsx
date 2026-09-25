import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { carryingSummary, chipPreview, lastSeenSpan, stateOf, visualParts } from '@/lib/world'

import { lastSeenText } from '../world-copy'
import { ChipRow, NamesRegion, Region, type KindBodyProps } from './overview-parts'

// world.md → Character Overview (top-down).
export function CharacterOverviewBody({
  entity,
  entities,
  worldTime,
  calendar,
  onRegionPress,
}: KindBodyProps) {
  const state = stateOf(entity, 'character')
  const byId = new Map(entities.map((e) => [e.id, e]))
  const visual = visualParts(state.visual)
  const traits = chipPreview(state.traits)
  const drives = chipPreview(state.drives)
  const carrying = carryingSummary(state)
  const location =
    state.current_location_id == null ? [] : [byId.get(state.current_location_id) ?? null]
  const faction = state.faction_id == null ? [] : [byId.get(state.faction_id) ?? null]
  const lastSeen = lastSeenText(lastSeenSpan(state.lastSeenAt, worldTime, calendar))
  const carryingEmpty =
    carrying.stackables.length === 0 && carrying.equipped === 0 && carrying.carried === 0
  return (
    <>
      <Region
        label={t('world:overview.visual')}
        tab="identity"
        onRegionPress={onRegionPress}
        empty={visual.length === 0}
        testID="overview-visual"
      >
        <Text size="sm">{visual.join(' · ')}</Text>
      </Region>
      <Region
        label={t('world:overview.traits')}
        tab="identity"
        onRegionPress={onRegionPress}
        empty={traits.shown.length === 0}
        testID="overview-traits"
      >
        <ChipRow preview={traits} />
      </Region>
      <Region
        label={t('world:overview.drives')}
        tab="identity"
        onRegionPress={onRegionPress}
        empty={drives.shown.length === 0}
        testID="overview-drives"
      >
        <ChipRow preview={drives} />
      </Region>
      <NamesRegion
        label={t('world:overview.in')}
        tab="connections"
        onRegionPress={onRegionPress}
        targets={location}
        meta={lastSeen ?? undefined}
        testID="overview-in"
      />
      <NamesRegion
        label={t('world:overview.with')}
        tab="connections"
        onRegionPress={onRegionPress}
        targets={faction}
        testID="overview-with"
      />
      <Region
        label={t('world:overview.carrying')}
        tab="carrying"
        onRegionPress={onRegionPress}
        empty={carryingEmpty}
        testID="overview-carrying"
      >
        {carrying.stackables.length > 0 ? (
          <Text size="sm">
            {carrying.stackables
              .map((s) => t('world:overview.stackable', { count: s.count, key: s.key }))
              .join(' · ')}
          </Text>
        ) : null}
        <Text size="xs" variant="muted">
          {t('world:overview.carryingCounts', {
            equipped: carrying.equipped,
            carried: carrying.carried,
          })}
        </Text>
      </Region>
    </>
  )
}
