import { useState, type ReactNode } from 'react'
import { Controller, type Control } from 'react-hook-form'
import { View } from 'react-native'

import { DetailTabs } from '@/components/compounds/detail-tabs'
import { JSONViewer } from '@/components/compounds/json-viewer'
import { OverflowMenu } from '@/components/compounds/overflow-menu'
import { RowLeaveDialog, RowSaveBar } from '@/components/compounds/row-save-session-chrome'
import { DetailPane } from '@/components/shells/detail-pane'
import { InlineEditableName } from '@/components/ui/inline-editable-name'
import { Tabs } from '@/components/ui/tabs'
import { Tag } from '@/components/ui/tag'
import type { RowSaveSession } from '@/hooks/use-row-save-session'
import type { Entity, EntityKind } from '@/lib/db'
import { t } from '@/lib/i18n'
import type { RecentlyClassified } from '@/lib/row-signals'
import type { EntityBaseDraft } from '@/lib/world'

import { entityMenuEntries } from '../world-copy'
import { entityTabs, type EntityTab } from './entity-tabs'

/** Every kind's draft extends the base; RHF's Control is invariant in its values type. */
export function asBaseControl<D extends EntityBaseDraft>(
  control: Control<D>,
): Control<EntityBaseDraft> {
  return control as unknown as Control<EntityBaseDraft>
}

/** A new `[+] Blank` (create `seq`) lands on Identity: the Overview has nothing to glance at yet. */
export function useEntityTab(
  isCreate: boolean,
  createSeq: number | undefined,
  initialTab: EntityTab | undefined,
) {
  const [tab, setTab] = useState<EntityTab>(
    createSeq != null ? 'identity' : (initialTab ?? (isCreate ? 'identity' : 'overview')),
  )
  // Synced during render so a new create draft never paints a frame on the previous tab.
  const [seenSeq, setSeenSeq] = useState(createSeq)
  if (createSeq !== seenSeq) {
    setSeenSeq(createSeq)
    if (createSeq != null) setTab('identity')
  }
  return [tab, setTab] as const
}

type EntityDetailFrameProps<Draft extends EntityBaseDraft> = {
  kind: EntityKind
  row: Entity | null
  session: RowSaveSession<Draft>
  /** The committed name, which InlineEditableName's Escape restores. */
  savedName: string
  tab: EntityTab
  onTabChange: (tab: EntityTab) => void
  tabCounts: Partial<Record<EntityTab, number>>
  recentlyClassified?: RecentlyClassified
  /** Characters only; absent in create mode. */
  lead?: { onSetLead: () => void; disabledReason?: string }
  blocked: boolean
  blockedReason?: string
  hotkeysEnabled: boolean
  /** One `TabsContent` per tab of the kind. */
  children: ReactNode
}

/** world.md → Detail head structure: name, Recently classified, ⋯ — then the tab strip. */
export function EntityDetailFrame<Draft extends EntityBaseDraft>({
  kind,
  row,
  session,
  savedName,
  tab,
  onTabChange,
  tabCounts,
  recentlyClassified,
  lead,
  blocked,
  blockedReason,
  hotkeysEnabled,
  children,
}: EntityDetailFrameProps<Draft>) {
  const rowId = row?.id ?? null
  const [jsonOpen, setJsonOpen] = useState(false)
  const [jsonRowId, setJsonRowId] = useState(rowId)
  if (rowId !== jsonRowId) {
    setJsonRowId(rowId)
    setJsonOpen(false)
  }
  const baseControl = asBaseControl(session.form.control)
  const changeTab = (value: string) => onTabChange(value as EntityTab)
  return (
    <View className="flex-1">
      <Tabs value={tab} onValueChange={changeTab} className="flex-1 gap-0">
        <DetailPane
          nameSlot={
            <View testID="world-detail-name">
              <Controller
                control={baseControl}
                name="name"
                render={({ field }) => (
                  <InlineEditableName
                    value={field.value}
                    onChange={field.onChange}
                    savedValue={savedName}
                    placeholder={t('world:detail.namePlaceholder')}
                    size="lg"
                    disabled={blocked}
                  />
                )}
              />
            </View>
          }
          badges={
            recentlyClassified != null ? (
              <Tag tone="recently-classified">{t('world:detail.recentlyClassified')}</Tag>
            ) : undefined
          }
          overflowMenu={
            <OverflowMenu
              label={t('world:detail.menu.label')}
              entries={entityMenuEntries(kind, { onViewJson: () => setJsonOpen(true), lead })}
              disabled={row == null}
            />
          }
          tabs={
            <DetailTabs
              tabs={entityTabs(kind).map((value) => ({
                value,
                label: t(`world:detail.tabs.${value}`),
                count: tabCounts[value],
              }))}
              value={tab}
              onValueChange={changeTab}
              selectLabel={t('world:detail.tabSelect')}
            />
          }
          saveBar={
            <RowSaveBar
              session={session}
              enabled={hotkeysEnabled}
              blocked={blocked}
              blockedReason={blockedReason}
            />
          }
        >
          {children}
        </DetailPane>
      </Tabs>
      <RowLeaveDialog session={session} blocked={blocked} blockedReason={blockedReason} />
      {row != null ? (
        <JSONViewer open={jsonOpen} onOpenChange={setJsonOpen} name={row.name} data={row} />
      ) : null}
    </View>
  )
}
