import * as RadioGroupBase from '@rn-primitives/radio-group'
import { useMemo, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Platform, Pressable, ScrollView, View, type ViewProps, type ViewStyle } from 'react-native'

import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, type SelectOption } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { relativeTimeLabel, t } from '@/lib/i18n'
import { normalizeTerm } from '@/lib/keyword-terms'
import { cn } from '@/lib/utils'
import { RENAME_ISSUE, renameIssue, type RenameIssue } from '@/lib/world'

import {
  computeDivergence,
  mergeChips,
  type DiffPayload,
  type EntitySummary,
  type Resolution,
  type ScalarField,
} from './collision-resolve-diff'
import {
  initMergeState,
  mergeReducer,
  mergeResolution,
  type MergeAction,
} from './collision-resolve-machine'

type Mode = 'merge' | 'rename' | 'keep'

type Side = 'A' | 'B'

const SIDE_WORD = { A: 'older', B: 'newer' } as const satisfies Record<Side, string>

// world.md → Merge: stacked choices clamp prose values and expand them in place.
const PROSE_FIELDS: ReadonlySet<ScalarField> = new Set<ScalarField>([
  'description',
  'retiredReason',
])
const STACKED_CLAMP_LINES = 3
// rn-primitives doesn't gate disabled clicks on web; needs an inline style.
const GATED: ViewStyle = { pointerEvents: 'none' }
const ARROW_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

const RENAME_ISSUE_TEXT: Record<RenameIssue, () => string> = {
  [RENAME_ISSUE.emptyName]: () => t('collisionDialog.renameIssue.emptyName'),
  [RENAME_ISSUE.stillColliding]: () => t('collisionDialog.renameIssue.stillColliding'),
}

type CollisionResolveDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  entityA: EntitySummary // older by createdAt; default canonical
  entityB: EntitySummary // newer
  /** Rejects with an Error whose message is user-facing text; the dialog shows it inline. */
  onResolve: (resolution: Resolution) => Promise<void>
  /** Set while a write is gated (a turn in flight): every submit disables and shows it. */
  blockedReason?: string
}

type BodyProps = {
  onSubmit: (resolution: Resolution) => void
  onCancel: () => void
  submitting: boolean
  blockedReason?: string
  error: string | null
}

function ageOf(entity: EntitySummary, nowMs: number): string {
  return relativeTimeLabel(Date.parse(entity.createdAt), nowMs)
}

function markCanonical(label: string, canonical: boolean): string {
  return canonical ? t('collisionDialog.canonicalSuffix', { label }) : label
}

function sideCaption(side: Side, entity: EntitySummary, nowMs: number): string {
  const when = ageOf(entity, nowMs)
  return side === 'A'
    ? t('collisionDialog.olderSide', { when })
    : t('collisionDialog.newerSide', { when })
}

function fieldValue(field: ScalarField, entity: EntitySummary): string {
  switch (field) {
    case 'name':
      return entity.name
    case 'description':
      return entity.description ?? t('collisionDialog.emptyValue')
    case 'retiredReason':
      return entity.retiredReason ?? t('collisionDialog.emptyValue')
    case 'status':
      return t(`world:status.${entity.status}`)
    case 'injectionMode':
      return t(`world:fields.injection.${entity.injectionMode}`)
    case 'priority':
      return String(entity.priority)
  }
}

