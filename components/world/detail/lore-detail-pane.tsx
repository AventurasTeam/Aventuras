import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useMemo, useState } from 'react'
import { Controller, type Control } from 'react-hook-form'
import { View } from 'react-native'

import { DetailTabs } from '@/components/compounds/detail-tabs'
import { EmbedWindowTextarea } from '@/components/compounds/embed-window-textarea'
import { FormRow } from '@/components/compounds/form-row'
import { gateDisabledReason } from '@/components/compounds/generation-gate-copy'
import { JSONViewer } from '@/components/compounds/json-viewer'
import { NumberInput } from '@/components/compounds/number-input'
import { OverflowMenu } from '@/components/compounds/overflow-menu'
import { RowLeaveDialog, RowSaveBar } from '@/components/compounds/row-save-session-chrome'
import { HistoryTab } from '@/components/history/history-tab'
import { DetailPane } from '@/components/shells/detail-pane'
import { Autocomplete } from '@/components/ui/autocomplete'
import { InlineEditableName } from '@/components/ui/inline-editable-name'
import { Select } from '@/components/ui/select'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { Tag } from '@/components/ui/tag'
import type { RowSessionHandle } from '@/hooks/use-row-save-session'
import type { LoreSaveResult } from '@/lib/actions'
import { INJECTION_MODES, type Lore } from '@/lib/db'
import { t } from '@/lib/i18n'
import type { RecentlyClassified } from '@/lib/row-signals'
import { loreDraftFrom, loreDraftSchema, type LoreDraft } from '@/lib/world'

import { PlaceholderTab } from '../tabs/placeholder-tab'
import { useLoreRowSession } from '../use-lore-row-session'
import { issueLabel, loreMenuEntries } from '../world-copy'
import { ListField, type Gate } from './fields'

const resolver = zodResolver(loreDraftSchema)

export const LORE_TABS = ['body', 'settings', 'history'] as const
export type LoreTab = (typeof LORE_TABS)[number]

// The Autocomplete canonicalizes only a committed pick; a variant typed and left must match too,
// or the branch lists `Cosmology` beside `cosmology`.
function canonicalCategory(category: string, categories: readonly string[]): string {
  const typed = category.trim().toLowerCase()
  return categories.find((c) => c.toLowerCase() === typed) ?? category
}

/** A new `[+] Blank` (create `seq`) lands on Body, whichever tab the previous row was on. */
function useLoreTab(createSeq: number | undefined) {
  const [tab, setTab] = useState<LoreTab>('body')
  // Synced during render so a new create draft never paints a frame on the previous tab.
  const [seenSeq, setSeenSeq] = useState(createSeq)
  if (createSeq !== seenSeq) {
    setSeenSeq(createSeq)
    if (createSeq != null) setTab('body')
  }
  return [tab, setTab] as const
}

export type LoreDetailPaneProps = {
  /** For the History tab's query. */
  branchId: string
  /** Null in create mode (`[+] Blank`). */
  row: Lore | null
  /** The create selection's `seq`; a new value resets the create draft. */
  createSeq?: number
  /** Distinct categories on the branch, for the Autocomplete's suggestions. */
  categories: readonly string[]
  recentlyClassified?: RecentlyClassified
  /** `isUserEditBlocked`: every control and Save disable with `blockedReason`. */
  blocked: boolean
  blockedReason?: string
  onSave: (draft: LoreDraft) => Promise<LoreSaveResult>
  /** After a successful save; the route selects the row (a create's new id). */
  onSaved: (id: string) => void
  /** A save failed, with its translated reason — the bar's notice has no visible text. */
  onRejected?: (reason: string) => void
  /** `⋯ → Delete`; the surface raises the confirm. */
  onDelete: (row: Lore) => void
  /** The surface routes row switches, `←`, category switches and GO TO through this. */
  onSession: (handle: RowSessionHandle | null) => void
  /** The host screen's focus state, for the save bar's Cmd/Ctrl-S. */
  hotkeysEnabled?: boolean
}

