import { Platform, Pressable, View } from 'react-native'

import { Text } from '@/components/ui/text'
import type { EntryMetadata, PromptSections } from '@/lib/db'
import { t } from '@/lib/i18n'
import { PROMPT_SECTION_IDS } from '@/lib/prompts'
import { cn } from '@/lib/utils'

/** What the meta line and the token panel read off an entry. */
export type TokenMeta = Pick<
  EntryMetadata,
  'tokens' | 'promptSections' | 'classifierCall' | 'reasoningEstimate'
>

type RowId = (typeof PROMPT_SECTION_IDS)[number] | 'other'

// entry-card.md → Token panel: the vocabulary's order, never sorted by size.
const ROWS: readonly RowId[] = [...PROMPT_SECTION_IDS, 'other']

const ROW_LABEL = {
  instructions: 'reader:tokenPanel.section.instructions',
  setup: 'reader:tokenPanel.section.setup',
  roster: 'reader:tokenPanel.section.roster',
  scene: 'reader:tokenPanel.section.scene',
  places: 'reader:tokenPanel.section.places',
  entities: 'reader:tokenPanel.section.entities',
  lore: 'reader:tokenPanel.section.lore',
  happenings: 'reader:tokenPanel.section.happenings',
  threads: 'reader:tokenPanel.section.threads',
  chapters: 'reader:tokenPanel.section.chapters',
  history: 'reader:tokenPanel.section.history',
  output: 'reader:tokenPanel.section.output',
  other: 'reader:tokenPanel.section.other',
} as const satisfies Record<RowId, string>

function sumOf(sections: PromptSections): number {
  return ROWS.reduce((sum, id) => sum + (sections[id] ?? 0), 0)
}

/** Whether the entry has a breakdown behind its token text. */
export function hasTokenBreakdown(meta: TokenMeta | undefined): boolean {
  return meta?.promptSections != null || meta?.classifierCall != null
}

type Line = { text: string; spoken: string }

/**
 * reader-composer.md → Reasoning expansion + token metadata: the narrative call's prompt and reply,
 * the provider's counts when it reported them, else the sections' sum and the reply's stored count.
 */
function tokenLine(meta: TokenMeta, replyEstimate: number | undefined): Line | null {
  const { tokens, promptSections, reasoningEstimate } = meta
  if (tokens != null) {
    const counts = { prompt: tokens.prompt, reply: tokens.completion }
    if (tokens.reasoning != null) {
      const params = { ...counts, reasoning: tokens.reasoning }
      return {
        text: t('reader:entryCard.tokensWithReasoning', params),
        spoken: t('reader:entryCard.tokensSpokenWithReasoning', params),
      }
    }
    if (reasoningEstimate != null) {
      const params = { ...counts, reasoning: reasoningEstimate }
      return {
        text: t('reader:entryCard.tokensWithReasoningEstimate', params),
        spoken: t('reader:entryCard.tokensSpokenWithReasoningEstimate', params),
      }
    }
    return {
      text: t('reader:entryCard.tokens', counts),
      spoken: t('reader:entryCard.tokensSpoken', counts),
    }
  }
  if (promptSections == null || replyEstimate == null) return null
  const counts = { prompt: sumOf(promptSections), reply: replyEstimate }
  if (reasoningEstimate != null) {
    const params = { ...counts, reasoning: reasoningEstimate }
    return {
      text: t('reader:entryCard.tokensEstimatedWithReasoning', params),
      spoken: t('reader:entryCard.tokensSpokenEstimatedWithReasoning', params),
    }
  }
  return {
    text: t('reader:entryCard.tokensEstimated', counts),
    spoken: t('reader:entryCard.tokensSpokenEstimated', counts),
  }
}

const tokenTextClass = 'leading-none'

/** The meta line's token text: a toggle for the token panel when there's a breakdown behind it. */
export function TokenText({
  meta,
  replyEstimate,
  pressable,
  expanded,
  onToggle,
}: {
  meta: TokenMeta | undefined
  replyEstimate?: number
  /** Only an entry with a breakdown behind it, which the card's panel shows. */
  pressable: boolean
  expanded: boolean
  onToggle: () => void
}) {
  const line = meta == null ? null : tokenLine(meta, replyEstimate)
  if (line == null) return null
  if (!pressable)
    return (
      <Text size="xs" variant="muted" className={tokenTextClass}>
        {line.text}
      </Text>
    )
  return (
    <Pressable
      accessibilityRole="button"
      aria-expanded={expanded}
      aria-label={t(
        expanded ? 'reader:entryCard.hideTokenPanel' : 'reader:entryCard.showTokenPanel',
        { counts: line.spoken },
      )}
      onPress={onToggle}
      className={cn(
        'group/token-toggle rounded-sm',
        Platform.select({ web: 'cursor-pointer outline-none' }),
      )}
    >
      <Text
        size="xs"
        variant="muted"
        className={cn(
          tokenTextClass,
          'underline decoration-dotted underline-offset-2',
          Platform.select({
            web: 'group-hover/token-toggle:text-fg-primary group-focus-visible/token-toggle:ring-2 group-focus-visible/token-toggle:ring-focus-ring',
          }),
        )}
      >
        {line.text}
      </Text>
    </Pressable>
  )
}

