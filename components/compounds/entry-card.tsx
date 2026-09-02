import {
  AlertTriangle,
  ArrowLeftRight,
  Book,
  Brain,
  GitBranch,
  Globe,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react-native'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react'
import { Platform, Pressable, View } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Icon } from '@/components/ui/icon'
import { IconAction } from '@/components/ui/icon-action'
import { ReasonTooltip } from '@/components/ui/reason-tooltip'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import { useTier } from '@/hooks/use-tier'
import type { CalendarFrame } from '@/lib/calendar'
import type { EntryMetadata, StoryEntry } from '@/lib/db'
import { t } from '@/lib/i18n'
import { detectRichEntryHtml, parseMarkdownToHtml, sanitizeHtml } from '@/lib/markdown'
import { stripTrailingBlocks } from '@/lib/piggyback'
import { cn } from '@/lib/utils'

import { RichEntryContent } from './rich-entry-content'
import { SceneEditForm, sceneSaveErrorKey, type SceneSaveResult } from './scene-edit-form'
import { WorldTimeEditForm, type MonotonicityBreak } from './world-time-edit-form'

type EntryKind = StoryEntry['kind'] | 'streaming'

// The card surfaces the canonical entry-metadata token shape directly rather
// than a bespoke copy, so the two can't drift; only completion + reasoning are
// displayed (prompt is carried but unused here).
type EntryMeta = Pick<EntryMetadata, 'tokens'>

/** An id the host tried to resolve; `name` absent means the row is gone. */
type ResolvedEntity = { id: string; name?: string }
type SceneEdit = { sceneEntities: string[]; currentLocationId: string | null }
type EntityOption = { id: string; name: string }
type SceneOptions = {
  characters: EntityOption[]
  items: EntityOption[]
  locations: EntityOption[]
}

type EntryCardProps = {
  kind: EntryKind
  content: string
  /** Pre-formatted by the host's calendar renderer; opaque to the compound. */
  worldTimeLabel?: string
  /** Raw cumulative seconds; with `worldTimeFrame` + a handler, makes the footer clickable. */
  worldTimeRaw?: number
  /**
   * Desktop/tablet: fired by the in-card Dialog's Save with the recomputed
   * seconds. Resolve `false` to report a failed write — the Dialog then stays
   * open with the typed tuple intact. Only `true` closes it.
   */
  onEditTime?: (nextWorldTime: number) => Promise<boolean>
  /** Phone: the compound requests; the host presents the native Sheet. */
  onRequestEditTime?: () => void
  /** Presence renders the warning indicator; the label feeds the banner/tooltip. */
  worldTimeMonotonicityBreak?: MonotonicityBreak
  /** Stable reference required: the edit form's tuple memo keys on identity. */
  worldTimeFrame?: CalendarFrame

  onEdit?: () => void
  /** Not provided for `opening` (block-delete) or `system`/`streaming`. */
  onDelete?: () => void

  // world-state panel (ai / opening) — see docs/ui/patterns/entry-card.md.
  /** This entry's scene, in order. Ids, not names — resolved through `entityNames`. */
  sceneEntities?: readonly string[]
  currentLocationId?: string | null
  /**
   * Resolution pool for EVERY id the panel mentions, not just the scene: a transfer's
   * counterparty and a rejected location routinely sit outside it. A missing `name`
   * renders the unknown-entity chip.
   */
  entityNames?: readonly ResolvedEntity[]
  /** What this turn reported. Absent means the entry reported nothing. */
  stateReport?: EntryMetadata['stateReport']
  summary?: string
  /** Pre-strip rows only: the host passes `stripTrailingBlocks(content).stateRaw`. */
  /**
   * Desktop/tablet: fired by the in-card Dialog's Save. Resolve `false` to report a
   * failed write. Presence also gates the edit control, so the host supplies it on
   * the tail entry alone — a non-tail card renders no control at all.
   */
  onEditScene?: (next: SceneEdit) => Promise<SceneSaveResult>
  /** Phone: the compound requests; the host presents the native Sheet. */
  onRequestEditScene?: () => void
  /** Candidate pool for the editor's selects; required alongside either handler. */
  sceneOptions?: SceneOptions

  // ai / opening:
  meta?: EntryMeta
  reasoning?: string
  /** ai only. */
  onRegen?: () => void
  /** ai, opening. */
  onBranch?: () => void
  /** user, ai, opening. Host hides when active calendar has no eras. */
  onFlipEra?: () => void

  /** Streaming-only — drives the top-line indicator. */
  streamingPhase?: 'reasoning' | 'reply'

  // system-only:
  detail?: string
  /** Kind-specific recovery route (e.g. "Fix profile" → settings); precedes Retry. */
  fixAction?: { label: string; onPress: () => void }
  onRetry?: () => void
  onDismiss?: () => void

  // edit-restrictions (uniform):
  disabled?: boolean
  disabledReason?: string

  // edit mode (host-controlled):
  editing?: boolean
  onContentChange?: (next: string) => void
  onCommitEdit?: () => void
  onCancelEdit?: () => void

  className?: string
}

