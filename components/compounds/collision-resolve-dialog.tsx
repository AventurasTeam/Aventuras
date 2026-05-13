import * as React from 'react'
import { Platform, View } from 'react-native'

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
import { cn } from '@/lib/utils'

import {
  computeDivergence,
  type DiffPayload,
  type EntitySummary,
  type Resolution,
  type ScalarField,
} from './collision-resolve-diff'
import { initMergeState, mergeReducer } from './collision-resolve-machine'

type Mode = 'merge' | 'rename' | 'keep'

const SCALAR_LABELS: Record<ScalarField, string> = {
  name: 'Name',
  description: 'Description',
  status: 'Status',
  retiredReason: 'Retired reason',
  injectionMode: 'Injection mode',
}

type CollisionResolveDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  entityA: EntitySummary
  entityB: EntitySummary
  onResolve: (resolution: Resolution) => Promise<void>
}

export function CollisionResolveDialog({
  open,
  onOpenChange,
  entityA,
  entityB,
  onResolve,
}: CollisionResolveDialogProps) {
  const [mode, setMode] = React.useState<Mode>('merge')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const diff = React.useMemo(() => computeDivergence(entityA, entityB), [entityA, entityB])

  async function handleSubmit(resolution: Resolution) {
    setSubmitting(true)
    setError(null)
    try {
      await onResolve(resolution)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Resolution failed')
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
    { value: 'merge', label: 'Merge into one' },
    { value: 'rename', label: 'Rename one' },
    { value: 'keep', label: 'Keep as distinct' },
  ]

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{`⚠ Two ${entityA.kind}s named "${entityA.name}"`}</DialogTitle>
          <DialogDescription>
            Pick how to resolve this collision. Switching modes discards in-progress choices.
          </DialogDescription>
        </DialogHeader>

        <Select
          options={modeOptions}
          value={mode}
          onValueChange={handleModeChange}
          mode="segment"
          label="Resolution path"
        />

        {mode === 'merge' && (
          <MergeBody
            entityA={entityA}
            entityB={entityB}
            diff={diff}
            onSubmit={handleSubmit}
            onCancel={() => handleOpenChange(false)}
            submitting={submitting}
            error={error}
          />
        )}
        {mode === 'rename' && (
          <RenameBody
            entityA={entityA}
            entityB={entityB}
            onSubmit={handleSubmit}
            onCancel={() => handleOpenChange(false)}
            submitting={submitting}
            error={error}
          />
        )}
        {mode === 'keep' && (
          <KeepBody
            name={entityA.name}
            onSubmit={handleSubmit}
            onCancel={() => handleOpenChange(false)}
            submitting={submitting}
            error={error}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

type MergeBodyProps = {
  entityA: EntitySummary
  entityB: EntitySummary
  diff: DiffPayload
  onSubmit: (resolution: Resolution) => void
  onCancel: () => void
  submitting: boolean
  error: string | null
}

function MergeBody({
  entityA,
  entityB,
  diff,
  onSubmit,
  onCancel,
  submitting,
  error,
}: MergeBodyProps) {
  const [state, dispatch] = React.useReducer(mergeReducer, undefined, () =>
    initMergeState(diff, entityA.id, entityA.id),
  )

  // Reset reducer state when entities change. Same render-cycle
  // ref-check pattern as embedder-download-dialog.tsx.
  const pairKey = `${entityA.id}::${entityB.id}`
  const lastPairRef = React.useRef(pairKey)
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
    { value: entityA.id, label: `${entityA.name} · ${formatAgo(entityA.createdAt)}` },
    { value: entityB.id, label: `${entityB.name} · ${formatAgo(entityB.createdAt)}` },
  ]

  const allTags = React.useMemo(() => {
    if (diff.tags == null) return [...entityA.tags].sort()
    return [...diff.tags.both, ...diff.tags.onlyInA, ...diff.tags.onlyInB].sort()
  }, [diff.tags, entityA.tags])

  const finalTags = React.useMemo(
    () => allTags.filter((t) => !state.deselectedTags.includes(t)),
    [allTags, state.deselectedTags],
  )

  function handleConfirm() {
    onSubmit({
      mode: 'merge',
      canonicalId: state.canonicalId,
      fieldChoices: state.fieldChoices,
      finalTags,
    })
  }

  return (
    <View className="gap-4">
      <View className="gap-2">
        <Text size="sm" variant="muted">
          Canonical (this row survives)
        </Text>
        <Select
          options={canonicalOptions}
          value={state.canonicalId}
          onValueChange={(id) => dispatch({ type: 'pick-canonical', id, entityAId: entityA.id })}
          mode="segment"
          label="Canonical"
        />
      </View>

      {diff.divergentScalars.length > 0 && (
        <View className="gap-2 rounded-md border border-border bg-bg-sunken p-3">
          <Text size="sm" variant="muted">
            Divergent fields
          </Text>
          {diff.divergentScalars.map((field) => (
            <FieldRow
              key={field}
              field={field}
              valueA={String(entityA[field] ?? '—')}
              valueB={String(entityB[field] ?? '—')}
              pick={state.fieldChoices[field]}
              onPick={(side) => dispatch({ type: 'pick-field', field, side })}
            />
          ))}
        </View>
      )}

      {diff.tags != null && (
        <View className="gap-2">
          <Text size="sm" variant="muted">
            Tags (click to remove from merge)
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {allTags.map((tag) => {
              const deselected = state.deselectedTags.includes(tag)
              return (
                <Chip
                  key={tag}
                  selected={!deselected}
                  onPress={() => dispatch({ type: 'toggle-tag', tag })}
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
          State JSON will follow the canonical row · edit on detail pane after merge.
        </Text>
      )}

      <View className="gap-1 rounded-md border border-border bg-bg-sunken p-3">
        <Text size="sm" variant="muted">
          {`Moves on merge (${nonCanonical.name} → ${canonical.name})`}
        </Text>
        <Text size="sm">{`Awareness rows: ${nonCanonical.relationCounts.awarenessRows}`}</Text>
        <Text size="sm">{`Involvements: ${nonCanonical.relationCounts.involvements}`}</Text>
        <Text size="sm">{`Inverse refs: ${nonCanonical.relationCounts.inverseRefs}`}</Text>
        <Text size="sm">{`Embeddings: ${nonCanonical.relationCounts.embeddings}`}</Text>
        <Text size="sm">{`Translation rows: ${nonCanonical.relationCounts.translationRows}`}</Text>
      </View>

      {error != null && (
        <Text size="sm" className="text-danger">
          {error}
        </Text>
      )}

      <DialogFooter>
        <Button variant="secondary" onPress={onCancel} disabled={submitting}>
          <Text>Cancel</Text>
        </Button>
        <Button variant="primary" onPress={handleConfirm} disabled={submitting}>
          <Text>{submitting ? 'Merging…' : `Merge into ${canonical.name}`}</Text>
        </Button>
      </DialogFooter>
    </View>
  )
}

type FieldRowProps = {
  field: ScalarField
  valueA: string
  valueB: string
  pick: 'A' | 'B'
  onPick: (side: 'A' | 'B') => void
}

function FieldRow({ field, valueA, valueB, pick, onPick }: FieldRowProps) {
  return (
    <View className="gap-1">
      <Text size="sm" variant="muted">
        {SCALAR_LABELS[field]}
      </Text>
      <View className={Platform.select({ web: 'flex-row gap-2', default: 'gap-2' }) ?? 'gap-2'}>
        <RadioCard label={valueA} selected={pick === 'A'} onPress={() => onPick('A')} />
        <RadioCard label={valueB} selected={pick === 'B'} onPress={() => onPick('B')} />
      </View>
    </View>
  )
}

type RadioCardProps = {
  label: string
  selected: boolean
  onPress: () => void
}

function RadioCard({ label, selected, onPress }: RadioCardProps) {
  return (
    <Chip selected={selected} onPress={onPress} className="flex-1">
      <Text>{label}</Text>
    </Chip>
  )
}

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  const days = Math.floor(hrs / 24)
  return `${days} d ago`
}

type RenameBodyProps = {
  entityA: EntitySummary
  entityB: EntitySummary
  onSubmit: (resolution: Resolution) => void
  onCancel: () => void
  submitting: boolean
  error: string | null
}

function RenameBody({ entityA, entityB, onSubmit, onCancel, submitting, error }: RenameBodyProps) {
  const [nameA, setNameA] = React.useState(entityA.name)
  const [nameB, setNameB] = React.useState(entityB.name)

  // Reset names if entity inputs change.
  const pairKey = `${entityA.id}::${entityB.id}`
  const lastPairRef = React.useRef(pairKey)
  if (lastPairRef.current !== pairKey) {
    lastPairRef.current = pairKey
    setNameA(entityA.name)
    setNameB(entityB.name)
  }

  const dirty = nameA !== entityA.name || nameB !== entityB.name

  function handleConfirm() {
    const renames: { id: string; newName: string }[] = []
    if (nameA !== entityA.name) renames.push({ id: entityA.id, newName: nameA })
    if (nameB !== entityB.name) renames.push({ id: entityB.id, newName: nameB })
    onSubmit({ mode: 'rename', renames })
  }

  return (
    <View className="gap-4">
      <View className="gap-1">
        <Text size="sm" variant="muted">
          {`Older · ${formatAgo(entityA.createdAt)}`}
        </Text>
        <Input value={nameA} onChangeText={setNameA} editable={!submitting} />
      </View>
      <View className="gap-1">
        <Text size="sm" variant="muted">
          {`Newer · ${formatAgo(entityB.createdAt)}`}
        </Text>
        <Input value={nameB} onChangeText={setNameB} editable={!submitting} />
      </View>
      <Text size="sm" variant="muted">
        Change at least one name to clear the collision.
      </Text>

      {error != null && (
        <Text size="sm" className="text-danger">
          {error}
        </Text>
      )}

      <DialogFooter>
        <Button variant="secondary" onPress={onCancel} disabled={submitting}>
          <Text>Cancel</Text>
        </Button>
        <Button variant="primary" onPress={handleConfirm} disabled={submitting || !dirty}>
          <Text>{submitting ? 'Saving…' : 'Save renames'}</Text>
        </Button>
      </DialogFooter>
    </View>
  )
}

type KeepBodyProps = {
  name: string
  onSubmit: (resolution: Resolution) => void
  onCancel: () => void
  submitting: boolean
  error: string | null
}

function KeepBody({ name, onSubmit, onCancel, submitting, error }: KeepBodyProps) {
  function handleConfirm() {
    onSubmit({ mode: 'keep' })
  }
  return (
    <View className="gap-4">
      <Text size="sm" variant="muted">
        {`Both "${name}" entities will continue to exist with the same name. Retrieval treats them by id, but storyteller responses may conflate them in prose. Polymorphic naming is a documented v1 limitation — the schema doesn't enforce unique names. The flag clears; no other writes.`}
      </Text>

      {error != null && (
        <Text size="sm" className="text-danger">
          {error}
        </Text>
      )}

      <DialogFooter>
        <Button variant="secondary" onPress={onCancel} disabled={submitting}>
          <Text>Cancel</Text>
        </Button>
        <Button variant="primary" onPress={handleConfirm} disabled={submitting}>
          <Text>{submitting ? 'Saving…' : 'Keep as distinct'}</Text>
        </Button>
      </DialogFooter>
    </View>
  )
}

export type { CollisionResolveDialogProps }
