import { HistoryTab } from '@/components/history/history-tab'
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
}: {
  row: Entity | null
  data: EntityPaneData
  onRegionPress: (tab: EntityTab) => void
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
        />
      )}
    </TabsContent>
  )
}

/** world.md → Assets, Involvements, History. Assets is a placeholder. */
export function TrailingTabs({
  row,
  data,
  onOpenHappening,
}: {
  row: Entity | null
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
        {row == null ? (
          <PlaceholderTab
            title={t('history:tab.afterSave')}
            body={t('history:tab.afterSaveBody')}
          />
        ) : (
          <HistoryTab
            key={row.id}
            branchId={data.branchId}
            targetTable="entities"
            targetId={row.id}
          />
        )}
      </TabsContent>
    </>
  )
}
