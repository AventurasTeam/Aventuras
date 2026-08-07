import { useRef, type ComponentRef } from 'react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { Tag, type TagTone } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { t } from '@/lib/i18n'
import type { ThemeColorSlots } from '@/lib/themes'

type GenerationPhase =
  | 'reasoning'
  | 'recalling-memory'
  | 'generating-narrative'
  | 'classifying'
  | 'updating-memory'
  | 'closing-chapter'
  | 'refreshing-suggestions'

// `blocking` is whether the phase holds the turn up, and it drives both columns
// beside it and the priority rule below. A blocking phase also owns the cancel
// affordance, so it keeps the slot even against an error; a background one drops
// the accent fill and yields, since nothing is lost by waiting for it and the
// error may be waiting on the user. Tracked separately from a null `cancelCopy`,
// which the two coincide with today only because the one background phase is
// also the one nothing can cancel.
const PHASE_APPEARANCE: Record<
  GenerationPhase,
  { blocking: boolean; tone: TagTone; spinnerSlot: keyof ThemeColorSlots }
> = {
  reasoning: { blocking: true, tone: 'accent', spinnerSlot: '--accent-fg' },
  'recalling-memory': { blocking: true, tone: 'accent', spinnerSlot: '--accent-fg' },
  'generating-narrative': { blocking: true, tone: 'accent', spinnerSlot: '--accent-fg' },
  classifying: { blocking: true, tone: 'accent', spinnerSlot: '--accent-fg' },
  'updating-memory': { blocking: false, tone: 'default', spinnerSlot: '--fg-muted' },
  'closing-chapter': { blocking: true, tone: 'accent', spinnerSlot: '--accent-fg' },
  'refreshing-suggestions': { blocking: true, tone: 'accent', spinnerSlot: '--accent-fg' },
}

// `memory-incomplete` names the observable state, not a cause: the pill fires
// off a non-zero stale-row count, which an available embedder can produce too
// (a crash-recovered same-model cancel re-flags the whole story).
//
// `swap-paused` is a separate code rather than more of the same, because staging
// CLEARS embedding_stale as it goes: a half-finished swap drives the stale count
// toward zero, so the story most in need of a signal is the one least likely to
// raise one. Its cause is the marker, and its remedy is a decision, not waiting.
type ErrorState =
  | { code: 'memory-incomplete'; pendingRows: number }
  | { code: 'swap-paused' }
  | { code: 'classifier-offline' }

type GenerationStatusPillProps = {
  activePhase?: GenerationPhase
  error?: ErrorState
  // Ignored for phases `cancelCopy` marks cancel-less, so a caller that can't
  // tell which phase is up may pass it unconditionally.
  onCancel?: () => void
  onErrorTap: (code: ErrorState['code']) => void
}

function phaseCopy(phase: GenerationPhase): string {
  switch (phase) {
    case 'reasoning':
      return t('chrome.generationStatusPill.phase.reasoning')
    case 'recalling-memory':
      return t('chrome.generationStatusPill.phase.recallingMemory')
    case 'generating-narrative':
      return t('chrome.generationStatusPill.phase.generatingNarrative')
    case 'classifying':
      return t('chrome.generationStatusPill.phase.classifying')
    case 'updating-memory':
      return t('chrome.generationStatusPill.phase.updatingMemory')
    case 'closing-chapter':
      return t('chrome.generationStatusPill.phase.closingChapter')
    case 'refreshing-suggestions':
      return t('chrome.generationStatusPill.phase.refreshingSuggestions')
  }
}

function errorCopy(error: ErrorState): string {
  switch (error.code) {
    case 'memory-incomplete':
      return t('chrome.generationStatusPill.error.memoryIncomplete', {
        count: error.pendingRows,
      })
    case 'swap-paused':
      return t('chrome.generationStatusPill.error.swapPaused')
    case 'classifier-offline':
      return t('chrome.generationStatusPill.error.classifierOffline')
  }
}

// Exhaustive switch rather than a default-carrying ternary: a new phase must
// fail the build here instead of silently inheriting "Cancel generation".
// `null` is the cancel-less answer — nothing the user started, nothing to stop.
function cancelCopy(phase: GenerationPhase): string | null {
  switch (phase) {
    case 'reasoning':
    case 'recalling-memory':
    case 'generating-narrative':
    case 'classifying':
      return t('chrome.generationStatusPill.cancelGeneration')
    case 'updating-memory':
      return null
    case 'closing-chapter':
      return t('chrome.generationStatusPill.cancelChapterClose')
    case 'refreshing-suggestions':
      return t('chrome.generationStatusPill.cancelSuggestionRefresh')
  }
}

export function GenerationStatusPill({
  activePhase,
  error,
  onCancel,
  onErrorTap,
}: GenerationStatusPillProps) {
  const tier = useTier()
  const triggerRef = useRef<ComponentRef<typeof PopoverTrigger>>(null)

  // Priority: blocking phase > error state > background phase > hidden.
  if (activePhase != null && (PHASE_APPEARANCE[activePhase].blocking || error == null)) {
    const isPhone = tier === 'phone'
    const appearance = PHASE_APPEARANCE[activePhase]
    const tag = (
      <Tag
        tone={appearance.tone}
        leading={<Spinner size="sm" colorSlot={appearance.spinnerSlot} />}
      >
        {isPhone ? null : phaseCopy(activePhase)}
      </Tag>
    )
    const cancelLabel = cancelCopy(activePhase)
    if (onCancel == null || cancelLabel == null) return tag
    return (
      <Popover>
        <PopoverTrigger ref={triggerRef}>{tag}</PopoverTrigger>
        <PopoverContent>
          <Button
            variant="secondary"
            onPress={() => {
              triggerRef.current?.close()
              onCancel()
            }}
          >
            <Text>{cancelLabel}</Text>
          </Button>
        </PopoverContent>
      </Popover>
    )
  }

  if (error != null) {
    return (
      <Tag tone="warning" onPress={() => onErrorTap(error.code)}>
        {errorCopy(error)}
      </Tag>
    )
  }

  return null
}

export type { ErrorState, GenerationPhase, GenerationStatusPillProps }
