import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useWatch } from 'react-hook-form'

import { TabsContent } from '@/components/ui/tabs'
import {
  characterDraftFrom,
  characterDraftSchema,
  stateOf,
  type CharacterDraft,
  type RelationshipLink,
} from '@/lib/world'

import { CarryingTab } from '../tabs/carrying-tab'
import { CharacterConnections } from '../tabs/connections-tab'
import { CharacterIdentity } from '../tabs/identity-tab'
import { SettingsTab } from '../tabs/settings-tab'
import { useEntityRowSession } from '../use-entity-row-session'
import { entityFieldLabel, entityIssueText, leadDisabledReason } from '../world-copy'
import { lastSeenLine, OverviewTab, TrailingTabs } from './common-tabs'
import { asBaseControl, EntityDetailFrame, useEntityTab } from './entity-detail-frame'
import type { EntityPaneProps } from './entity-pane-props'

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
  // Null follows the store; while Relationships is dirty, the links its draft was based on.
  // After a successful save, the list as saved (typing during the save keeps it dirty).
  const [frozenBase, setFrozenBase] = useState<readonly RelationshipLink[] | null>(null)
  const session = useEntityRowSession<CharacterDraft>({
    kind: 'character',
    rowId: row?.id ?? null,
    createSeq,
    values,
    resolver,
    fieldLabel,
    issueText: entityIssueText,
    onSave: async (draft) => {
      const result = await onSave({
        kind: 'character',
        draft,
        relationships: data.relationships,
        relationshipsBase: frozenBase ?? data.relationships,
      })
      if (result.status === 'ok')
        setFrozenBase(
          draft.relationships.map((r) => ({
            rowId: '',
            otherId: r.otherId,
            selfToOther: r.selfToOther,
            otherToSelf: r.otherToSelf,
          })),
        )
      return result
    },
    onSaved,
    onRejected,
    onSession,
  })
  // `dirtyFields` holds labels, not keys. Render-phase sync, the NumberInput idiom.
  const relationshipsDirty = session.dirtyFields.includes(fieldLabel('relationships'))
  if (relationshipsDirty && frozenBase === null) setFrozenBase(data.relationships)
  if (!relationshipsDirty && frozenBase !== null) setFrozenBase(null)
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
          self={row}
          entities={data.entities}
          lastSeen={row == null ? null : lastSeenLine(stateOf(row, 'character'), data)}
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