export function CollisionResolveDialog({
  open,
  onOpenChange,
  entityA,
  entityB,
  onResolve,
  blockedReason,
}: CollisionResolveDialogProps) {
  const [mode, setMode] = useState<Mode>('merge')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One clock per mounted dialog, so the side captions don't drift between renders.
  const [nowMs] = useState(() => Date.now())

  const diff = useMemo(() => computeDivergence(entityA, entityB), [entityA, entityB])

  async function handleSubmit(resolution: Resolution) {
    setSubmitting(true)
    setError(null)
    try {
      await onResolve(resolution)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('collisionDialog.failed'))
    } finally {
      setSubmitting(false)
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    // Gate dismissal while a resolution is in flight.
    if (submitting && !nextOpen) return
    onOpenChange(nextOpen)
  }

  function handleModeChange(value: string) {
    if (submitting) return
    setMode(value as Mode)
    setError(null)
  }

  const modeOptions: SelectOption[] = [
    { value: 'merge', label: t('collisionDialog.mode.merge') },
    { value: 'rename', label: t('collisionDialog.mode.rename') },
    { value: 'keep', label: t('collisionDialog.mode.keep') },
  ]
  const onCancel = () => handleOpenChange(false)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl" scrollable={false}>
        <DialogHeader>
          <DialogTitle>
            {t(`collisionDialog.title.${entityA.kind}`, { name: entityA.name })}
          </DialogTitle>
          <DialogDescription>{t('collisionDialog.description')}</DialogDescription>
        </DialogHeader>

        <Select
          options={modeOptions}
          value={mode}
          onValueChange={handleModeChange}
          mode="segment"
          label={t('collisionDialog.modeLabel')}
          disabled={submitting}
        />

        {mode === 'merge' && (
          <MergeBody
            entityA={entityA}
            entityB={entityB}
            diff={diff}
            nowMs={nowMs}
            onSubmit={handleSubmit}
            onCancel={onCancel}
            submitting={submitting}
            blockedReason={blockedReason}
            error={error}
            onChoice={() => setError(null)}
          />
        )}
        {mode === 'rename' && (
          <RenameBody
            entityA={entityA}
            entityB={entityB}
            nowMs={nowMs}
            onSubmit={handleSubmit}
            onCancel={onCancel}
            submitting={submitting}
            blockedReason={blockedReason}
            error={error}
          />
        )}
        {mode === 'keep' && (
          <KeepBody
            name={entityA.name}
            onSubmit={handleSubmit}
            onCancel={onCancel}
            submitting={submitting}
            blockedReason={blockedReason}
            error={error}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Mode body: the content scrolls, the actions stay put. See
 * [overlays.md](../../docs/ui/patterns/overlays.md) — Dialog height and scroll.
 */
function ModeBody({
  children,
  actions,
  blockedReason,
}: {
  children: ViewProps['children']
  actions: ReactNode
  blockedReason?: string
}) {
  return (
    <View className="shrink gap-4">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        className="shrink"
        contentContainerClassName="gap-4"
      >
        {children}
      </ScrollView>
      <DialogFooter>{actions}</DialogFooter>
      {blockedReason != null ? (
        <Text size="sm" variant="muted">
          {blockedReason}
        </Text>
      ) : null}
    </View>
  )
}

function ErrorLine({ error }: { error: string | null }) {
  if (error == null) return null
  return (
    <Text size="sm" className="text-danger">
      {error}
    </Text>
  )
}

function CancelButton({ onCancel, submitting }: { onCancel: () => void; submitting: boolean }) {
  return (
    <Button variant="secondary" onPress={onCancel} disabled={submitting}>
      <Text>{t('cancel')}</Text>
    </Button>
  )
}

type MergeBodyProps = BodyProps & {
  entityA: EntitySummary
  entityB: EntitySummary
  diff: DiffPayload
  nowMs: number
  /** The user changed a merge choice, which answers a refusal shown for the last one. */
  onChoice: () => void
}

function MergeBody({
  entityA,
  entityB,
  diff,
  nowMs,
  onSubmit,
  onCancel,
  submitting,
  blockedReason,
  error,
  onChoice,
}: MergeBodyProps) {
  // Web tiers above phone lay the choices out in columns; native stacks them at every tier.
  const phone = useTier() === 'phone'
  const stacked = phone || Platform.OS !== 'web'
  const [state, dispatch] = useReducer(mergeReducer, entityA.id, initMergeState)
  const choose = (action: MergeAction) => {
    onChoice()
    dispatch(action)
  }

  // Reset reducer state when entities change. Same render-cycle
  // ref-check pattern as embedder-download-dialog.tsx.
  const pairKey = `${entityA.id}::${entityB.id}`
  const lastPairRef = useRef(pairKey)
  if (lastPairRef.current !== pairKey) {
    lastPairRef.current = pairKey
    dispatch({ type: 'reset', defaultCanonicalId: entityA.id })
  }

  const canonical = state.canonicalId === entityA.id ? entityA : entityB
  const nonCanonical = state.canonicalId === entityA.id ? entityB : entityA

  const canonicalOptions: SelectOption[] = (['A', 'B'] as const).map((side) => {
    const entity = side === 'A' ? entityA : entityB
    return {
      value: entity.id,
      label: markCanonical(
        t(`collisionDialog.canonicalOption.${SIDE_WORD[side]}`, {
          name: entity.name,
          when: ageOf(entity, nowMs),
        }),
        canonical === entity,
      ),
    }
  })

  const chips = useMemo(
    () => mergeChips(diff, canonical, nonCanonical),
    [diff, canonical, nonCanonical],
  )

  function handleConfirm() {
    onSubmit(mergeResolution(state, diff, chips))
  }

  const counts = nonCanonical.relationCounts

  return (
    <ModeBody
      blockedReason={blockedReason}
      actions={
        <>
          <CancelButton onCancel={onCancel} submitting={submitting} />
          <Button
            variant="primary"
            onPress={handleConfirm}
            loading={submitting}
            disabled={blockedReason != null}
            disabledReason={blockedReason}
          >
            <Text>
              {t(`collisionDialog.mergeConfirm.${SIDE_WORD[canonical === entityA ? 'A' : 'B']}`, {
                name: canonical.name,
              })}
            </Text>
          </Button>
        </>
      }
    >
      <View className="gap-2">
        <Text size="sm" variant="muted">
          {t('collisionDialog.canonicalHint')}
        </Text>
        <Select
          options={canonicalOptions}
          value={state.canonicalId}
          onValueChange={(id) => choose({ type: 'pick-canonical', id })}
          // Segment options are one fixed-height row; a phone's half-width label wraps and clips.
          mode={phone ? 'radio' : 'segment'}
          label={t('collisionDialog.canonicalLabel')}
          disabled={submitting}
        />
      </View>

      {diff.divergentScalars.length > 0 && (
        <View className="gap-2 rounded-md border border-border bg-bg-sunken p-3">
          <Text size="sm" variant="muted">
            {t('collisionDialog.divergentFields')}
          </Text>
          {/* world.md → Merge, side identification: stacked choices carry their own caption. */}
          {!stacked && (
            <View className="flex-row gap-2">
              {(['A', 'B'] as const).map((side) => {
                const entity = side === 'A' ? entityA : entityB
                return (
                  <Text key={side} size="xs" variant="muted" className="flex-1">
                    {markCanonical(
                      sideCaption(side, entity, nowMs),
                      entity.id === state.canonicalId,
                    )}
                  </Text>
                )
              })}
            </View>
          )}
          {diff.divergentScalars.map((field) => (
            <FieldRow
              key={field}
              field={field}
              entityA={entityA}
              entityB={entityB}
              nowMs={nowMs}
              stacked={stacked}
              pick={(state.fromOther.has(field) ? nonCanonical : canonical) === entityA ? 'A' : 'B'}
              onPick={(side) =>
                choose({
                  type: 'pick-field',
                  field,
                  fromOther: (side === 'A' ? entityA : entityB).id !== state.canonicalId,
                })
              }
              disabled={submitting}
            />
          ))}
        </View>
      )}

      <TermChips
        label={t('collisionDialog.keywords')}
        terms={chips.keywords}
        isDeselected={(keyword) => state.deselectedKeywords.includes(normalizeTerm(keyword))}
        onToggle={(keyword) => choose({ type: 'toggle-keyword', keyword })}
        disabled={submitting}
      />
      <TermChips
        label={t('collisionDialog.tags')}
        terms={chips.tags}
        isDeselected={(tag) => state.deselectedTags.includes(tag)}
        onToggle={(tag) => choose({ type: 'toggle-tag', tag })}
        disabled={submitting}
      />

      {diff.stateDivergent && (
        <Text size="sm" variant="muted">
          {t('collisionDialog.stateNote')}
        </Text>
      )}

      <View className="gap-1 rounded-md border border-border bg-bg-sunken p-3">
        <Text size="sm" variant="muted">
          {t('collisionDialog.summary.heading', { from: nonCanonical.name, to: canonical.name })}
        </Text>
        <Text size="sm">
          {t('collisionDialog.summary.awareness', { value: counts.awarenessRows })}
        </Text>
        <Text size="sm">
          {t('collisionDialog.summary.involvements', { value: counts.involvements })}
        </Text>
        <Text size="sm">
          {t('collisionDialog.summary.relationships', { value: counts.relationships })}
        </Text>
        <Text size="sm">
          {t('collisionDialog.summary.inverseRefs', { value: counts.inverseRefs })}
        </Text>
        <Text size="sm">
          {t('collisionDialog.summary.embeddings', { value: counts.embeddings })}
        </Text>
        <Text size="sm">
          {t('collisionDialog.summary.unheldItems', { value: counts.unheldItems })}
        </Text>
        <Text size="sm">
          {t('collisionDialog.summary.translations', { value: counts.translationRows })}
        </Text>
        {counts.overlap.awareness > 0 ? (
          <Text size="xs" variant="muted">
            {t('collisionDialog.summary.overlapAwareness', {
              count: counts.overlap.awareness,
              name: canonical.name,
            })}
          </Text>
        ) : null}
        {counts.overlap.involvements > 0 ? (
          <Text size="xs" variant="muted">
            {t('collisionDialog.summary.overlapInvolvements', {
              count: counts.overlap.involvements,
              name: canonical.name,
            })}
          </Text>
        ) : null}
        {counts.overlap.relationships > 0 ? (
          <Text size="xs" variant="muted">
            {t('collisionDialog.summary.overlapRelationships', {
              count: counts.overlap.relationships,
              name: canonical.name,
            })}
          </Text>
        ) : null}
        {counts.overlap.holdersLosingItem > 0 ? (
          <Text size="xs" variant="muted">
            {t('collisionDialog.summary.holdersLosingItem', {
              count: counts.overlap.holdersLosingItem,
              name: canonical.name,
            })}
          </Text>
        ) : null}
        {counts.joiningRelationship ? (
          <Text size="xs" variant="muted">
            {t('collisionDialog.summary.joiningRelationship')}
          </Text>
        ) : null}
        {counts.overlap.canonicalRefs > 0 ? (
          <Text size="xs" variant="muted">
            {t('collisionDialog.summary.canonicalRefs', { name: canonical.name })}
          </Text>
        ) : null}
      </View>

      <ErrorLine error={error} />
    </ModeBody>
  )
}

type TermChipsProps = {
  label: string
  terms: readonly string[]
  isDeselected: (term: string) => boolean
  onToggle: (term: string) => void
  disabled: boolean
}

function TermChips({ label, terms, isDeselected, onToggle, disabled }: TermChipsProps) {
  if (terms.length === 0) return null
  return (
    <View className="gap-2">
      <Text size="sm" variant="muted">
        {label}
      </Text>
      <View role="group" accessibilityLabel={label} className="flex-row flex-wrap gap-2">
        {terms.map((term) => {
          const deselected = isDeselected(term)
          return (
            <Chip
              key={term}
              selected={!deselected}
              onPress={() => onToggle(term)}
              disabled={disabled}
            >
              <Text className={cn(deselected && 'line-through')}>{term}</Text>
            </Chip>
          )
        })}
      </View>
    </View>
  )
}

type FieldRowProps = {
  field: ScalarField
  entityA: EntitySummary
  entityB: EntitySummary
  nowMs: number
  stacked: boolean
  pick: Side
  onPick: (side: Side) => void
  disabled?: boolean
}

/** What a field's radio needs from its group to work from the keyboard on web. */
type ChoiceKeys = {
  ref: (node: View | null) => void
  tabIndex?: 0 | -1
  onKeyDown: (event: KeyboardEvent) => void
}

/**
 * Radix's roving focus finds its items by a data attribute RN-Web drops, so on web it leaves every
 * radio out of the tab order and arrows inert: the group does its own Space, arrows and tab stop.
 */
function useChoiceKeys(pick: Side, onPick: (side: Side) => void, disabled?: boolean) {
  const nodes = useRef<Record<Side, View | null>>({ A: null, B: null })
  return (side: Side): ChoiceKeys => ({
    ref: (node) => {
      nodes.current[side] = node
    },
    tabIndex: Platform.OS === 'web' ? (pick === side ? 0 : -1) : undefined,
    onKeyDown: (event) => {
      const other: Side = side === 'A' ? 'B' : 'A'
      const to = event.key === ' ' ? side : ARROW_KEYS.has(event.key) ? other : null
      if (disabled || to == null) return
      event.preventDefault()
      onPick(to)
      nodes.current[to]?.focus()
    },
  })
}

function FieldRow({
  field,
  entityA,
  entityB,
  nowMs,
  stacked,
  pick,
  onPick,
  disabled,
}: FieldRowProps) {
  const label = t(`collisionDialog.field.${field}`)
  const keys = useChoiceKeys(pick, onPick, disabled)
  return (
    <View className="gap-1">
      <Text size="sm" variant="muted">
        {label}
      </Text>
      <RadioGroupBase.Root
        value={pick}
        onValueChange={(side) => onPick(side as Side)}
        disabled={disabled}
        aria-label={label}
        tabIndex={Platform.OS === 'web' ? -1 : undefined}
        className={stacked ? 'gap-1' : 'flex-row gap-2'}
      >
        {(['A', 'B'] as const).map((side) => {
          const entity = side === 'A' ? entityA : entityB
          const choice = {
            side,
            value: fieldValue(field, entity),
            caption: sideCaption(side, entity, nowMs),
            selected: pick === side,
            keys: keys(side),
            disabled,
          }
          return stacked ? (
            <StackedChoice key={side} {...choice} prose={PROSE_FIELDS.has(field)} />
          ) : (
            <ColumnChoice key={side} {...choice} />
          )
        })}
      </RadioGroupBase.Root>
    </View>
  )
}

function RadioDot({ selected, className }: { selected: boolean; className?: string }) {
  return (
    <View
      className={cn(
        'size-4 items-center justify-center rounded-full border-2',
        selected ? 'border-accent bg-accent' : 'border-border-strong bg-bg-base',
        className,
      )}
    >
      <RadioGroupBase.Indicator className="size-1.5 rounded-full bg-accent-fg" />
    </View>
  )
}

type ChoiceProps = {
  side: Side
  value: string
  caption: string
  selected: boolean
  keys: ChoiceKeys
  disabled?: boolean
}

/** A card per side that grows with its value, so prose wraps in place (world.md → Merge). */
function ColumnChoice({ side, value, caption, selected, keys, disabled }: ChoiceProps) {
  return (
    <RadioGroupBase.Item
      {...keys}
      value={side}
      aria-label={t('collisionDialog.choiceLabel', { caption, value })}
      disabled={disabled}
      style={disabled ? GATED : undefined}
      className={cn(
        'flex-1 flex-row items-start gap-3 rounded-md border bg-bg-base px-row-x-md py-row-y-md',
        selected ? 'border-accent' : 'border-border active:bg-tint-press',
        Platform.select({
          web: cn(
            !selected && 'hover:bg-tint-hover',
            'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
          ),
        }),
        disabled && 'opacity-50',
      )}
    >
      <RadioDot selected={selected} className="mt-0.5" />
      <Text size="sm" className="min-w-0 flex-1">
        {value}
      </Text>
    </RadioGroupBase.Item>
  )
}

type StackedChoiceProps = ChoiceProps & { prose: boolean }

// world.md → Merge (Long-text values, Side identification): the radio and the prose are separate
// taps, and the caption names the side.
function StackedChoice({
  side,
  value,
  caption,
  prose,
  selected,
  keys,
  disabled,
}: StackedChoiceProps) {
  return (
    <View className="flex-row items-start gap-1">
      <RadioGroupBase.Item
        {...keys}
        value={side}
        aria-label={t('collisionDialog.choiceLabel', { caption, value })}
        disabled={disabled}
        style={disabled ? GATED : undefined}
        className={cn(
          'size-11 items-center justify-center rounded-full',
          Platform.select({
            web: 'outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
          }),
          disabled && 'opacity-50',
        )}
      >
        <RadioDot selected={selected} />
      </RadioGroupBase.Item>
      <View className="min-w-0 flex-1 gap-0.5 py-3">
        {prose ? <ClampedProse value={value} /> : <Text size="sm">{value}</Text>}
        <Text size="xs" variant="muted">
          {caption}
        </Text>
      </View>
    </View>
  )
}

/**
 * A clamp that expands in place. An invisible unclamped copy measures the full height, so the tap
 * shows only on prose that clamps; onLayout reports both heights alike on web and native.
 */
function ClampedProse({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false)
  const [clampedHeight, setClampedHeight] = useState(0)
  const [fullHeight, setFullHeight] = useState(0)
  const text = (
    <Text
      size="sm"
      numberOfLines={expanded ? undefined : STACKED_CLAMP_LINES}
      onLayout={(event) => {
        if (!expanded) setClampedHeight(event.nativeEvent.layout.height)
      }}
    >
      {value}
    </Text>
  )
  return (
    <View className="overflow-hidden">
      {expanded || fullHeight > clampedHeight + 1 ? (
        <Pressable
          accessibilityRole="button"
          aria-expanded={expanded}
          onPress={() => setExpanded((open) => !open)}
        >
          {text}
        </Pressable>
      ) : (
        text
      )}
      <Text
        size="sm"
        aria-hidden
        className="pointer-events-none absolute left-0 right-0 top-0 opacity-0"
        onLayout={(event) => setFullHeight(event.nativeEvent.layout.height)}
      >
        {value}
      </Text>
    </View>
  )
}

type RenameBodyProps = BodyProps & {
  entityA: EntitySummary
  entityB: EntitySummary
  nowMs: number
}

function RenameBody({
  entityA,
  entityB,
  nowMs,
  onSubmit,
  onCancel,
  submitting,
  blockedReason,
  error,
}: RenameBodyProps) {
  const [nameA, setNameA] = useState(entityA.name)
  const [nameB, setNameB] = useState(entityB.name)

  // Reset names if entity inputs change.
  const pairKey = `${entityA.id}::${entityB.id}`
  const lastPairRef = useRef(pairKey)
  if (lastPairRef.current !== pairKey) {
    lastPairRef.current = pairKey
    setNameA(entityA.name)
    setNameB(entityB.name)
  }

  const issue = renameIssue(entityA.kind, [nameA, nameB])
  const untouched = nameA === entityA.name && nameB === entityB.name
  const help =
    untouched || issue == null ? t('collisionDialog.renameHelp') : RENAME_ISSUE_TEXT[issue]()
  const captionA = sideCaption('A', entityA, nowMs)
  const captionB = sideCaption('B', entityB, nowMs)

  function handleConfirm() {
    const renames: { id: string; newName: string }[] = []
    const trimmedA = nameA.trim()
    const trimmedB = nameB.trim()
    if (trimmedA !== entityA.name) renames.push({ id: entityA.id, newName: trimmedA })
    if (trimmedB !== entityB.name) renames.push({ id: entityB.id, newName: trimmedB })
    onSubmit({ mode: 'rename', renames })
  }

  return (
    <ModeBody
      blockedReason={blockedReason}
      actions={
        <>
          <CancelButton onCancel={onCancel} submitting={submitting} />
          <Button
            variant="primary"
            onPress={handleConfirm}
            loading={submitting}
            disabled={blockedReason != null || issue != null}
            disabledReason={blockedReason ?? (issue == null ? undefined : help)}
          >
            <Text>{t('collisionDialog.renameConfirm')}</Text>
          </Button>
        </>
      }
    >
      <View className="gap-1">
        <Text size="sm" variant="muted">
          {captionA}
        </Text>
        <Input
          value={nameA}
          onChangeText={setNameA}
          editable={!submitting}
          accessibilityLabel={captionA}
        />
      </View>
      <View className="gap-1">
        <Text size="sm" variant="muted">
          {captionB}
        </Text>
        <Input
          value={nameB}
          onChangeText={setNameB}
          editable={!submitting}
          accessibilityLabel={captionB}
        />
      </View>
      <Text size="sm" variant="muted">
        {help}
      </Text>

      <ErrorLine error={error} />
    </ModeBody>
  )
}

type KeepBodyProps = BodyProps & { name: string }

function KeepBody({ name, onSubmit, onCancel, submitting, blockedReason, error }: KeepBodyProps) {
  return (
    <ModeBody
      blockedReason={blockedReason}
      actions={
        <>
          <CancelButton onCancel={onCancel} submitting={submitting} />
          <Button
            variant="primary"
            onPress={() => onSubmit({ mode: 'keep' })}
            loading={submitting}
            disabled={blockedReason != null}
            disabledReason={blockedReason}
          >
            <Text>{t('collisionDialog.keepConfirm')}</Text>
          </Button>
        </>
      }
    >
      <Text size="sm" variant="muted">
        {t('collisionDialog.keepBody', { name })}
      </Text>

      <ErrorLine error={error} />
    </ModeBody>
  )
}

export type { CollisionResolveDialogProps }
