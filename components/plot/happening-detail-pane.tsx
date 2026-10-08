import { zodResolver } from '@hookform/resolvers/zod'
import { CircleDot } from 'lucide-react-native'
import { useMemo } from 'react'
import { Controller, useWatch, type Control } from 'react-hook-form'
import { View } from 'react-native'

import { EntryRefPicker } from '@/components/compounds/entry-ref-picker'
import { FormRow } from '@/components/compounds/form-row'
import { gateDisabledReason } from '@/components/compounds/generation-gate-copy'
import { RowDetailFrame } from '@/components/compounds/row-detail-frame'
import { SwitchRow } from '@/components/compounds/switch-row'
import { HistoryTab } from '@/components/history/history-tab'
import { Autocomplete } from '@/components/ui/autocomplete'
import { EmptyState } from '@/components/ui/empty-state'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useCreateResetTab } from '@/hooks/use-create-reset-tab'
import type { RowSessionHandle } from '@/hooks/use-row-save-session'
import type { PlotSaveResult } from '@/lib/actions'
import { happeningExport } from '@/lib/avts'
import type { Entity, Happening } from '@/lib/db'
import type { EntryRef } from '@/lib/entry-refs'
import { t } from '@/lib/i18n'
import {
  happeningDraftFrom,
  happeningDraftSchema,
  type HappeningDraft,
  type HappeningLinks,
} from '@/lib/plot'
import type { RecentlyClassified } from '@/lib/row-signals'

import { AwarenessEditor } from './awareness-editor'
import { CommonKnowledgeNotice } from './common-knowledge-notice'
import { InvolvementsEditor } from './involvements-editor'
import {
  categoryTailLabel,
  happeningFieldLabel,
  happeningIssueText,
  iconFromOption,
  iconOptionValue,
  issueLabel,
  plotIconOptions,
  plotMenuEntries,
} from './plot-copy'
import { HAPPENING_TABS, type HappeningTab } from './plot-selection'
import { usePlotRowSession } from './use-plot-row-session'

const resolver = zodResolver(happeningDraftSchema)

// plot.md → Raw JSON viewer: a happening shows its committed link rows inline.
function rawHappening(row: Happening, links: HappeningLinks) {
  return {
    ...row,
    involvements: links.involvements.map(({ id, entityId, role }) => ({ id, entityId, role })),
    awareness: links.awareness.map(
      ({ id, characterId, learnedAtEntryId, decayResistance, retrievalCount, source }) => ({
        id,
        characterId,
        learnedAtEntryId,
        decayResistance,
        retrievalCount,
        source,
      }),
    ),
  }
}

export type HappeningDetailPaneProps = {
  /** Null in create mode (`[+] Blank`). */
  row: Happening | null
  /** The create selection's `seq`; a new value resets the create draft. */
  createSeq?: number
  /** For the History tab's query. */
  branchId: string
  /** The row's committed involvement and awareness rows; memoize by identity. */
  links: HappeningLinks
  /** The branch's entities, for the Involvements and Awareness pickers. */
  entities: readonly Entity[]
  /** A ready entry index's `entries`, newest first — the route mounts no pane before it is. */
  entries: readonly EntryRef[]
  /** Distinct categories on the branch, for the Autocomplete's suggestions. */
  categories: readonly string[]
  recentlyClassified?: RecentlyClassified
  /** `isUserEditBlocked`: fields and Save disable with `blockedReason`. */
  blocked: boolean
  blockedReason?: string
  /** A deep link's `tab`. */
  initialTab?: HappeningTab
  onSave: (draft: HappeningDraft) => Promise<PlotSaveResult>
  /** After a successful save; the route selects the row (a create's new id). */
  onSaved: (id: string) => void
  /** A save failed, with its translated reason — the bar's notice has no visible text. */
  onRejected?: (reason: string) => void
  /** The surface routes row switches, `←`, segment switches and GO TO through this. */
  onSession: (handle: RowSessionHandle | null) => void
  /** A link row's `Open in World`; the route navigates through the session's leave guard. */
  onOpenEntity: (entity: Entity) => void
  /** `⋯ → Delete happening`; the surface raises the confirm. */
  onDelete: (row: Happening) => void
  /** The host screen's focus state, for the save bar's Cmd/Ctrl-S. */
  hotkeysEnabled?: boolean
}

