import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo } from 'react'

import { TabsContent } from '@/components/ui/tabs'
import {
  locationDraftFrom,
  locationDraftSchema,
  PARENT_CYCLE,
  WORLD_ISSUE,
  type LocationDraft,
} from '@/lib/world'

import { LocationConnections } from '../tabs/connections-tab'
import { LocationIdentity } from '../tabs/identity-tab'
import { SettingsTab } from '../tabs/settings-tab'
import { useEntityRowSession } from '../use-entity-row-session'
import { entityFieldLabel, entityIssueText } from '../world-copy'
import { OverviewTab, TrailingTabs } from './common-tabs'
import { asBaseControl, EntityDetailFrame, useEntityTab } from './entity-detail-frame'
import type { EntityPaneProps } from './entity-pane-props'

const resolver = zodResolver(locationDraftSchema)
const fieldLabel = (field: string) => entityFieldLabel('location', field)
// data-model.md → LocationState: a handler parent-cycle refusal is a form error on the parent.
const FIELD_ERRORS = {
  [PARENT_CYCLE]: { field: 'parentLocationId', message: WORLD_ISSUE.parentCycle },
} as const

export function LocationDetailPane({
  row,
  createSeq,
  data,
  recentlyClassified,
  blocked,
  blockedReason,
  initialTab,
  onSave,
  onSaved,
  onRejected,
  onSession,
  onOpenEntity,
  onOpenHappening,
  hotkeysEnabled = true,
}: EntityPaneProps) {
  const values = useMemo(() => locationDraftFrom(row), [row])
  const session = useEntityRowSession<LocationDraft>({
    kind: 'location',
    rowId: row?.id ?? null,
    createSeq,
    values,
    resolver,
    fieldLabel,
    issueText: entityIssueText,
    onSave: (draft) => onSave({ kind: 'location', draft }),
    onSaved,
    onRejected,
    onSession,
    fieldErrors: FIELD_ERRORS,
  })
  const { control } = session.form
  const [tab, setTab] = useEntityTab(row == null, createSeq, initialTab)
  const gate = { blocked, blockedReason }
  return (
    <EntityDetailFrame
      kind="location"
      row={row}
      session={session}
      savedName={values.name}
      tab={tab}
      onTabChange={setTab}
      tabCounts={{ involvements: data.involvements.length }}
      recentlyClassified={recentlyClassified}
      hotkeysEnabled={hotkeysEnabled}
      {...gate}
    >
      <OverviewTab row={row} data={data} onRegionPress={setTab} onOpenEntity={onOpenEntity} />
      <TabsContent value="identity">
        <LocationIdentity control={control} {...gate} />
      </TabsContent>
      <TabsContent value="connections">
        <LocationConnections
          control={control}
          self={row}
          entities={data.entities}
          onOpenEntity={onOpenEntity}
          {...gate}
        />
      </TabsContent>
      <TabsContent value="settings">
        <SettingsTab control={asBaseControl(control)} {...gate} />
      </TabsContent>
      <TrailingTabs data={data} onOpenHappening={onOpenHappening} />
    </EntityDetailFrame>
  )
}
