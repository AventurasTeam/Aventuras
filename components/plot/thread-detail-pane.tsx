import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { Controller, type Control } from 'react-hook-form'
import { View } from 'react-native'

import { DetailTabs } from '@/components/compounds/detail-tabs'
import { FormRow } from '@/components/compounds/form-row'
import { JSONViewer } from '@/components/compounds/json-viewer'
import { OverflowMenu } from '@/components/compounds/overflow-menu'
import { RowLeaveDialog, RowSaveBar } from '@/components/compounds/row-save-session-chrome'
import { DetailPane } from '@/components/shells/detail-pane'
import { Autocomplete } from '@/components/ui/autocomplete'
import { InlineEditableName } from '@/components/ui/inline-editable-name'
import { Select } from '@/components/ui/select'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { Tag } from '@/components/ui/tag'
import { Textarea } from '@/components/ui/textarea'
import type { RowSessionHandle } from '@/hooks/use-row-save-session'
import type { PlotSaveResult } from '@/lib/actions'
import { INJECTION_MODES, type Thread } from '@/lib/db'
import type { EntryIndex } from '@/lib/entry-refs'
import { t } from '@/lib/i18n'
import { THREAD_TIERS } from '@/lib/list-modules'
import { threadDraftFrom, threadDraftSchema, type ThreadDraft } from '@/lib/plot'
import type { RecentlyClassified } from '@/lib/row-signals'

import { EntryRefField } from './entry-ref-field'
import {
  categoryTailLabel,
  iconFromOption,
  iconOptionValue,
  plotIconOptions,
  plotMenuEntries,
  threadFieldLabel,
  validationText,
} from './plot-copy'
import { PlotHistoryPlaceholder } from './plot-history-placeholder'
import { THREAD_TABS, type ThreadTab } from './plot-selection'
import { usePlotRowSession } from './use-plot-row-session'

const resolver = zodResolver(threadDraftSchema)

export type ThreadDetailPaneProps = {
  /** Null in create mode (`[+] Blank`). */
  row: Thread | null
  /** The create selection's `seq`; a new value resets the create draft. */
  createSeq?: number
  /** A ready index — the route mounts no pane before it is. */
  entryIndex: EntryIndex
  /** Distinct categories on the branch, for the Autocomplete's suggestions. */
  categories: readonly string[]
  recentlyClassified?: RecentlyClassified
  /** `isUserEditBlocked`: fields and Save disable with `blockedReason`. */
  blocked: boolean
  blockedReason?: string
  /** A deep link's `tab`. */
  initialTab?: ThreadTab
  onSave: (draft: ThreadDraft) => Promise<PlotSaveResult>
  /** After a successful save; the route selects the row (a create's new id). */
  onSaved: (id: string) => void
  /** A save failed, with its translated reason — the bar's notice is tooltip-only on phone. */
  onRejected?: (reason: string) => void
  /** The surface routes row switches, `←`, segment switches and GO TO through this. */
  onSession: (handle: RowSessionHandle | null) => void
  /** The host screen's focus state, for the save bar's Cmd/Ctrl-S. */
  hotkeysEnabled?: boolean
}

