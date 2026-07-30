import { useRef, type ComponentRef } from 'react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { t } from '@/lib/i18n'

type GenerationPhase = 'reasoning' | 'generating-narrative' | 'classifying' | 'closing-chapter'

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
  // Absent for phases with no cancel affordance (e.g. a background classifier
  // pass) — the pill then shows the phase with no popover trigger.
  onCancel?: () => void
  onErrorTap: (code: ErrorState['code']) => void
}

function phaseCopy(phase: GenerationPhase): string {
  switch (phase) {
    case 'reasoning':
      return t('chrome.generationStatusPill.phase.reasoning')
    case 'generating-narrative':
      return t('chrome.generationStatusPill.phase.generatingNarrative')
    case 'classifying':
      return t('chrome.generationStatusPill.phase.classifying')
    case 'closing-chapter':
      return t('chrome.generationStatusPill.phase.closingChapter')
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

function cancelCopy(phase: GenerationPhase): string {
  return phase === 'closing-chapter'
    ? t('chrome.generationStatusPill.cancelChapterClose')
    : t('chrome.generationStatusPill.cancelGeneration')
}

export function GenerationStatusPill({
  activePhase,
  error,
  onCancel,
  onErrorTap,
}: GenerationStatusPillProps) {
  const tier = useTier()
  const triggerRef = useRef<ComponentRef<typeof PopoverTrigger>>(null)

  // Priority: active generation > error state > hidden.
  if (activePhase != null) {
    const isPhone = tier === 'phone'
    const tag = (
      <Tag tone="accent" leading={<Spinner size="sm" colorSlot="--accent-fg" />}>
        {isPhone ? null : phaseCopy(activePhase)}
      </Tag>
    )
    if (onCancel == null) return tag
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
            <Text>{cancelCopy(activePhase)}</Text>
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
