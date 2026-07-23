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
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { IconAction } from '@/components/ui/icon-action'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import type { EntryMetadata, StoryEntry } from '@/lib/db'
import { detectRichEntryHtml, parseMarkdownToHtml, sanitizeHtml } from '@/lib/markdown'
import { stripStateBlock } from '@/lib/piggyback'
import { cn } from '@/lib/utils'

import { RichEntryContent } from './rich-entry-content'

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

  const { prose, stateRaw } = useMemo(() => stripStateBlock(content), [content])
  const hasState = stateRaw != null && stateRaw.length > 0

  const showActions = !editing && kind !== 'system' && kind !== 'streaming'
  const showWorldTime = worldTimeLabel != null && kind !== 'system' && kind !== 'streaming'

  return (
    <View
      className={cn(
        'relative w-full rounded-lg border p-4',
        KIND_BUBBLE[kind],
        disabled && 'opacity-60',
        className,
      )}
    >
      <View className={cn('mb-2 flex-row items-center gap-2', showActions && 'pr-28')}>
        {kind === 'user_action' ? (
          <View className="rounded-sm bg-fg-primary px-2 py-0.5">
            <Text size="xs" className="font-medium text-bg-base">
              You
            </Text>
          </View>
        ) : kind === 'system' ? (
          <>
            <Icon as={AlertTriangle} size="sm" className="shrink-0 text-warning" />
            <Text size="xs" className="font-medium text-warning">
              System
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
                    label={expanded ? 'Hide reasoning' : 'Show reasoning'}
                    size="sm"
                    onPress={() => setExpanded((v) => !v)}
                  />
                </Pulsing>
              ) : (
                <IconAction
                  icon={Brain}
                  label={expanded ? 'Hide reasoning' : 'Show reasoning'}
                  size="sm"
                  onPress={() => setExpanded((v) => !v)}
                />
              )
            ) : null}
            {hasState ? (
              <IconAction
                icon={Globe}
                label={stateExpanded ? 'Hide state' : 'Show state'}
                size="sm"
                onPress={() => setStateExpanded((v) => !v)}
              />
            ) : null}
            {kind === 'streaming' ? (
              <Text size="xs" variant="muted" className="leading-none">
                {streamingPhase === 'reasoning' ? 'Thinking…' : 'Generating…'}
              </Text>
            ) : meta?.tokens != null ? (
              <Text size="xs" variant="muted" className="leading-none">
                {meta.tokens.completion} tokens
                {meta.tokens.reasoning != null ? ` (+${meta.tokens.reasoning} reasoning)` : ''}
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
            World state block
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
            aria-label="Edit entry content"
            onKeyPress={(e) => {
              if (e.nativeEvent.key === 'Escape') onCancelEdit?.()
            }}
          />
          <View className="flex-row justify-end gap-2">
            <Button variant="ghost" size="sm" onPress={onCancelEdit} disabled={disabled}>
              <Text>Cancel</Text>
            </Button>
            <Button variant="primary" size="sm" onPress={onCommitEdit} disabled={disabled}>
              <Text>Save</Text>
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
                  <Text>Retry</Text>
                </Button>
              ) : null}
              {onDismiss != null ? (
                <Button variant="ghost" size="sm" onPress={onDismiss} disabled={disabled}>
                  <Icon as={X} size="sm" />
                  <Text>Dismiss</Text>
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
              label="Edit entry"
              size="sm"
              onPress={onEdit}
              disabled={disabled}
              disabledReason={disabledReason}
            />
          ) : null}
          {onRegen != null && kind === 'ai_reply' ? (
            <IconAction
              icon={RefreshCw}
              label="Regenerate"
              size="sm"
              onPress={onRegen}
              disabled={disabled}
              disabledReason={disabledReason}
            />
          ) : null}
          {onBranch != null && (kind === 'ai_reply' || kind === 'opening') ? (
            <IconAction
              icon={GitBranch}
              label="Branch from here"
              size="sm"
              onPress={onBranch}
              disabled={disabled}
              disabledReason={disabledReason}
            />
          ) : null}
          {onFlipEra != null ? (
            <IconAction
              icon={ArrowLeftRight}
              label="Flip era"
              size="sm"
              onPress={onFlipEra}
              disabled={disabled}
              disabledReason={disabledReason}
            />
          ) : null}
          {onDelete != null && kind !== 'opening' ? (
            <IconAction
              icon={Trash2}
              label="Delete entry"
              size="sm"
              variant="destructive"
              onPress={onDelete}
              disabled={disabled}
              disabledReason={disabledReason}
            />
          ) : null}
        </View>
      ) : null}

      {showWorldTime ? (
        <View className="mt-3 flex-row justify-end">
          <Text size="xs" variant="muted">
            {worldTimeLabel}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

export type { EntryCardProps, EntryKind, EntryMeta }
