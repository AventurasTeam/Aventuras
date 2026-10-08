import type { ReactNode } from 'react'
import type { Control } from 'react-hook-form'

import { RowDetailFrame } from '@/components/compounds/row-detail-frame'
import { useCreateResetTab } from '@/hooks/use-create-reset-tab'
import type { RowSaveSession } from '@/hooks/use-row-save-session'
import { entityExport } from '@/lib/avts'
import type { Entity, EntityKind } from '@/lib/db'
import { t } from '@/lib/i18n'
import type { RecentlyClassified } from '@/lib/row-signals'
import type { EntityBaseDraft } from '@/lib/world'

import { deleteDisabledReason } from '../delete-copy'
import { entityMenuEntries } from '../world-copy'
import { entityTabs, type EntityTab } from './entity-tabs'

/** Every kind's draft extends the base; RHF's Control is invariant in its values type. */
export function asBaseControl<D extends EntityBaseDraft>(
  control: Control<D>,
): Control<EntityBaseDraft> {
  return control as unknown as Control<EntityBaseDraft>
}

// The same invariance through the session's form; the frame binds only the base draft's `name`.
function asBaseSession<D extends EntityBaseDraft>(
  session: RowSaveSession<D>,
): RowSaveSession<EntityBaseDraft> {
  return session as unknown as RowSaveSession<EntityBaseDraft>
}

function openingTab(
  isCreate: boolean,
  createSeq: number | undefined,
  initialTab: EntityTab | undefined,
): EntityTab {
  if (createSeq != null) return 'identity'
  if (initialTab != null) return initialTab
  return isCreate ? 'identity' : 'overview'
}

/** A new `[+] Blank` (create `seq`) lands on Identity: Overview has nothing to glance at yet. */
export function useEntityTab(
  isCreate: boolean,
  createSeq: number | undefined,
  initialTab: EntityTab | undefined,
) {
  return useCreateResetTab<EntityTab>(
    createSeq,
    'identity',
    openingTab(isCreate, createSeq, initialTab),
  )
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
  leadId: string | null
  /** `⋯ → Delete entity`; the frame computes the entry's disabled reason from `row`/`leadId`. */
  onDelete: (row: Entity) => void
  blocked: boolean
  blockedReason?: string
  hotkeysEnabled: boolean
  /** One `TabsContent` per tab of the kind. */
  children: ReactNode
}

/** world.md → Detail head structure. */
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
  leadId,
  onDelete,
  blocked,
  blockedReason,
  hotkeysEnabled,
  children,
}: EntityDetailFrameProps<Draft>) {
  const remove =
    row == null
      ? undefined
      : {
          onDelete: () => onDelete(row),
          disabledReason: deleteDisabledReason(row, leadId, blocked, blockedReason),
        }
  return (
    <RowDetailFrame
      session={asBaseSession(session)}
      nameField="name"
      savedName={savedName}
      namePlaceholder={t('world:detail.namePlaceholder')}
      nameTestID="world-detail-name"
      recentlyClassifiedLabel={
        recentlyClassified != null ? t('world:detail.recentlyClassified') : undefined
      }
      menuLabel={t('world:detail.menu.label')}
      menuEntries={(actions) => entityMenuEntries(kind, { ...actions, lead, remove })}
      tab={tab}
      onTabChange={onTabChange}
      tabs={entityTabs(kind).map((value) => ({
        value,
        label: t(`world:detail.tabs.${value}`),
        count: tabCounts[value],
      }))}
      tabSelectLabel={t('world:detail.tabSelect')}
      committed={
        row == null
          ? null
          : {
              id: row.id,
              name: row.name,
              json: row,
              exportFile: () => entityExport(row, new Date()),
            }
      }
      blocked={blocked}
      blockedReason={blockedReason}
      hotkeysEnabled={hotkeysEnabled}
    >
      {children}
    </RowDetailFrame>
  )
}