/** The streaming card's live counts, the in-flight `…` trailing (reader-composer.md → Streaming entry). */
export function streamingTokenText(
  tokens: { reply: number; reasoning: number } | undefined,
): string {
  const reply = tokens?.reply ?? 0
  const reasoning = tokens?.reasoning ?? 0
  if (reply === 0)
    return reasoning === 0
      ? t('reader:entryCard.streamingNotStarted')
      : t('reader:entryCard.streamingReasoning', { reasoning })
  return reasoning === 0
    ? t('reader:entryCard.streamingReply', { reply })
    : t('reader:entryCard.streamingReplyWithReasoning', { reply, reasoning })
}

/** One row per section the record holds, in vocabulary order; a bar for its share of the sum. */
export function SectionRows({ sections }: { sections: PromptSections }) {
  const sum = sumOf(sections)
  return (
    <View>
      {ROWS.flatMap((id) => {
        const tokens = sections[id] ?? 0
        if (tokens <= 0) return []
        const share = sum > 0 ? Math.max(1, Math.round((tokens / sum) * 100)) : 0
        return [
          <View key={id} className="flex-row items-center gap-1.5">
            <Text size="xs" className="w-24">
              {t(ROW_LABEL[id])}
            </Text>
            <Text size="xs" variant="muted" className="w-14 text-right font-mono">
              {t('reader:tokenPanel.count', { n: tokens })}
            </Text>
            <View className="flex-1" aria-hidden>
              <View
                className="h-1.5 rounded-sm bg-fg-muted opacity-40"
                style={{ width: `${share}%` }}
              />
            </View>
          </View>,
        ]
      })}
    </View>
  )
}

function CallGroup({
  name,
  tokens,
  sections,
  replyEstimate,
}: {
  name: string
  tokens: EntryMetadata['tokens']
  sections: PromptSections
  replyEstimate?: number
}) {
  const sum = sumOf(sections)
  const counts =
    tokens != null
      ? t('reader:tokenPanel.counts', { prompt: tokens.prompt, reply: tokens.completion })
      : replyEstimate != null
        ? t('reader:tokenPanel.countsEstimated', { prompt: sum, reply: replyEstimate })
        : t('reader:tokenPanel.promptEstimated', { prompt: sum })
  return (
    <View>
      <View className="mb-0.5 flex-row flex-wrap items-baseline justify-between gap-x-2">
        <Text size="xs" className="font-medium">
          {name}
        </Text>
        <Text size="xs" variant="muted" className="font-mono">
          {counts}
        </Text>
      </View>
      {tokens?.cacheRead != null ? (
        <Text size="xs" variant="muted">
          {t('reader:tokenPanel.fromCache', {
            n: tokens.cacheRead,
            share: tokens.prompt > 0 ? tokens.cacheRead / tokens.prompt : 0,
          })}
        </Text>
      ) : null}
      {tokens?.cacheWrite != null ? (
        <Text size="xs" variant="muted">
          {t('reader:tokenPanel.writtenToCache', { n: tokens.cacheWrite })}
        </Text>
      ) : null}
      <Text size="xs" variant="muted" className="mb-0.5 mt-1 opacity-80">
        {t('reader:tokenPanel.bySection', { sum })}
      </Text>
      <SectionRows sections={sections} />
    </View>
  )
}

/**
 * entry-card.md → Token panel: one group per call, the narrative call first, then the fallback
 * classifier when it ran on the turn. No line sums the two: each is its own call.
 */
export function TokenPanel({ meta, replyEstimate }: { meta: TokenMeta; replyEstimate?: number }) {
  return (
    <View className="mb-3 gap-2.5 rounded border border-border bg-bg-sunken p-2.5">
      {meta.promptSections != null ? (
        <CallGroup
          name={t('reader:tokenPanel.narrative')}
          tokens={meta.tokens}
          sections={meta.promptSections}
          replyEstimate={replyEstimate}
        />
      ) : null}
      {meta.classifierCall != null ? (
        <View className={cn(meta.promptSections != null && 'border-t border-border pt-2')}>
          <CallGroup
            name={t('reader:tokenPanel.classifier')}
            tokens={meta.classifierCall.tokens}
            sections={meta.classifierCall.promptSections}
          />
        </View>
      ) : null}
    </View>
  )
}