export function HappeningDetailPane({
  row,
  createSeq,
  branchId,
  links,
  entities,
  entries,
  categories,
  recentlyClassified,
  blocked,
  blockedReason,
  initialTab,
  onSave,
  onSaved,
  onRejected,
  onSession,
  onOpenEntity,
  onDelete,
  hotkeysEnabled = true,
}: HappeningDetailPaneProps) {
  const values = useMemo(() => happeningDraftFrom(row, links), [row, links])
  const session = usePlotRowSession<HappeningDraft>({
    kind: 'happening',
    rowId: row?.id ?? null,
    createSeq,
    values,
    resolver,
    fieldLabel: happeningFieldLabel,
    issueText: happeningIssueText,
    onSave,
    onSaved,
    onRejected,
    onSession,
  })
  const { control, trigger } = session.form

  const [tab, setTab] = useCreateResetTab<HappeningTab>(
    createSeq,
    'overview',
    initialTab ?? 'overview',
  )
  const commonKnowledge = useWatch({ control, name: 'commonKnowledge' })
  // Lengths only, so typing in a link row doesn't re-render the whole pane.
  const involvementCount = useWatch({ control, name: 'involvements', compute: (r) => r.length })
  const awarenessCount = useWatch({ control, name: 'awareness', compute: (r) => r.length })
  const tabCounts: Partial<Record<HappeningTab, number>> = {
    involvements: involvementCount,
    // Common knowledge makes every character aware, so the rows don't count.
    awareness: commonKnowledge ? undefined : awarenessCount,
  }

  return (
    <RowDetailFrame
      session={session}
      nameField="title"
      savedName={values.title}
      namePlaceholder={t('plot:detail.namePlaceholder')}
      // plot.md → Self-documenting: the row's ⊙ mirrors beside the Overview toggle, not here.
      recentlyClassifiedLabel={
        recentlyClassified != null ? t('plot:detail.recentlyClassified') : undefined
      }
      menuLabel={t('plot:detail.menu.label')}
      menuEntries={(actions) =>
        plotMenuEntries('happening', {
          ...actions,
          remove:
            row == null
              ? undefined
              : {
                  onDelete: () => onDelete(row),
                  disabledReason: gateDisabledReason(blocked, blockedReason),
                },
        })
      }
      tab={tab}
      onTabChange={setTab}
      tabs={HAPPENING_TABS.map((value) => ({
        value,
        label: t(`plot:detail.tabs.${value}`),
        count: tabCounts[value],
      }))}
      tabSelectLabel={t('plot:detail.tabSelect')}
      committed={
        row == null
          ? null
          : {
              id: row.id,
              name: row.title,
              json: rawHappening(row, links),
              exportFile: () => happeningExport(row, new Date()),
            }
      }
      blocked={blocked}
      blockedReason={blockedReason}
      hotkeysEnabled={hotkeysEnabled}
    >
      <TabsContent value="overview">
        <HappeningOverviewForm
          control={control}
          row={row}
          entries={entries}
          categories={categories}
          blocked={blocked}
          blockedReason={blockedReason}
        />
      </TabsContent>
      <TabsContent value="involvements">
        <InvolvementsEditor
          control={control}
          trigger={trigger}
          entities={entities}
          blocked={blocked}
          blockedReason={blockedReason}
          onOpenEntity={onOpenEntity}
        />
      </TabsContent>
      <TabsContent value="awareness">
        {/* The rows stay in the draft, still validated and saved; toggling off shows them again. */}
        {commonKnowledge ? (
          <CommonKnowledgeNotice />
        ) : (
          <AwarenessEditor
            control={control}
            trigger={trigger}
            entities={entities}
            entries={entries}
            blocked={blocked}
            blockedReason={blockedReason}
            onOpenEntity={onOpenEntity}
          />
        )}
      </TabsContent>
      <TabsContent value="history">
        {row == null ? (
          <EmptyState title={t('history:tab.afterSave')} subtext={t('history:tab.afterSaveBody')} />
        ) : (
          <HistoryTab branchId={branchId} targetTable="happenings" targetId={row.id} />
        )}
      </TabsContent>
    </RowDetailFrame>
  )
}

