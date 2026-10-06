import { useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { Platform, Pressable, ScrollView, View, type ViewProps } from 'react-native'

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
import { cn } from '@/lib/utils'
import { RENAME_ISSUE, renameIssue, type RenameIssue } from '@/lib/world'

import {
  computeDivergence,
  type DiffPayload,
  type EntitySummary,
  type Resolution,
  type ScalarField,
  type TermPartition,
} from './collision-resolve-diff'
import { initMergeState, mergeReducer } from './collision-resolve-machine'

type Mode = 'merge' | 'rename' | 'keep'

type Side = 'A' | 'B'

// world.md → Merge: on phone, prose values clamp and expand in place.
const PROSE_FIELDS: ReadonlySet<ScalarField> = new Set<ScalarField>([
  'description',
  'retiredReason',
])
const PHONE_CLAMP_LINES = 3

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

function termUnion(partition: TermPartition): string[] {
  return partition == null
    ? []
    : [...partition.both, ...partition.onlyInA, ...partition.onlyInB].sort()
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
}: MergeBodyProps) {
  const phone = useTier() === 'phone'
  const [state, dispatch] = useReducer(mergeReducer, undefined, () =>
    initMergeState(diff, entityA.id, entityA.id),
  )

  // Reset reducer state when entities change. Same render-cycle
  // ref-check pattern as embedder-download-dialog.tsx.
  const pairKey = `${entityA.id}::${entityB.id}`
  const lastPairRef = useRef(pairKey)
  if (lastPairRef.current !== pairKey) {
    lastPairRef.current = pairKey
    dispatch({
      type: 'reset',
      diff,
      defaultCanonicalId: entityA.id,
      entityAId: entityA.id,
    })
  }

  const canonical = state.canonicalId === entityA.id ? entityA : entityB
  const nonCanonical = state.canonicalId === entityA.id ? entityB : entityA

  const canonicalOptions: SelectOption[] = [
    {
      value: entityA.id,
      label: t('collisionDialog.canonicalOption', {
        name: entityA.name,
        when: ageOf(entityA, nowMs),
      }),
    },
    {
      value: entityB.id,
      label: t('collisionDialog.canonicalOption', {
        name: entityB.name,
        when: ageOf(entityB, nowMs),
      }),
    },
  ]

  const allTags = useMemo(() => termUnion(diff.tags), [diff.tags])
  const allKeywords = useMemo(() => termUnion(diff.keywords), [diff.keywords])
  // A null partition means the two sides already agree: submit the canonical's own list, so the
  // merge doesn't write a reordered or respelled copy of it.
  const finalTags =
    diff.tags == null
      ? canonical.tags
      : allTags.filter((tag) => !state.deselectedTags.includes(tag))
  const finalKeywords =
    diff.keywords == null
      ? canonical.keywords
      : allKeywords.filter((keyword) => !state.deselectedKeywords.includes(keyword))

  function handleConfirm() {
    onSubmit({
      mode: 'merge',
      canonicalId: state.canonicalId,
      fieldChoices: state.fieldChoices,
      finalTags: [...finalTags],
      finalKeywords: [...finalKeywords],
    })
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
            <Text>{t('collisionDialog.mergeConfirm', { name: canonical.name })}</Text>
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
          onValueChange={(id) => dispatch({ type: 'pick-canonical', id, entityAId: entityA.id })}
          mode="segment"
          label={t('collisionDialog.canonicalLabel')}
          disabled={submitting}
        />
      </View>

      {diff.divergentScalars.length > 0 && (
        <View className="gap-2 rounded-md border border-border bg-bg-sunken p-3">
          <Text size="sm" variant="muted">
            {t('collisionDialog.divergentFields')}
          </Text>
          {/* world.md → Merge, side identification: desktop column headers name each side; phone
              drops them for the per-radio caption. Added at assembly (batch 4 report). */}
          {!phone && (
            <View className="flex-row gap-2">
              {([entityA, entityB] as const).map((side) => (
                <Text key={side.id} size="xs" variant="muted" className="flex-1">
                  {`${t(
                    side === entityA ? 'collisionDialog.olderSide' : 'collisionDialog.newerSide',
                    {
                      when: relativeTimeLabel(Date.parse(side.createdAt), nowMs),
                    },
                  )}${side.id === state.canonicalId ? ` · ${t('collisionDialog.canonicalLabel')}` : ''}`}
                </Text>
              ))}
            </View>
          )}
          {diff.divergentScalars.map((field) => (
            <FieldRow
              key={field}
              field={field}
              entityA={entityA}
              entityB={entityB}
              nowMs={nowMs}
              phone={phone}
              pick={state.fieldChoices[field]}
              onPick={(side) => dispatch({ type: 'pick-field', field, side })}
              disabled={submitting}
            />
          ))}
        </View>
      )}

      {diff.keywords != null && (
        <View className="gap-2">
          <Text size="sm" variant="muted">
            {t('collisionDialog.keywords')}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {allKeywords.map((keyword) => {
              const deselected = state.deselectedKeywords.includes(keyword)
              return (
                <Chip
                  key={keyword}
                  selected={!deselected}
                  onPress={() => dispatch({ type: 'toggle-keyword', keyword })}
                  disabled={submitting}
                >
                  <Text className={cn(deselected && 'line-through')}>{keyword}</Text>
                </Chip>
              )
            })}
          </View>
        </View>
      )}

      {diff.tags != null && (
        <View className="gap-2">
          <Text size="sm" variant="muted">
            {t('collisionDialog.tags')}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {allTags.map((tag) => {
              const deselected = state.deselectedTags.includes(tag)
              return (
                <Chip
                  key={tag}
                  selected={!deselected}
                  onPress={() => dispatch({ type: 'toggle-tag', tag })}
                  disabled={submitting}
                >
                  <Text className={cn(deselected && 'line-through')}>{tag}</Text>
                </Chip>
              )
            })}
          </View>
        </View>
      )}

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
      </View>

      <ErrorLine error={error} />
    </ModeBody>
  )
}

