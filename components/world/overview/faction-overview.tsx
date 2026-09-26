import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { chipPreview, membersOf, stateOf } from '@/lib/world'

import { ChipRow, DerivedNamesRegion, Region, type KindBodyProps } from './overview-parts'

// world.md → Faction Overview.
export function FactionOverviewBody({ entity, entities, onRegionPress }: KindBodyProps) {
  const state = stateOf(entity, 'faction')
  const standing = state.standing?.trim() ?? ''
  const agenda = chipPreview(state.agenda ?? [])
  return (
    <>
      <Region
        label={t('world:overview.standing')}
        tab="identity"
        onRegionPress={onRegionPress}
        empty={standing === ''}
        testID="overview-standing"
      >
        <Text size="sm">{standing}</Text>
      </Region>
      <Region
        label={t('world:overview.agenda')}
        tab="identity"
        onRegionPress={onRegionPress}
        empty={agenda.shown.length === 0}
        testID="overview-agenda"
      >
        <ChipRow preview={agenda} />
      </Region>
      <DerivedNamesRegion
        label={t('world:overview.members')}
        onRegionPress={onRegionPress}
        entities={membersOf(entity.id, entities)}
        testID="overview-members"
      />
    </>
  )
}
