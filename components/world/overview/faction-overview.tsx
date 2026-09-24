import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { chipPreview, membersOf, stateOf } from '@/lib/world'

import { ChipRow, LinkRegion, Region, type KindBodyProps } from './overview-parts'

const PREVIEW = 3

// world.md → Faction Overview.
export function FactionOverviewBody({
  entity,
  entities,
  onRegionPress,
  onOpenEntity,
}: KindBodyProps) {
  const state = stateOf(entity, 'faction')
  const standing = state.standing?.trim() ?? ''
  const agenda = chipPreview(state.agenda ?? [])
  const members = membersOf(entity.id, entities)
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
      <LinkRegion
        label={t('labelWithCount', { label: t('world:overview.members'), value: members.length })}
        tab="connections"
        onRegionPress={onRegionPress}
        targets={members.slice(0, PREVIEW)}
        meta={
          members.length > PREVIEW
            ? t('world:overview.more', { count: members.length - PREVIEW })
            : undefined
        }
        derived
        onOpenEntity={onOpenEntity}
        testID="overview-members"
      />
    </>
  )
}
