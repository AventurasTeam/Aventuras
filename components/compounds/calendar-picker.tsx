import { useMemo, type ReactNode } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { Chip } from '@/components/ui/chip'
import { Select, type SelectOption } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { cn } from '@/lib/utils'

type CalendarType = 'built-in' | 'custom'

type CalendarOption = {
  id: string
  name: string
  type: CalendarType
  /**
   * Pre-formatted tier path used in the option row, e.g.
   * `year → month → day → hour → minute → second`. Truncates with
   * ellipsis when the row width can't fit the full string.
   */
  tierPath: string
}

type CalendarSummaryTier = {
  /** Tier name as it appears in the calendar definition (`year`, `month`, …). */
  name: string
  /**
   * Per-tier rollover detail. Caller pre-formats according to the
   * spec language (`rule: Gregorian leap`, `table: 28–31 days`,
   * `constant: 24 hours`, `base unit`).
   */
  detail: string
}

type CalendarSummaryData = {
  tiers: readonly CalendarSummaryTier[]
  /** `weekday: Sun–Sat (7-day cycle)` or `none`. */
  subdivisions: string
  /**
   * `enabled (preset names: First Age, Second Age, …)`,
   * `enabled (free-form)`, or `disabled`.
   */
  eras: string
  /**
   * Calendar's display-format render of a sample worldTime. Caller
   * supplies `April 28, 2026` / `12345.6` etc.; component only
   * paints. Optional — Wizard pre-origin renders a placeholder.
   */
  sampleRender?: string
  /** Override the `Sample render` label, e.g. `Placeholder` for Wizard. */
  sampleLabel?: string
}

type CalendarPickerProps = {
  options: readonly CalendarOption[]
  selectedId: string
  onSelect: (id: string) => void
  /** Summary block for the currently-selected calendar. Caller pre-formats. */
  summary: CalendarSummaryData

  /**
   * Render the `Manage calendars in Vault →` row at the popover /
   * sheet bottom. Default `true`; Wizard hides it (`false`)
   */
  showVaultTail?: boolean
  onManageInVault?: () => void

  /**
   * Render the `Edit in Vault →` action inside the summary panel.
   * Default `true`;
   */
  showEditAction?: boolean
  /** Override the action label (`Edit in Vault →`). */
  editActionLabel?: string
  onEditInVault?: () => void
  disabled?: boolean
  /**
   * Web-only browser tooltip surfaced on disabled controls.
   */
  disabledReason?: string

  /**
   * Layout direction:
   * - `stacked` (default) — picker above summary. Works at any
   *   width; matches App Settings + Story Settings wireframes.
   * - `side-by-side` — picker left, summary right. Wizard host
   *   uses this for the always-on adjacent summary framing.
   *   Auto-collapses to stacked on phone tier regardless.
   */
  layout?: 'stacked' | 'side-by-side'

  className?: string
}

export function CalendarPicker({
  options,
  selectedId,
  onSelect,
  summary,
  showVaultTail = true,
  onManageInVault,
  showEditAction = true,
  editActionLabel = 'Edit in Vault →',
  onEditInVault,
  disabled,
  disabledReason,
  layout = 'stacked',
  className,
}: CalendarPickerProps) {
  const tier = useTier()
  const stacked = layout === 'stacked' || tier === 'phone'

  const optsById = useMemo(() => new Map(options.map((o) => [o.id, o])), [options])

  const selectOptions: SelectOption[] = useMemo(
    () => options.map((o) => ({ value: o.id, label: o.name })),
    [options],
  )

  const tailAction = useMemo(
    () =>
      showVaultTail
        ? {
            label: 'Manage calendars in Vault →',
            onPress: () => onManageInVault?.(),
          }
        : undefined,
    [showVaultTail, onManageInVault],
  )

  const select = (
    <Select
      className="w-full"
      options={selectOptions}
      value={selectedId}
      onValueChange={onSelect}
      mode="dropdown"
      sheetSize="medium"
      disabled={disabled}
      placeholder="Select a calendar…"
      label={tier === 'phone' ? 'Calendars' : undefined}
      renderTrigger={({ selected, placeholder }) => {
        const cal = selected != null ? optsById.get(selected.value) : undefined
        return <CalendarTriggerContent option={cal} placeholder={placeholder ?? ''} />
      }}
      renderRow={({ option }) => {
        const cal = optsById.get(option.value)
        return cal ? <CalendarRowContent option={cal} /> : null
      }}
      tailAction={tailAction}
    />
  )

  return (
    <View className={cn(stacked ? 'flex-col gap-4' : 'flex-row items-start gap-6', className)}>
      <View className={stacked ? 'w-full' : 'w-80 shrink-0'}>
        {disabled && disabledReason && Platform.OS === 'web' ? (
          <div title={disabledReason} className="w-full">
            {select}
          </div>
        ) : (
          select
        )}
      </View>

      <View className={cn('min-w-0', stacked ? 'w-full' : 'flex-1')}>
        <CalendarSummary
          summary={summary}
          showEditAction={showEditAction}
          editActionLabel={editActionLabel}
          onEditInVault={onEditInVault}
          editDisabled={disabled === true}
          editDisabledReason={disabledReason}
        />
      </View>
    </View>
  )
}