/** world.md → Lore — separate kind. */
export function LoreDetailPane({
  branchId,
  row,
  createSeq,
  categories,
  recentlyClassified,
  blocked,
  blockedReason,
  onSave,
  onSaved,
  onRejected,
  onDelete,
  onSession,
  hotkeysEnabled = true,
}: LoreDetailPaneProps) {
  const values = useMemo(() => loreDraftFrom(row), [row])
  const save = useCallback(
    (draft: LoreDraft) =>
      onSave({ ...draft, category: canonicalCategory(draft.category, categories) }),
    [onSave, categories],
  )
  const session = useLoreRowSession({
    rowId: row?.id ?? null,
    createSeq,
    values,
    resolver,
    onSave: save,
    onSaved,
    onRejected,
    onSession,
  })
  const { control } = session.form
  const [tab, setTab] = useLoreTab(createSeq)
  const changeTab = (value: string) => setTab(value as LoreTab)
  const rowId = row?.id ?? null
  const [jsonOpen, setJsonOpen] = useState(false)
  const [jsonRowId, setJsonRowId] = useState(rowId)
  if (rowId !== jsonRowId) {
    setJsonRowId(rowId)
    setJsonOpen(false)
  }
  const gate = { blocked, blockedReason }

  return (
    <View className="flex-1">
      <Tabs value={tab} onValueChange={changeTab} className="flex-1 gap-0">
        <DetailPane
          nameSlot={
            <View testID="world-detail-name">
              <Controller
                control={control}
                name="title"
                render={({ field }) => (
                  <InlineEditableName
                    value={field.value}
                    onChange={field.onChange}
                    savedValue={values.title}
                    placeholder={t('world:detail.namePlaceholder')}
                    size="lg"
                    disabled={blocked}
                    disabledReason={blockedReason}
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
              entries={loreMenuEntries({
                onViewJson: () => setJsonOpen(true),
                remove:
                  row == null
                    ? undefined
                    : {
                        onDelete: () => onDelete(row),
                        disabledReason: gateDisabledReason(blocked, blockedReason),
                      },
              })}
              disabled={row == null}
            />
          }
          tabs={
            <DetailTabs
              tabs={LORE_TABS.map((value) => ({ value, label: t(`world:lore.tabs.${value}`) }))}
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
          <TabsContent value="body">
            <LoreBody control={control} categories={categories} {...gate} />
          </TabsContent>
          <TabsContent value="settings">
            <LoreSettings control={control} {...gate} />
          </TabsContent>
          <TabsContent value="history">
            {row == null ? (
              <PlaceholderTab
                title={t('history:tab.afterSave')}
                body={t('history:tab.afterSaveBody')}
              />
            ) : (
              <HistoryTab branchId={branchId} targetTable="lore" targetId={row.id} />
            )}
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

// world.md → Body tab — lore.
function LoreBody({
  control,
  categories,
  blocked,
  blockedReason,
}: Gate & { control: Control<LoreDraft>; categories: readonly string[] }) {
  return (
    <View className="gap-4">
      <Controller
        control={control}
        name="category"
        render={({ field }) => (
          <FormRow label={t('world:lore.fields.category')}>
            <Autocomplete
              value={field.value}
              onValueChange={field.onChange}
              sourceList={categories}
              casingNormalization="canonical"
              createTailLabel={(value) => t('world:lore.fields.categoryTail', { value })}
              label={t('world:lore.fields.category')}
              placeholder={t('world:lore.fields.categoryPlaceholder')}
              disabled={blocked}
              disabledReason={blockedReason}
            />
          </FormRow>
        )}
      />
      <Controller
        control={control}
        name="body"
        render={({ field, fieldState }) => (
          <FormRow
            label={t('world:lore.fields.body')}
            error={issueLabel(fieldState.error?.message)}
          >
            <EmbedWindowTextarea
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              rows={12}
              maxRows={40}
              editable={!blocked}
              accessibilityHint={blocked ? blockedReason : undefined}
              aria-label={t('world:lore.fields.body')}
              aria-invalid={fieldState.error != null}
            />
          </FormRow>
        )}
      />
    </View>
  )
}

// world.md → Settings tab — lore.
function LoreSettings({ control, blocked, blockedReason }: Gate & { control: Control<LoreDraft> }) {
  const gate = { blocked, blockedReason }
  return (
    <View className="gap-4">
      <Controller
        control={control}
        name="injectionMode"
        render={({ field }) => (
          <FormRow label={t('world:lore.fields.injectionMode')}>
            {/* Options with help text make Select render radio. */}
            <Select
              label={t('world:lore.fields.injectionMode')}
              value={field.value}
              onValueChange={field.onChange}
              disabled={blocked}
              disabledReason={blockedReason}
              options={INJECTION_MODES.map((mode) => ({
                value: mode,
                label: t(`world:fields.injection.${mode}`),
                description: t(`world:lore.injection.${mode}Help`),
              }))}
            />
          </FormRow>
        )}
      />
      <Controller
        control={control}
        name="priority"
        render={({ field, fieldState }) => (
          <FormRow
            label={t('world:lore.fields.priority')}
            hint={t('world:lore.fields.priorityHint')}
            error={issueLabel(fieldState.error?.message)}
          >
            <View className="w-28">
              <NumberInput
                value={field.value}
                onChange={field.onChange}
                label={t('world:lore.fields.priority')}
                disabled={blocked}
                disabledReason={blockedReason}
                invalid={fieldState.error != null}
              />
            </View>
          </FormRow>
        )}
      />
      <ListField
        control={control}
        name="keywords"
        label={t('world:lore.fields.keywords')}
        placeholder={t('world:lore.fields.keywordsPlaceholder')}
        hint={t('world:lore.fields.keywordsHint')}
        {...gate}
      />
      <ListField
        control={control}
        name="tags"
        label={t('world:lore.fields.tags')}
        placeholder={t('world:lore.fields.tagsPlaceholder')}
        {...gate}
      />
    </View>
  )
}
