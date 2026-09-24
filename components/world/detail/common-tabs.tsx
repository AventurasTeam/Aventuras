import { TabsContent } from '@/components/ui/tabs'
import type { Entity } from '@/lib/db'
import { t } from '@/lib/i18n'

import type { EntityPaneData } from './entity-pane-props'
import type { EntityTab } from './entity-tabs'
import { EntityOverview } from '../overview/entity-overview'
import { InvolvementsTab } from '../tabs/involvements-tab'
import { PlaceholderTab } from '../tabs/placeholder-tab'

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

/** world.md → Assets, Involvements, History. Assets and History are placeholders. */
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
