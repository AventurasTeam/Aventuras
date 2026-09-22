import { zodResolver } from '@hookform/resolvers/zod'
import { CircleDot } from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { Controller, useWatch, type Control } from 'react-hook-form'
import { View } from 'react-native'

import { DetailTabs } from '@/components/compounds/detail-tabs'
import { EntryRefPicker } from '@/components/compounds/entry-ref-picker'
import { FormRow } from '@/components/compounds/form-row'
import { JSONViewer } from '@/components/compounds/json-viewer'
import { OverflowMenu } from '@/components/compounds/overflow-menu'
import { RowLeaveDialog, RowSaveBar } from '@/components/compounds/row-save-session-chrome'
import { SwitchRow } from '@/components/compounds/switch-row'
import { DetailPane } from '@/components/shells/detail-pane'
import { Autocomplete } from '@/components/ui/autocomplete'
import { Icon } from '@/components/ui/icon'
import { InlineEditableName } from '@/components/ui/inline-editable-name'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { Tag } from '@/components/ui/tag'
import { Textarea } from '@/components/ui/textarea'
import type { RowSessionHandle } from '@/hooks/use-row-save-session'
import type { PlotSaveResult } from '@/lib/actions'
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
import { PlotHistoryPlaceholder } from './plot-history-placeholder'
import { PlotIcon } from './plot-icon'
import { plotKindName } from './plot-selection'
import { usePlotRowSession } from './use-plot-row-session'

const TABS = ['overview', 'involvements', 'awareness', 'history'] as const
type HappeningTab = (typeof TABS)[number]

function isHappeningTab(value: string | undefined): value is HappeningTab {
  return (TABS as readonly (string | undefined)[]).includes(value)
}

const resolver = zodResolver(happeningDraftSchema)

// plot.md → Raw JSON viewer: a happening shows its committed link rows inline.
function rawHappening(row: Happening, links: HappeningLinks) {
  return {
    ...row,
    involvements: links.involvements.map(({ id, entityId, role }) => ({ id, entityId, role })),
    awareness: links.awareness.map(
      ({ id, characterId, learnedAtEntryId, decayResistance, source }) => ({
        id,
        characterId,
        learnedAtEntryId,
        decayResistance,
        source,
      }),
    ),
  }
}

export type HappeningDetailPaneProps = {
  /** Null in create mode (`[+] Blank`). */
  row: Happening | null
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
  /** A deep link's `tab`; an unknown value opens Overview. */
  initialTab?: string
  onSave: (draft: HappeningDraft) => Promise<PlotSaveResult>
  /** After a successful save; the route selects the row (a create's new id). */
  onSaved: (id: string) => void
  /** A save failed, with its translated reason — the bar's notice is tooltip-only on phone. */
  onRejected?: (reason: string) => void
  /** The surface routes row switches, `←`, segment switches and GO TO through this. */
  onSession: (handle: RowSessionHandle | null) => void
  /** A link row's `Open in World`; the route navigates through the session's leave guard. */
  onOpenEntity: (entity: Entity) => void
  /** The host screen's focus state, for the save bar's Cmd/Ctrl-S. */
  hotkeysEnabled?: boolean
}

export function HappeningDetailPane({
  row,
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
  hotkeysEnabled = true,
}: HappeningDetailPaneProps) {
  const values = useMemo(() => happeningDraftFrom(row, links), [row, links])
  const session = usePlotRowSession<HappeningDraft>({
    kind: 'happening',
    rowId: row?.id ?? null,
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

  const [tab, setTab] = useState<string>(isHappeningTab(initialTab) ? initialTab : 'overview')
  const [jsonOpen, setJsonOpen] = useState(false)
  const icon = useWatch({ control, name: 'icon' })
  const commonKnowledge = useWatch({ control, name: 'commonKnowledge' })
  // Lengths only, so typing in a link row doesn't re-render the whole pane.
  const involvementCount = useWatch({ control, name: 'involvements', compute: (r) => r.length })
  const awarenessCount = useWatch({ control, name: 'awareness', compute: (r) => r.length })

  return (
    <View className="flex-1">
      <Tabs value={tab} onValueChange={setTab} className="flex-1 gap-0">
        <DetailPane
          kindIcon={<PlotIcon kind="happening" icon={icon} className="h-4 w-4" />}
          kindName={plotKindName('happening')}
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
          // plot.md → Self-documenting: the row's ⊙ mirrors beside the Overview toggle, not here.
          badges={
            recentlyClassified != null ? (
              <Tag tone="recently-classified">{t('plot:detail.recentlyClassified')}</Tag>
            ) : undefined
          }
          overflowMenu={
            <OverflowMenu
              label={t('plot:detail.menu.label')}
              entries={plotMenuEntries('happening', () => setJsonOpen(true))}
              disabled={row == null}
            />
          }
          tabs={
            <DetailTabs
              tabs={[
                { value: 'overview', label: t('plot:detail.tabs.overview') },
                {
                  value: 'involvements',
                  label: t('plot:detail.tabs.involvements'),
                  count: involvementCount,
                },
                {
                  value: 'awareness',
                  label: t('plot:detail.tabs.awareness'),
                  // The rows are skipped while common knowledge is on, so they don't count.
                  count: commonKnowledge ? undefined : awarenessCount,
                },
                { value: 'history', label: t('plot:detail.tabs.history') },
              ]}
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
            <PlotHistoryPlaceholder />
          </TabsContent>
        </DetailPane>
      </Tabs>
      <RowLeaveDialog session={session} blocked={blocked} blockedReason={blockedReason} />
      {row != null ? (
        <JSONViewer
          open={jsonOpen}
          onOpenChange={setJsonOpen}
          name={row.title}
          data={rawHappening(row, links)}
        />
      ) : null}
    </View>
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