function CalendarTriggerContent({
  option,
  placeholder,
}: {
  option?: CalendarOption
  placeholder: string
}) {
  return (
    <View className="min-w-0 flex-1 flex-row items-center gap-2">
      <Text size="sm" numberOfLines={1} className="shrink">
        {option != null ? option.name : placeholder}
      </Text>
      {option != null ? <Chip>{option.type}</Chip> : null}
    </View>
  )
}

function CalendarRowContent({ option }: { option: CalendarOption }) {
  const row = (
    <View className="flex-1 flex-col gap-0.5">
      <View className="flex-row items-center justify-between gap-2">
        <Text size="sm" numberOfLines={1} className="shrink font-medium">
          {option.name}
        </Text>
        <Chip>{option.type}</Chip>
      </View>
      <Text size="xs" variant="muted" numberOfLines={1}>
        {option.tierPath}
      </Text>
    </View>
  )
  if (Platform.OS === 'web') {
    return (
      <div title={option.tierPath} className="flex w-full">
        {row}
      </div>
    )
  }
  return row
}

function CalendarSummary({
  summary,
  showEditAction,
  editActionLabel,
  onEditInVault,
  editDisabled,
  editDisabledReason,
}: {
  summary: CalendarSummaryData
  showEditAction: boolean
  editActionLabel: string
  onEditInVault?: () => void
  editDisabled: boolean
  editDisabledReason?: string
}) {
  const sampleLabel = summary.sampleLabel ?? 'Sample render'
  return (
    <View className="rounded-md border border-border bg-bg-base p-4">
      <View className="gap-3">
        <SummarySection title="Tiers">
          {summary.tiers.length === 0 ? (
            <Text size="xs" variant="muted">
              —
            </Text>
          ) : (
            summary.tiers.map((t) => (
              <View key={t.name} className="flex-row items-baseline gap-2">
                <Text className="w-[72px] font-mono text-xs text-fg-secondary">{t.name}</Text>
                <Text size="xs" variant="muted" className="shrink">
                  · {t.detail}
                </Text>
              </View>
            ))
          )}
        </SummarySection>

        <SummaryRow label="Sub-divisions" value={summary.subdivisions} />
        <SummaryRow label="Eras" value={summary.eras} />
        <SummaryRow
          label={sampleLabel}
          value={summary.sampleRender ?? '—'}
          mono={summary.sampleRender != null}
        />

        {showEditAction ? (
          <View className="pt-1">
            <EditAction
              label={editActionLabel}
              onPress={onEditInVault}
              disabled={editDisabled}
              disabledReason={editDisabledReason}
            />
          </View>
        ) : null}
      </View>
    </View>
  )
}

function SummarySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-1">
      <Text size="xs" variant="muted" className="uppercase tracking-wider">
        {title}
      </Text>
      <View className="gap-0.5">{children}</View>
    </View>
  )
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View className="flex-row items-baseline gap-2">
      <Text size="xs" variant="muted" className="w-[110px] uppercase tracking-wider">
        {label}
      </Text>
      <Text size="xs" className={cn('shrink', mono && 'font-mono')}>
        {value}
      </Text>
    </View>
  )
}

function EditAction({
  label,
  onPress,
  disabled,
  disabledReason,
}: {
  label: string
  onPress?: () => void
  disabled: boolean
  disabledReason?: string
}) {
  const button = (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      disabled={disabled}
      // eslint-disable-next-line react-native/no-inline-styles -- rn-primitives wrappers don't gate disabled clicks on web; inline pointerEvents is the documented workaround.
      style={disabled ? { pointerEvents: 'none' } : undefined}
      className={cn(
        'self-start rounded-sm py-1',
        !disabled &&
          cn(
            'active:opacity-70',
            Platform.select({ web: 'cursor-pointer hover:opacity-70' }) ?? '',
          ),
        disabled && 'opacity-50',
      )}
    >
      <Text size="xs" className="font-medium text-accent">
        {label}
      </Text>
    </Pressable>
  )
  if (disabled && disabledReason && Platform.OS === 'web') {
    return (
      <div title={disabledReason} className="inline-flex">
        {button}
      </div>
    )
  }
  return button
}

export type { CalendarOption, CalendarPickerProps, CalendarSummaryData, CalendarSummaryTier }