export function ThreadDetailPane({
  row,
  createSeq,
  entryIndex,
  categories,
  recentlyClassified,
  blocked,
  blockedReason,
  initialTab,
  onSave,
  onSaved,
  onRejected,
  onSession,
  hotkeysEnabled = true,
}: ThreadDetailPaneProps) {
  const values = useMemo(() => threadDraftFrom(row), [row])
  const session = usePlotRowSession<ThreadDraft>({
    kind: 'thread',
    rowId: row?.id ?? null,
    createSeq,
    values,
    resolver,
    fieldLabel: threadFieldLabel,
    issueText: validationText,
    onSave,
    onSaved,
    onRejected,
    onSession,
  })
  const { control } = session.form

  const [tab, setTab] = useState<string>(initialTab ?? 'overview')
  const [jsonOpen, setJsonOpen] = useState(false)

  return (
    <View className="flex-1">
      <Tabs value={tab} onValueChange={setTab} className="flex-1 gap-0">
        <DetailPane
          nameSlot={
            <Controller
              control={control}
              name="title"
              render={({ field }) => (
                <InlineEditableName
                  value={field.value}
                  onChange={field.onChange}
                  placeholder={t('plot:detail.namePlaceholder')}
                  size="lg"
                  disabled={blocked}
                />
              )}
            />
          }
          // plot.md → Row indicators: the row's status pill mirrors to Overview, not the head.
          badges={
            recentlyClassified != null ? (
              <Tag tone="recently-classified">{t('plot:detail.recentlyClassified')}</Tag>
            ) : undefined
          }
          overflowMenu={
            <OverflowMenu
              label={t('plot:detail.menu.label')}
              entries={plotMenuEntries('thread', () => setJsonOpen(true))}
              disabled={row == null}
            />
          }
          tabs={
            <DetailTabs
              tabs={THREAD_TABS.map((value) => ({ value, label: t(`plot:detail.tabs.${value}`) }))}
              value={tab}
              onValueChange={setTab}
              selectLabel={t('plot:detail.tabSelect')}
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
          <TabsContent value="overview">
            <ThreadOverviewForm
              control={control}
              row={row}
              entryIndex={entryIndex}
              categories={categories}
              blocked={blocked}
              blockedReason={blockedReason}
            />
          </TabsContent>
          <TabsContent value="history">
            <PlotHistoryPlaceholder />
          </TabsContent>
        </DetailPane>
      </Tabs>
      <RowLeaveDialog session={session} blocked={blocked} blockedReason={blockedReason} />
      {row != null ? (
        <JSONViewer open={jsonOpen} onOpenChange={setJsonOpen} name={row.title} data={row} />
      ) : null}
    </View>
  )
}

type OverviewProps = {
  control: Control<ThreadDraft>
  row: Thread | null
  entryIndex: EntryIndex
  categories: readonly string[]
  blocked: boolean
  blockedReason?: string
}

// plot.md → Threads side → Overview. Options with help text make Select render radio.
function ThreadOverviewForm({
  control,
  row,
  entryIndex,
  categories,
  blocked,
  blockedReason,
}: OverviewProps) {
  return (
    <View className="gap-4">
      <Controller
        control={control}
        name="status"
        render={({ field }) => (
          <FormRow label={t('plot:fields.status')}>
            <Select
              label={t('plot:fields.status')}
              value={field.value}
              onValueChange={field.onChange}
              disabled={blocked}
              options={THREAD_TIERS.map((value) => ({ value, label: t(`plot:tiers.${value}`) }))}
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
              // The committed key, not the draft's: an unknown stored key stays pickable.
              options={plotIconOptions(row?.icon ?? null)}
            />
          </FormRow>
        )}
      />
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
        name="injectionMode"
        render={({ field }) => (
          <FormRow label={t('plot:fields.injectionMode')}>
            <Select
              label={t('plot:fields.injectionMode')}
              value={field.value}
              onValueChange={field.onChange}
              disabled={blocked}
              options={INJECTION_MODES.map((mode) => ({
                value: mode,
                label: t(`plot:fields.injection.${mode}`),
                description: t(`plot:fields.injection.${mode}Help`),
              }))}
            />
          </FormRow>
        )}
      />
      <FormRow label={t('plot:fields.triggeredAt')}>
        <EntryRefField id={row?.triggeredAtEntryId ?? null} entryIndex={entryIndex} />
      </FormRow>
      {row != null && (row.status === 'resolved' || row.status === 'failed') ? (
        <FormRow label={t('plot:fields.resolvedAt')}>
          <EntryRefField id={row.resolvedAtEntryId} entryIndex={entryIndex} />
        </FormRow>
      ) : null}
    </View>
  )
}
