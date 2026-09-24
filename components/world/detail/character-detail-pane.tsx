import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo } from 'react'
import { useWatch } from 'react-hook-form'

import { TabsContent } from '@/components/ui/tabs'
import { characterDraftFrom, characterDraftSchema, stateOf, type CharacterDraft } from '@/lib/world'

import { CarryingTab } from '../tabs/carrying-tab'
import { CharacterConnections } from '../tabs/connections-tab'
import { CharacterIdentity } from '../tabs/identity-tab'
import { SettingsTab } from '../tabs/settings-tab'
import { useEntityRowSession } from '../use-entity-row-session'
import { entityFieldLabel, entityIssueText, lastSeenLine, leadDisabledReason } from '../world-copy'
import { OverviewTab, TrailingTabs } from './common-tabs'
import { asBaseControl, EntityDetailFrame, useEntityTab } from './entity-detail-frame'
import type { EntityPaneProps } from './entity-pane-props'
import { useRelationshipsBase } from './use-relationships-base'

const resolver = zodResolver(characterDraftSchema)
const fieldLabel = (field: string) => entityFieldLabel('character', field)

export function CharacterDetailPane({
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
  onSetLead,
  hotkeysEnabled = true,
}: EntityPaneProps) {
  const values = useMemo(
    () => characterDraftFrom(row, data.relationships),
    [row, data.relationships],
  )
  const session = useEntityRowSession<CharacterDraft>({
    kind: 'character',
    rowId: row?.id ?? null,
    createSeq,
    values,
    resolver,
    fieldLabel,
    issueText: entityIssueText,
    // Runs at save time; `relationshipsBase` below needs this session's dirty fields.
    onSave: async (draft) => {
      const result = await onSave({
        kind: 'character',
        draft,
        relationships: data.relationships,
        relationshipsBase: relationshipsBase.base,
      })
      if (result.status === 'ok') relationshipsBase.markSaved(draft.relationships)
      return result
    },
    onSaved,
    onRejected,
    onSession,
  })
  // `dirtyFields` holds labels, not keys.
  const relationshipsBase = useRelationshipsBase(
    session.dirtyFields.includes(fieldLabel('relationships')),
    data.relationships,
  )
  const { control, trigger } = session.form
  const [tab, setTab] = useEntityTab(row == null, createSeq, initialTab)
  // Lengths only, so typing in a row doesn't re-render the whole pane.
  const quantities = useWatch({ control, name: 'stackables', compute: (r) => r.length })
  const equipped = useWatch({ control, name: 'equippedItems', compute: (r) => r.length })
  const carried = useWatch({ control, name: 'inventory', compute: (r) => r.length })
  const relationships = useWatch({ control, name: 'relationships', compute: (r) => r.length })
  const gate = { blocked, blockedReason }
  return (
    <EntityDetailFrame
      kind="character"
      row={row}
      session={session}
      savedName={values.name}
      tab={tab}
      onTabChange={setTab}
      tabCounts={{
        carrying: quantities + equipped + carried,
        connections: relationships,
        involvements: data.involvements.length,
      }}
      recentlyClassified={recentlyClassified}
      lead={
        row == null
          ? undefined
          : {
              onSetLead: () => onSetLead(row.id),
              disabledReason: leadDisabledReason(row, data.leadId, blocked, blockedReason),
            }
      }
      hotkeysEnabled={hotkeysEnabled}
      {...gate}
    >
      <OverviewTab row={row} data={data} onRegionPress={setTab} onOpenEntity={onOpenEntity} />
      <TabsContent value="identity">
        <CharacterIdentity control={control} {...gate} />
      </TabsContent>
      <TabsContent value="carrying">
        <CarryingTab
          control={control}
          trigger={trigger}
          entities={data.entities}
          selfId={row?.id ?? null}
          {...gate}
        />
      </TabsContent>
      <TabsContent value="connections">
        <CharacterConnections
          control={control}
          trigger={trigger}
          selfId={row?.id ?? null}
          entities={data.entities}
          lastSeen={row == null ? null : lastSeenLine(stateOf(row, 'character'), data)}
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
