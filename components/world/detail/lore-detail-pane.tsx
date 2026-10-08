import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo } from 'react'
import { Controller, type Control } from 'react-hook-form'
import { View } from 'react-native'

import { EmbedWindowTextarea } from '@/components/compounds/embed-window-textarea'
import { FormRow } from '@/components/compounds/form-row'
import { gateDisabledReason } from '@/components/compounds/generation-gate-copy'
import { NumberInput } from '@/components/compounds/number-input'
import { RowDetailFrame } from '@/components/compounds/row-detail-frame'
import { HistoryTab } from '@/components/history/history-tab'
import { Autocomplete } from '@/components/ui/autocomplete'
import { Select } from '@/components/ui/select'
import { TabsContent } from '@/components/ui/tabs'
import { useCreateResetTab } from '@/hooks/use-create-reset-tab'
import type { RowSessionHandle } from '@/hooks/use-row-save-session'
import type { LoreSaveResult } from '@/lib/actions'
import { loreExport } from '@/lib/avts'
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
  const session = useLoreRowSession({
    rowId: row?.id ?? null,
    createSeq,
    values,
    resolver,
    onSave,
    onSaved,
    onRejected,
    onSession,
  })
  const { control } = session.form
  const [tab, setTab] = useCreateResetTab<LoreTab>(createSeq, 'body', 'body')
  const gate = { blocked, blockedReason }

  return (
    <RowDetailFrame
      session={session}
      nameField="title"
      savedName={values.title}
      namePlaceholder={t('world:detail.namePlaceholder')}
      nameTestID="world-detail-name"
      recentlyClassifiedLabel={
        recentlyClassified != null ? t('world:detail.recentlyClassified') : undefined
      }
      menuLabel={t('world:detail.menu.label')}
      menuEntries={(actions) =>
        loreMenuEntries({
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
      tabs={LORE_TABS.map((value) => ({ value, label: t(`world:lore.tabs.${value}`) }))}
      tabSelectLabel={t('world:detail.tabSelect')}
      committed={
        row == null
          ? null
          : {
              id: row.id,
              name: row.title,
              json: row,
              exportFile: () => loreExport(row, new Date()),
            }
      }
      blocked={blocked}
      blockedReason={blockedReason}
      hotkeysEnabled={hotkeysEnabled}
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
    </RowDetailFrame>
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
              casingNormalization="as-typed"
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