type OverviewProps = {
  control: Control<HappeningDraft>
  row: Happening | null
  entries: readonly EntryRef[]
  categories: readonly string[]
  blocked: boolean
  blockedReason?: string
}

// plot.md → Happenings side → Overview. Both time-anchor fields render; the schema refine
// reports a double anchor on `temporal` and disables Save.
function HappeningOverviewForm({
  control,
  row,
  entries,
  categories,
  blocked,
  blockedReason,
}: OverviewProps) {
  return (
    <View className="gap-4">
      <Controller
        control={control}
        name="description"
        render={({ field }) => (
          <FormRow label={t('plot:fields.description')}>
            <Textarea
              value={field.value}
              onChangeText={field.onChange}
              rows={4}
              editable={!blocked}
              accessibilityHint={blocked ? blockedReason : undefined}
              aria-label={t('plot:fields.description')}
            />
          </FormRow>
        )}
      />
      <Controller
        control={control}
        name="category"
        render={({ field }) => (
          <FormRow label={t('plot:fields.category')}>
            <Autocomplete
              value={field.value}
              onValueChange={field.onChange}
              sourceList={categories}
              casingNormalization="as-typed"
              createTailLabel={categoryTailLabel}
              label={t('plot:fields.category')}
              placeholder={t('plot:fields.categoryPlaceholder')}
              disabled={blocked}
              disabledReason={blockedReason}
            />
          </FormRow>
        )}
      />
      <Controller
        control={control}
        name="icon"
        render={({ field }) => (
          <FormRow label={t('plot:fields.icon')}>
            <Select
              label={t('plot:fields.icon')}
              mode="dropdown"
              value={iconOptionValue(field.value)}
              onValueChange={(value) => field.onChange(iconFromOption(value))}
              disabled={blocked}
              disabledReason={blockedReason}
              // The committed key, not the draft's: an unknown stored key stays pickable.
              options={plotIconOptions(row?.icon ?? null)}
            />
          </FormRow>
        )}
      />
      <Controller
        control={control}
        name="commonKnowledge"
        render={({ field }) => (
          // forms.md → SwitchRow; plot.md → the row's ⊙ mirrors here, on/off with the toggle.
          <SwitchRow
            label={t('plot:fields.commonKnowledge')}
            hint={t('plot:fields.commonKnowledgeHelp')}
            leading={
              <Icon
                as={CircleDot}
                size="sm"
                className={field.value ? 'text-fg-primary' : 'text-fg-muted'}
              />
            }
            checked={field.value}
            onCheckedChange={field.onChange}
            disabled={blocked}
            disabledReason={blockedReason}
          />
        )}
      />
      <Controller
        control={control}
        name="occurredAtEntryId"
        // The double-anchor issue lives on `temporal`; a plain onChange here would leave it stale.
        rules={{ deps: ['temporal'] }}
        render={({ field }) => (
          <FormRow label={t('plot:fields.occurredAt')}>
            <EntryRefPicker
              value={field.value}
              onChange={field.onChange}
              entries={entries}
              label={t('plot:fields.occurredAt')}
              placeholder={t('plot:fields.occurredAtPlaceholder')}
              disabled={blocked}
              disabledReason={blockedReason}
              testID="occurred-at"
            />
          </FormRow>
        )}
      />
      <Controller
        control={control}
        name="temporal"
        render={({ field, fieldState }) => (
          <FormRow
            label={t('plot:fields.temporal')}
            hint={t('plot:fields.temporalHint')}
            error={issueLabel(fieldState.error?.message)}
          >
            <Input
              value={field.value}
              onChangeText={field.onChange}
              placeholder={t('plot:fields.temporalPlaceholder')}
              editable={!blocked}
              accessibilityHint={blocked ? blockedReason : undefined}
              aria-label={t('plot:fields.temporal')}
              aria-invalid={fieldState.invalid}
            />
          </FormRow>
        )}
      />
    </View>
  )
}