const KIND_BUBBLE: Record<EntryKind, string> = {
  user_action: 'bg-bg-sunken border-border',
  ai_reply: 'bg-bg-raised border-border',
  opening: 'bg-bg-raised border-border',
  system: 'bg-bg-base border-warning',
  // Near-parity with ai_reply: the commit swap should not visually re-frame
  // the card (reader note, 2026-07-19).
  streaming: 'bg-bg-raised border-border',
}

const WORLD_TIME_TRIGGER_CLASS = cn(
  'group/world-time rounded-sm',
  Platform.select({
    web: 'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
  }),
)

const WORLD_TIME_LABEL_CLASS = Platform.select({ web: 'group-hover/world-time:text-fg-primary' })

type WorldTimeEditTarget = {
  worldTimeRaw: number
  frame: CalendarFrame
}

function WorldTimeEditDialog({
  trigger,
  edit,
  monotonicityBreak,
  onEditTime,
}: {
  trigger: ReactElement
  edit: WorldTimeEditTarget
  monotonicityBreak?: MonotonicityBreak
  onEditTime?: (nextWorldTime: number) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | undefined>()

  async function save(next: number) {
    if (saving) return
    setSaving(true)
    setSaveError(undefined)
    try {
      if (await onEditTime?.(next)) {
        setOpen(false)
      } else {
        setSaveError(t('reader:worldTimeEdit.failed'))
      }
    } catch {
      setSaveError(t('reader:worldTimeEdit.failed'))
    } finally {
      setSaving(false)
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next && saving) return
    if (next) setSaveError(undefined)
    setOpen(next)
  }

  return (
    // Centred modal rather than an anchored Popover: the entry list scrolls
    // under the overlay, so an anchor drifts off its own trigger and collides
    // with the chrome around the list.
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="max-w-xl"
        hideCloseButton={saving}
        // Radix autofocuses the first tabbable field and selects its text.
        // Land on the content container instead: the selection is one
        // keystroke from wiping a field, and on touch it flashes the
        // soft keyboard open and shut.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement | null)?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('reader:worldTimeEdit.title')}</DialogTitle>
        </DialogHeader>
        {/* Keyed so an external worldTime change (undo, classifier write)
            reseeds the form, which only reads the prop on mount. */}
        <WorldTimeEditForm
          key={edit.worldTimeRaw}
          frame={edit.frame}
          worldTimeRaw={edit.worldTimeRaw}
          monotonicityBreak={monotonicityBreak}
          saving={saving}
          saveError={saveError}
          onSave={(next) => void save(next)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function SceneEditDialog({
  open,
  onOpenChange,
  sceneEntities,
  currentLocationId,
  options,
  onEditScene,
  returnFocusTo,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  sceneEntities: readonly string[]
  currentLocationId: string | null
  options: SceneOptions
  onEditScene?: (next: SceneEdit) => Promise<SceneSaveResult>
  returnFocusTo: RefObject<View | null>
}) {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | undefined>()

  async function save(next: SceneEdit) {
    if (saving) return
    setSaving(true)
    setSaveError(undefined)
    try {
      const result = await onEditScene?.(next)
      if (result?.ok) {
        onOpenChange(false)
      } else {
        setSaveError(t(sceneSaveErrorKey(result?.code)))
      }
    } catch {
      setSaveError(t('reader:sceneEdit.failed'))
    } finally {
      setSaving(false)
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next && saving) return
    if (next) setSaveError(undefined)
    onOpenChange(next)
  }

  return (
    // Centred modal for the same reason the world-time overlay is one: the entry
    // list scrolls under it, so an anchored popover drifts off its own trigger.
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-xl"
        hideCloseButton={saving}
        scrollable={false}
        // Radix returns focus to whatever DialogTrigger registered, and this Dialog is
        // controlled from the card rather than triggered, so it would drop the keyboard
        // on <body> instead of the pencil that opened it.
        onCloseAutoFocus={(event) => {
          const trigger = returnFocusTo.current as { focus?: () => void } | null
          if (typeof trigger?.focus !== 'function') return
          event.preventDefault()
          trigger.focus()
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement | null)?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('reader:sceneEdit.title')}</DialogTitle>
        </DialogHeader>
        {/* Keyed so an external scene change (undo, classifier write) reseeds the
            form, which only reads its props on mount. */}
        <SceneEditForm
          key={`${sceneEntities.join(',')}|${currentLocationId ?? ''}`}
          sceneEntities={sceneEntities}
          currentLocationId={currentLocationId}
          options={options}
          saving={saving}
          saveError={saveError}
          onSave={(next) => void save(next)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function WorldTimeFooter({
  label,
  edit,
  monotonicityBreak,
  onEditTime,
  onRequestEditTime,
}: {
  label: string
  /** Null leaves the footer inert — in-flight, content editing, or no host handler. */
  edit: WorldTimeEditTarget | null
  monotonicityBreak?: MonotonicityBreak
  onEditTime?: (nextWorldTime: number) => Promise<boolean>
  onRequestEditTime?: () => void
}) {
  const tier = useTier()

  const breakText =
    monotonicityBreak != null
      ? t('reader:worldTimeEdit.monotonicityBreak', {
          previousLabel: monotonicityBreak.previousLabel,
        })
      : null

  // `onEditTime == null` also routes to the request fork: the Dialog's Save has
  // nowhere to land without it, and would drop the edit silently.
  const usePhoneRequest = onRequestEditTime != null && (tier === 'phone' || onEditTime == null)

  const labelNode = (
    <Text size="xs" variant="muted" className={edit != null ? WORLD_TIME_LABEL_CLASS : undefined}>
      {label}
    </Text>
  )
  // One trigger for both editable forks: the Dialog injects its own press
  // handler through the trigger slot, so only the request fork passes one.
  const trigger = (
    <Pressable
      role="button"
      aria-label={t('reader:worldTimeEdit.title')}
      onPress={usePhoneRequest ? onRequestEditTime : undefined}
      className={WORLD_TIME_TRIGGER_CLASS}
    >
      {labelNode}
    </Pressable>
  )

  let control: ReactNode
  if (edit == null) {
    control = labelNode
  } else if (usePhoneRequest) {
    control = trigger
  } else {
    control = (
      <WorldTimeEditDialog
        trigger={trigger}
        edit={edit}
        monotonicityBreak={monotonicityBreak}
        onEditTime={onEditTime}
      />
    )
  }

  return (
    <View className="mt-3 flex-row items-center justify-end gap-1.5">
      {breakText != null ? (
        <ReasonTooltip reason={breakText}>
          <View role="img" aria-label={breakText}>
            <Icon as={AlertTriangle} size="sm" className="text-warning" />
          </View>
        </ReasonTooltip>
      ) : null}
      {control}
    </View>
  )
}

// Tailwind's animate-pulse doesn't run on native, so the "model is thinking"
// indication loops opacity through Reanimated instead.
// --- World-state panel -------------------------------------------------------
// docs/ui/patterns/entry-card.md → World-state panel. Absolute scene fields come
// from the entry's metadata; `stateReport` adds what THIS turn reported.

function StateGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="mb-2 last:mb-0">
      <Text size="xs" variant="muted" className="mb-0.5 uppercase tracking-wide">
        {label}
      </Text>
      {children}
    </View>
  )
}

// stateReport is immutable while entities stay deletable and rollback-able, so an id
// that no longer resolves is a permanent state rather than a transient one. The raw
// id rides the accessibility label so it is recoverable without ever being rendered
// as a bare UUID.
function EntityChip({ entity }: { entity: ResolvedEntity }) {
  const known = entity.name != null
  return (
    <View
      className={cn(
        'rounded-full border px-2 py-0.5',
        known ? 'border-border bg-bg-base' : 'border-dashed border-border',
      )}
      accessibilityLabel={known ? undefined : entity.id}
    >
      <Text size="xs" className={known ? undefined : 'text-fg-muted'}>
        {known ? entity.name : t('reader:entryCard.stateUnknownEntity')}
      </Text>
    </View>
  )
}

function resolveName(id: string, pool: readonly ResolvedEntity[]): string {
  return pool.find((e) => e.id === id)?.name ?? t('reader:entryCard.stateUnknownEntity')
}

function StateLine({ children }: { children: ReactNode }) {
  return <Text size="xs">{children}</Text>
}

function WorldStatePanel({
  sceneEntities,
  currentLocationId,
  entityNames,
  stateReport,
  summary,
  legacyStateRaw,
  onOpenSceneEdit,
  editTriggerRef,
}: {
  sceneEntities: readonly string[]
  currentLocationId: string | null
  entityNames: readonly ResolvedEntity[]
  stateReport?: EntryMetadata['stateReport']
  summary?: string
  legacyStateRaw?: string
  onOpenSceneEdit?: () => void
  editTriggerRef: RefObject<View | null>
}) {
  const visualChanges = stateReport?.visualChanges ?? []
  const items = stateReport?.transfers?.items ?? []
  const stackables = stateReport?.transfers?.stackables ?? []
  const hasChanges = visualChanges.length + items.length + stackables.length > 0

  const emittedLocation = stateReport?.currentLocation
  // Read as a recorded fact, not inferred from `emitted !== current`: that inequality
  // also goes true when the user edits the location, which is a correct outcome rather
  // than a model error (docs/data-model.md → Entry metadata shape).
  // Holds the id rather than a flag: a rejection always names one, and the strikethrough
  // needs it — keeping the value is what narrows it for the render below.
  const rejectedLocation =
    stateReport?.currentLocationRejected === true ? emittedLocation : undefined
  const emittedDelta = stateReport?.worldTimeDelta
  const appliedDelta = stateReport?.worldTimeDeltaApplied
  // Holds the applied value rather than a flag so the copy can name it, and so all three
  // clamp causes surface — `< 0` caught only the negative one.
  const clampedTo = appliedDelta != null && appliedDelta !== emittedDelta ? appliedDelta : null
  const failedFields = stateReport?.failedFields ?? []

  return (
    <View className="mb-3 rounded border border-border bg-bg-sunken p-2.5">
      <View className="mb-2 flex-row items-center gap-2 border-b border-border pb-1.5">
        <Text size="xs" variant="muted" className="font-medium">
          {t('reader:entryCard.stateBlock')}
        </Text>
        {stateReport != null ? (
          <View className="rounded-full border border-border px-1.5">
            <Text size="xs" variant="muted">
              {t(
                stateReport.layer === 'piggyback_tagged_block'
                  ? 'reader:entryCard.stateLayerPiggyback'
                  : 'reader:entryCard.stateLayerFallback',
              )}
            </Text>
          </View>
        ) : null}
        {/* Absent, never disabled, on a non-tail entry: the host supplies no handler
            except on the tail, so the control simply does not exist there. */}
        {onOpenSceneEdit != null ? (
          <View className="ml-auto">
            <IconAction
              icon={Pencil}
              label={t('reader:entryCard.stateEditScene')}
              size="sm"
              onPress={onOpenSceneEdit}
              ref={editTriggerRef}
            />
          </View>
        ) : null}
      </View>

      <StateGroup label={t('reader:entryCard.stateInScene')}>
        {sceneEntities.length > 0 ? (
          <View className="flex-row flex-wrap gap-1">
            {sceneEntities.map((id) => (
              <EntityChip key={id} entity={entityNames.find((e) => e.id === id) ?? { id }} />
            ))}
          </View>
        ) : (
          <StateLine>{t('reader:entryCard.stateNobody')}</StateLine>
        )}
      </StateGroup>

      <StateGroup label={t('reader:entryCard.stateLocation')}>
        <StateLine>
          {rejectedLocation != null ? (
            <Text size="xs" className="text-fg-muted line-through">
              {`${resolveName(rejectedLocation, entityNames)} `}
            </Text>
          ) : null}
          {currentLocationId != null
            ? resolveName(currentLocationId, entityNames)
            : t('reader:entryCard.stateNone')}
          {rejectedLocation != null ? (
            <Text size="xs" variant="muted">
              {` ${t('reader:entryCard.stateLocationRejected')}`}
            </Text>
          ) : null}
        </StateLine>
      </StateGroup>

      {hasChanges ? (
        <StateGroup label={t('reader:entryCard.stateChanges')}>
          {visualChanges.map((c, i) => (
            <StateLine key={`v${i}`}>
              <Text size="xs" variant="muted">
                {`${t('reader:entryCard.stateVisualChange', {
                  name: resolveName(c.id, entityNames),
                  category: c.type,
                })} — `}
              </Text>
              {c.text}
            </StateLine>
          ))}
          {items.map((it, i) => (
            <StateLine key={`i${i}`}>
              {it.from != null
                ? t('reader:entryCard.stateItemTransferFrom', {
                    item: resolveName(it.id, entityNames),
                    to:
                      it.to != null
                        ? resolveName(it.to, entityNames)
                        : t('reader:entryCard.stateNone'),
                    from: resolveName(it.from, entityNames),
                  })
                : t('reader:entryCard.stateItemTransfer', {
                    item: resolveName(it.id, entityNames),
                    to:
                      it.to != null
                        ? resolveName(it.to, entityNames)
                        : t('reader:entryCard.stateNone'),
                  })}
            </StateLine>
          ))}
          {stackables.map((st, i) => (
            <StateLine key={`s${i}`}>
              {st.from != null
                ? t('reader:entryCard.stateStackableFrom', {
                    key: st.key,
                    amount: st.amount,
                    to:
                      st.to != null
                        ? resolveName(st.to, entityNames)
                        : t('reader:entryCard.stateNone'),
                    from: resolveName(st.from, entityNames),
                  })
                : t('reader:entryCard.stateStackable', {
                    key: st.key,
                    amount: st.amount,
                    to:
                      st.to != null
                        ? resolveName(st.to, entityNames)
                        : t('reader:entryCard.stateNone'),
                  })}
            </StateLine>
          ))}
        </StateGroup>
      ) : null}

      {/* Raw seconds, exactly as emitted: no duration formatter exists, and raw is the
          honest rendering for a provenance field. */}
      {stateReport?.worldTimeDelta != null ? (
        <StateGroup label={t('reader:entryCard.stateDelta')}>
          <StateLine>
            {t('reader:entryCard.stateDeltaSeconds', { n: stateReport.worldTimeDelta })}
            {clampedTo != null ? (
              <Text size="xs" variant="muted">
                {` ${t('reader:entryCard.stateDeltaClamped', { n: clampedTo })}`}
              </Text>
            ) : null}
          </StateLine>
        </StateGroup>
      ) : null}

      {summary != null ? (
        <StateGroup label={t('reader:entryCard.stateSummary')}>
          <StateLine>{summary}</StateLine>
        </StateGroup>
      ) : null}

      {failedFields.length > 0 ? (
        <View className="mt-2 rounded border border-warning p-1.5">
          <Text size="xs" className="text-warning">
            {t('reader:entryCard.stateParseFailed', {
              fields: failedFields.map((f) => f.field).join(', '),
            })}
          </Text>
          {stateReport?.raw != null ? (
            <Text size="xs" className="mt-1 font-mono text-fg-muted">
              {stateReport.raw}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Tolerant reader: rows written before the write-path strip keep their markup
          and render it verbatim rather than being migrated. */}
      {stateReport == null && legacyStateRaw != null ? (
        <Text size="xs" className="font-mono text-fg-muted">
          {legacyStateRaw}
        </Text>
      ) : null}
    </View>
  )
}

function Pulsing({ children }: { children: ReactNode }) {
  const opacity = useSharedValue(1)
  useEffect(() => {
    opacity.set(withRepeat(withTiming(0.3, { duration: 600 }), -1, true))
  }, [opacity])
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }), [opacity])
  return (
    <Animated.View style={style} testID="reasoning-pulse">
      {children}
    </Animated.View>
  )
}

function PlainNarrative({ marked, muted }: { marked: string; muted?: boolean }) {
  const html = useMemo(() => sanitizeHtml(marked), [marked])
  return (
    <div
      className={cn('narrative-html', muted && 'italic text-fg-muted')}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function NarrativeContent({
  text,
  muted,
  allowRich,
}: {
  text: string
  muted?: boolean
  allowRich?: boolean
}) {
  const marked = useMemo(() => parseMarkdownToHtml(text), [text])
  // Verdict is per-render, memoized alongside the HTML memo — never persisted,
  // so detector improvements reclassify old entries retroactively.
  const rich = useMemo(() => allowRich === true && detectRichEntryHtml(marked), [allowRich, marked])

  if (!rich) return <PlainNarrative marked={marked} muted={muted} />
  return <RichEntryContent markedHtml={marked} />
}

export function EntryCard({
  kind,
  content,
  worldTimeLabel,
  worldTimeRaw,
  onEditTime,
  onRequestEditTime,
  worldTimeMonotonicityBreak,
  worldTimeFrame,
  onEdit,
  onDelete,
  sceneEntities,
  currentLocationId,
  entityNames,
  stateReport,
  summary,
  onEditScene,
  onRequestEditScene,
  sceneOptions,
  meta,
  reasoning,
  onRegen,
  onBranch,
  onFlipEra,
  streamingPhase,
  detail,
  fixAction,
  onRetry,
  onDismiss,
  disabled,
  disabledReason,
  editing,
  onContentChange,
  onCommitEdit,
  onCancelEdit,
  className,
}: EntryCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [stateExpanded, setStateExpanded] = useState(false)
  const [sceneEditOpen, setSceneEditOpen] = useState(false)
  const hasReasoning = reasoning != null && reasoning.length > 0

  // Carries the narrowed values rather than a bare boolean so the footer can
  // forward them without a non-null assertion.
  const timeEdit =
    !editing &&
    disabled !== true &&
    worldTimeRaw != null &&
    worldTimeFrame != null &&
    (onEditTime != null || onRequestEditTime != null)
      ? { worldTimeRaw, frame: worldTimeFrame }
      : null

  // Prose still comes from the strip: rows written before the write-path strip keep
  // their markup in `content`, so the reader stays a tolerant reader.
  const { prose, stateRaw } = useMemo(() => stripTrailingBlocks(content), [content])
  const sceneTriggerRef = useRef<View | null>(null)
  // Deliberately NOT gated on `stateReport`. The editable fields are the absolute
  // scene triple, which every entry carries; gating on the report would make the
  // scene editor reachable only when a parse happened to succeed — an affordance
  // whose availability depends on something the user cannot see.
  const hasState = kind === 'ai_reply' || kind === 'opening'
  // Same tier split as the world-time footer: `onEditScene == null` also routes to
  // the request fork, since a Dialog whose Save has nowhere to report would discard
  // the edit silently.
  const tier = useTier()
  const useSceneRequest = onRequestEditScene != null && (tier === 'phone' || onEditScene == null)
  const sceneEditable = !editing && disabled !== true && sceneOptions != null
  const sceneEdit =
    sceneEditable && (onEditScene != null || onRequestEditScene != null)
      ? { open: () => (useSceneRequest ? onRequestEditScene?.() : setSceneEditOpen(true)) }
      : null

  const showActions = !editing && kind !== 'system' && kind !== 'streaming'
  // Holds the label rather than a boolean so the footer receives it narrowed.
  const worldTimeFooterLabel =
    kind !== 'system' && kind !== 'streaming' ? worldTimeLabel : undefined

  return (
    <View
      // No dim while `disabled`: reading is never gated (principles.md → What's
      // not gated), every control below takes `disabled` on its own, and the
      // streaming card renders without it — so a dim here would shade the prose
      // as a turn commits and unshade it as the run settles.
      className={cn('relative w-full rounded-lg border p-4', KIND_BUBBLE[kind], className)}
    >
      <View className={cn('mb-2 flex-row items-center gap-2', showActions && 'pr-28')}>
        {kind === 'user_action' ? (
          <View className="rounded-sm bg-fg-primary px-2 py-0.5">
            <Text size="xs" className="font-medium text-bg-base">
              {t('reader:entryCard.you')}
            </Text>
          </View>
        ) : kind === 'system' ? (
          <>
            <Icon as={AlertTriangle} size="sm" className="shrink-0 text-warning" />
            <Text size="xs" className="font-medium text-warning">
              {t('reader:entryCard.system')}
            </Text>
          </>
        ) : (
          // ai_reply / opening / streaming share one header anatomy so the
          // commit swap only exchanges slot contents, never the layout.
          <>
            <Icon as={Book} size="sm" className="shrink-0 text-fg-muted" />
            {hasReasoning ? (
              kind === 'streaming' && streamingPhase === 'reasoning' ? (
                <Pulsing>
                  <IconAction
                    icon={Brain}
                    label={t(
                      expanded
                        ? 'reader:entryCard.hideReasoning'
                        : 'reader:entryCard.showReasoning',
                    )}
                    size="sm"
                    onPress={() => setExpanded((v) => !v)}
                  />
                </Pulsing>
              ) : (
                <IconAction
                  icon={Brain}
                  label={t(
                    expanded ? 'reader:entryCard.hideReasoning' : 'reader:entryCard.showReasoning',
                  )}
                  size="sm"
                  onPress={() => setExpanded((v) => !v)}
                />
              )
            ) : null}
            {hasState ? (
              <IconAction
                icon={Globe}
                label={t(
                  stateExpanded ? 'reader:entryCard.hideState' : 'reader:entryCard.showState',
                )}
                size="sm"
                onPress={() => setStateExpanded((v) => !v)}
              />
            ) : null}
            {kind === 'streaming' ? (
              <Text size="xs" variant="muted" className="leading-none">
                {t(
                  streamingPhase === 'reasoning'
                    ? 'reader:entryCard.thinking'
                    : 'reader:entryCard.generating',
                )}
              </Text>
            ) : meta?.tokens != null ? (
              <Text size="xs" variant="muted" className="leading-none">
                {meta.tokens.reasoning != null
                  ? t('reader:entryCard.tokensWithReasoning', {
                      n: meta.tokens.completion,
                      reasoning: meta.tokens.reasoning,
                    })
                  : t('reader:entryCard.tokens', { n: meta.tokens.completion })}
              </Text>
            ) : null}
          </>
        )}
      </View>

      {/* Collapsed by default while streaming too — the pulsing brain signals
          thinking; expanding shows the reasoning stream live. */}
      {hasReasoning && expanded && !editing ? (
        <View className="mb-3 border-l-2 border-border pl-3">
          <NarrativeContent text={reasoning ?? ''} muted />
        </View>
      ) : null}

      {hasState && stateExpanded && !editing ? (
        <>
          <WorldStatePanel
            sceneEntities={sceneEntities ?? []}
            currentLocationId={currentLocationId ?? null}
            entityNames={entityNames ?? []}
            stateReport={stateReport}
            summary={summary}
            legacyStateRaw={stateRaw}
            onOpenSceneEdit={sceneEdit?.open}
            editTriggerRef={sceneTriggerRef}
          />
          {sceneEdit != null && !useSceneRequest && sceneOptions != null ? (
            <SceneEditDialog
              open={sceneEditOpen}
              onOpenChange={setSceneEditOpen}
              sceneEntities={sceneEntities ?? []}
              currentLocationId={currentLocationId ?? null}
              options={sceneOptions}
              onEditScene={onEditScene}
              returnFocusTo={sceneTriggerRef}
            />
          ) : null}
        </>
      ) : null}

      {editing ? (
        <View className="gap-2">
          <Textarea
            value={content}
            onChangeText={onContentChange}
            editable={!disabled}
            autoFocus
            aria-label={t('reader:entryCard.editContent')}
            onKeyPress={(e) => {
              if (e.nativeEvent.key === 'Escape') onCancelEdit?.()
            }}
          />
          <View className="flex-row justify-end gap-2">
            <Button variant="ghost" size="sm" onPress={onCancelEdit} disabled={disabled}>
              <Text>{t('cancel')}</Text>
            </Button>
            <Button variant="primary" size="sm" onPress={onCommitEdit} disabled={disabled}>
              <Text>{t('save')}</Text>
            </Button>
          </View>
        </View>
      ) : kind === 'system' ? (
        <View className="gap-3">
          <NarrativeContent text={content} />
          {detail != null ? (
            <Text size="xs" variant="muted">
              {detail}
            </Text>
          ) : null}
          {(fixAction != null || onRetry != null || onDismiss != null) && (
            <View className="flex-row gap-2">
              {fixAction != null ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={fixAction.onPress}
                  disabled={disabled}
                >
                  <Text>{fixAction.label}</Text>
                </Button>
              ) : null}
              {onRetry != null ? (
                <Button variant="secondary" size="sm" onPress={onRetry} disabled={disabled}>
                  <Icon as={RefreshCw} size="sm" />
                  <Text>{t('reader:systemEntry.retry')}</Text>
                </Button>
              ) : null}
              {onDismiss != null ? (
                <Button variant="ghost" size="sm" onPress={onDismiss} disabled={disabled}>
                  <Icon as={X} size="sm" />
                  <Text>{t('reader:systemEntry.dismiss')}</Text>
                </Button>
              ) : null}
            </View>
          )}
        </View>
      ) : kind === 'streaming' && content.length === 0 ? null : ( // pre-first-chunk / reasoning-phase placeholder: nothing to render yet
        <NarrativeContent
          text={prose}
          allowRich={kind === 'user_action' || kind === 'ai_reply' || kind === 'opening'}
        />
      )}

      {showActions ? (
        <View className="absolute right-2 top-4 flex-row items-center gap-0.5">
          {onEdit != null ? (
            <IconAction
              icon={Pencil}
              label={t('reader:entryCard.editEntry')}
              size="sm"
              onPress={onEdit}
              disabled={disabled}
              disabledReason={disabledReason}
            />
          ) : null}
          {onRegen != null && kind === 'ai_reply' ? (
            <IconAction
              icon={RefreshCw}
              label={t('reader:entryCard.regenerate')}
              size="sm"
              onPress={onRegen}
              disabled={disabled}
              disabledReason={disabledReason}
            />
          ) : null}
          {onBranch != null && (kind === 'ai_reply' || kind === 'opening') ? (
            <IconAction
              icon={GitBranch}
              label={t('reader:entryCard.branchFromHere')}
              size="sm"
              onPress={onBranch}
              disabled={disabled}
              disabledReason={disabledReason}
            />
          ) : null}
          {onFlipEra != null ? (
            <IconAction
              icon={ArrowLeftRight}
              label={t('reader:entryCard.flipEra')}
              size="sm"
              onPress={onFlipEra}
              disabled={disabled}
              disabledReason={disabledReason}
            />
          ) : null}
          {onDelete != null && kind !== 'opening' ? (
            <IconAction
              icon={Trash2}
              label={t('reader:entryCard.deleteEntry')}
              size="sm"
              variant="destructive"
              onPress={onDelete}
              disabled={disabled}
              disabledReason={disabledReason}
            />
          ) : null}
        </View>
      ) : null}

      {worldTimeFooterLabel != null ? (
        <WorldTimeFooter
          label={worldTimeFooterLabel}
          edit={timeEdit}
          monotonicityBreak={worldTimeMonotonicityBreak}
          onEditTime={onEditTime}
          onRequestEditTime={onRequestEditTime}
        />
      ) : null}
    </View>
  )
}

export type { EntryCardProps, EntryKind, EntryMeta }