type FieldRowProps = {
  field: ScalarField
  entityA: EntitySummary
  entityB: EntitySummary
  nowMs: number
  phone: boolean
  pick: Side
  onPick: (side: Side) => void
  disabled?: boolean
}

function FieldRow({
  field,
  entityA,
  entityB,
  nowMs,
  phone,
  pick,
  onPick,
  disabled,
}: FieldRowProps) {
  const label = t(`collisionDialog.field.${field}`)
  return (
    <View role="group" accessibilityLabel={label} className="gap-1">
      <Text size="sm" variant="muted">
        {label}
      </Text>
      {phone ? (
        <View className="gap-1">
          <PhoneChoice
            value={fieldValue(field, entityA)}
            caption={sideCaption('A', entityA, nowMs)}
            prose={PROSE_FIELDS.has(field)}
            selected={pick === 'A'}
            onPick={() => onPick('A')}
            disabled={disabled}
          />
          <PhoneChoice
            value={fieldValue(field, entityB)}
            caption={sideCaption('B', entityB, nowMs)}
            prose={PROSE_FIELDS.has(field)}
            selected={pick === 'B'}
            onPick={() => onPick('B')}
            disabled={disabled}
          />
        </View>
      ) : (
        <View className={Platform.select({ web: 'flex-row gap-2', default: 'gap-2' }) ?? 'gap-2'}>
          <RadioCard
            label={fieldValue(field, entityA)}
            selected={pick === 'A'}
            onPress={() => onPick('A')}
            disabled={disabled}
          />
          <RadioCard
            label={fieldValue(field, entityB)}
            selected={pick === 'B'}
            onPress={() => onPick('B')}
            disabled={disabled}
          />
        </View>
      )}
    </View>
  )
}

type RadioCardProps = {
  label: string
  selected: boolean
  onPress: () => void
  disabled?: boolean
}

function RadioCard({ label, selected, onPress, disabled }: RadioCardProps) {
  return (
    <Chip selected={selected} onPress={onPress} className="flex-1" disabled={disabled}>
      <Text>{label}</Text>
    </Chip>
  )
}

type PhoneChoiceProps = {
  value: string
  caption: string
  prose: boolean
  selected: boolean
  onPick: () => void
  disabled?: boolean
}

// world.md → Merge on mobile: the radio and the prose are separate tap targets, and the caption
// names the side because the column headers are gone.
function PhoneChoice({ value, caption, prose, selected, onPick, disabled }: PhoneChoiceProps) {
  const [expanded, setExpanded] = useState(false)
  return (
    <View className="flex-row items-start gap-1">
      <Pressable
        role="radio"
        accessibilityRole="radio"
        aria-checked={selected}
        accessibilityLabel={caption}
        accessibilityState={{ checked: selected, disabled: !!disabled }}
        disabled={disabled}
        onPress={onPick}
        className={cn('size-11 items-center justify-center', disabled && 'opacity-50')}
      >
        <View
          className={cn(
            'size-4 items-center justify-center rounded-full border-2',
            selected ? 'border-accent bg-accent' : 'border-border-strong bg-bg-base',
          )}
        >
          {selected ? <View className="size-1.5 rounded-full bg-accent-fg" /> : null}
        </View>
      </Pressable>
      <View className="min-w-0 flex-1 gap-0.5 py-3">
        {prose ? (
          <Pressable
            accessibilityRole="button"
            aria-expanded={expanded}
            onPress={() => setExpanded((open) => !open)}
          >
            <Text size="sm" numberOfLines={expanded ? undefined : PHONE_CLAMP_LINES}>
              {value}
            </Text>
          </Pressable>
        ) : (
          <Text size="sm">{value}</Text>
        )}
        <Text size="xs" variant="muted">
          {caption}
        </Text>
      </View>
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
            disabledReason={
              blockedReason ?? (issue == null ? undefined : RENAME_ISSUE_TEXT[issue]())
            }
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
