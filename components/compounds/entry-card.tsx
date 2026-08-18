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
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
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
import { WorldTimeEditForm, type MonotonicityBreak } from './world-time-edit-form'

type EntryKind = StoryEntry['kind'] | 'streaming'

// The card surfaces the canonical entry-metadata token shape directly rather
// than a bespoke copy, so the two can't drift; only completion + reasoning are
// displayed (prompt is carried but unused here).
type EntryMeta = Pick<EntryMetadata, 'tokens'>

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
function Pulsing({ children }: { children: ReactNode }) {
  const opacity = useSharedValue(1)
  useEffect(() => {
    opacity.set(withRepeat(withTiming(0.3, { duration: 600 }), -1, true))
  }, [opacity])
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }))
  return <Animated.View style={style}>{children}</Animated.View>
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

  const { prose, stateRaw } = useMemo(() => stripTrailingBlocks(content), [content])
  const hasState = stateRaw != null && stateRaw.length > 0

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
        <View className="mb-3 rounded border border-border bg-bg-sunken p-2.5">
          <Text size="xs" variant="muted" className="mb-1 font-medium">
            {t('reader:entryCard.stateBlock')}
          </Text>
          <Text size="xs" className="font-mono text-fg-muted">
            {stateRaw}
          </Text>
        </View>
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
