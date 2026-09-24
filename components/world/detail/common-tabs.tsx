import { TabsContent } from '@/components/ui/tabs'
import type { CharacterState, Entity } from '@/lib/db'
import { t } from '@/lib/i18n'
import { lastSeenSpan } from '@/lib/world'

import { EntityOverview } from '../overview/entity-overview'
import { InvolvementsTab } from '../tabs/involvements-tab'
import { PlaceholderTab } from '../tabs/placeholder-tab'
import { lastSeenDetail } from '../world-copy'
import type { EntityPaneData } from './entity-pane-props'
import type { EntityTab } from './entity-tabs'

export function OverviewTab({
  row,
  data,
  onRegionPress,
  onOpenEntity,
}: {
  row: Entity | null
  data: EntityPaneData
  onRegionPress: (tab: EntityTab) => void
  onOpenEntity: (id: string) => void
}) {
  return (
    <TabsContent value="overview">
      {row == null ? (
        <PlaceholderTab
          title={t('world:detail.overviewAfterSave')}
          body={t('world:detail.overviewAfterSaveBody')}
        />
      ) : (
        <EntityOverview
          entity={row}
          entities={data.entities}
          worldTime={data.worldTime}
          calendar={data.calendar}
          variant="panel"
          onRegionPress={onRegionPress}
          onOpenEntity={onOpenEntity}
        />
      )}
    </TabsContent>
  )
}

/** Assets and History are placeholders in M4; Involvements is read-only (world.md → Assets, Involvements, History). */
export function TrailingTabs({
  data,
  onOpenHappening,
}: {
  data: EntityPaneData
  onOpenHappening: (id: string) => void
}) {
  return (
    <>
      <TabsContent value="assets">
        <PlaceholderTab
          title={t('world:detail.assetsPlaceholder')}
          body={t('world:detail.assetsPlaceholderBody')}
        />
      </TabsContent>
      <TabsContent value="involvements">
        <InvolvementsTab rows={data.involvements} onOpenHappening={onOpenHappening} />
      </TabsContent>
      <TabsContent value="history">
        <PlaceholderTab
          title={t('world:detail.historyPlaceholder')}
          body={t('world:detail.historyPlaceholderBody')}
        />
      </TabsContent>
    </>
  )
}

/** Connections → Last seen for a character, or null when never seen. */
export function lastSeenLine(state: CharacterState, data: EntityPaneData): string | null {
  const seen = state.lastSeenAt
  if (seen == null) return null
  return lastSeenDetail({
    location:
      seen.locationId == null
        ? undefined
        : data.entities.find((e) => e.id === seen.locationId)?.name,
    position: data.entryIndex.get(seen.entryId)?.position,
    span: lastSeenSpan(seen, data.worldTime, data.calendar),
  })
}
