import * as React from 'react'
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
   * ellipsis when the row width can't fit the full string —
   * pathologically deep calendars (8+ tiers) lose tail tiers in the
   * row; the summary always recovers the full structure.
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
   * sheet bottom. Default `true`; Wizard hides it (`false`) per
   * spec — Vault routing mid-creation requires preserving wizard
   * state, broader problem than this primitive solves.
   */
  showVaultTail?: boolean
  onManageInVault?: () => void

  /**
   * Render the `Edit in Vault →` action inside the summary panel.
   * Default `true`; surfaces that don't host a Vault editor (or
   * gate that affordance entirely) pass `false`.
   */
  showEditAction?: boolean
  /** Override the action label (`Edit in Vault →`). */
  editActionLabel?: string
  onEditInVault?: () => void

  /**
   * Disables the picker trigger AND the Edit action. Used by the
   * edit-restrictions principle — surfaces gate when generation is
   * in flight. The summary itself stays visible and read-only.
   */
  disabled?: boolean
  /**
   * Web-only browser tooltip surfaced on disabled controls. Pattern
   * spec calls out `Generation is in flight. Cancel to edit.`
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

// CalendarPicker — picker dropdown + summary panel. Spec:
// docs/ui/patterns/calendar-picker.md.
//
// Sits on top of the Select primitive's `dropdown` mode using its
// `renderTrigger` / `renderRow` / `tailAction` extension points.
// That keeps Select-shaped behaviors (tier-adapted Popover↔Sheet
// dispatch, keyboard navigation, focus management, accessibility
// semantics) intact while letting us surface the calendar-specific
// chrome — name + type chip in the trigger, two-line rows with
// chips and tier-paths, the `Manage calendars in Vault →` tail.
//
// **Scope.** Renders the picker control + the summary panel as one
// cohesive compound. Per-host wrapper differences (framing copy,
// outer layout, swap-warning AlertDialog) live with each host's
// surface; the swap-warning modal is a Story-Settings-specific
// composition that lives outside this compound (followup: dedicated
// CalendarSwapDialog using AlertDialog when surface lands).
//
// **Disabled gate.** `disabled` covers both the picker trigger and
// the Edit action. The summary block itself remains visible —
// edit-restrictions principle says read-only inspection is allowed
// even while generation is in flight; only mutating affordances
// disable.
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

  // Index by id so renderTrigger / renderRow can resolve back to
  // the rich CalendarOption the caller passed in. Cheap to recompute.
  const optsById = React.useMemo(() => new Map(options.map((o) => [o.id, o])), [options])

  const selectOptions: SelectOption[] = React.useMemo(
    () => options.map((o) => ({ value: o.id, label: o.name })),
    [options],
  )

  const tailAction = React.useMemo(
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
      // `w-full` on the trigger: when the picker sits inside the
      // disabled-state wrapper `<div>` (display:flex row), Radix /
      // RN-Web's intermediate wrappers don't propagate stretch on
      // the inline-axis. Force the trigger full-width directly.
      // Note: `className` only flows to the trigger inside Select's
      // `DropdownBranch`; it does NOT thread to Sheet / Popover
      // content.
      className="w-full"
      options={selectOptions}
      value={selectedId}
      onValueChange={onSelect}
      mode="dropdown"
      sheetSize="medium"
      disabled={disabled}
      placeholder="Select a calendar…"
      // Phone-tier bottom sheet uses `label` as the visible heading —
      // matches the convention the spec calls out for picker-on-phone.
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
      <View
        className={stacked ? 'w-full' : 'shrink-0'}
        style={stacked ? undefined : { width: 320 }}
      >
        {disabled && disabledReason && Platform.OS === 'web' ? (
          // Block-level wrapper (no `display: flex`): `display: flex`
          // with a default `flex-direction: row` makes inner Root
          // shrink to its content width since flex items don't
          // stretch on the inline-axis. Plain block + width 100%
          // lets RN-Web's Root (a View, block-level flex column)
          // fill the wrapper's width naturally.
          <div title={disabledReason} style={{ width: '100%' }}>
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

// Trigger content — shown between the trigger's left edge and the
// chevron. Select.Trigger's outer chrome (border, height, focus ring)
// stays; we only own the inner row.
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

// Two-line option row: name + type chip on top, tier-path below.
// Lives inside Select.Item's `customContent` slot — selection
// indicator (check) sits on the left edge automatically.
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
  // Native `title` attr on web for the full tier path —
  // pathologically deep calendars (8+ tiers) overflow the row.
  if (Platform.OS === 'web') {
    return (
      <div title={option.tierPath} style={{ display: 'flex', width: '100%' }}>
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

function SummarySection({ title, children }: { title: string; children: React.ReactNode }) {
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
      <div title={disabledReason} style={{ display: 'inline-flex' }}>
        {button}
      </div>
    )
  }
  return button
}

export type { CalendarOption, CalendarSummaryData, CalendarSummaryTier, CalendarPickerProps }
