import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo } from 'react'

import { TabsContent } from '@/components/ui/tabs'
import { factionDraftFrom, factionDraftSchema, type FactionDraft } from '@/lib/world'

import { FactionConnections } from '../tabs/connections-tab'
import { FactionIdentity } from '../tabs/identity-tab'
import { SettingsTab } from '../tabs/settings-tab'
import { useEntityRowSession } from '../use-entity-row-session'
import { entityFieldLabel, entityIssueText } from '../world-copy'
import { OverviewTab, TrailingTabs } from './common-tabs'
import { asBaseControl, EntityDetailFrame, useEntityTab } from './entity-detail-frame'
import type { EntityPaneProps } from './entity-pane-props'

const resolver = zodResolver(factionDraftSchema)
const fieldLabel = (field: string) => entityFieldLabel('faction', field)

export function FactionDetailPane({
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
  const values = useMemo(() => factionDraftFrom(row), [row])
  const session = useEntityRowSession<FactionDraft>({
    kind: 'faction',
    rowId: row?.id ?? null,
    createSeq,
    values,
    resolver,
    fieldLabel,
    issueText: entityIssueText,
    onSave: (draft) => onSave({ kind: 'faction', draft }),
    onSaved,
    onRejected,
    onSession,
  })
  const { control } = session.form
  const [tab, setTab] = useEntityTab(row == null, createSeq, initialTab)
  const gate = { blocked, blockedReason }
  return (
    <EntityDetailFrame
      kind="faction"
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
      <OverviewTab row={row} data={data} onRegionPress={setTab} />
      <TabsContent value="identity">
        <FactionIdentity control={control} {...gate} />
      </TabsContent>
      <TabsContent value="connections">
        <FactionConnections
          selfId={row?.id ?? null}
          entities={data.entities}
          onOpenEntity={onOpenEntity}
        />
      </TabsContent>
      <TabsContent value="settings">
        <SettingsTab control={asBaseControl(control)} {...gate} />
      </TabsContent>
      <TrailingTabs data={data} onOpenHappening={onOpenHappening} />
    </EntityDetailFrame>
  )
}
