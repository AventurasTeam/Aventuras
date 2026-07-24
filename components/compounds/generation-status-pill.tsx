import { useRef, type ComponentRef } from 'react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { t } from '@/lib/i18n'

type GenerationPhase = 'reasoning' | 'generating-narrative' | 'classifying' | 'closing-chapter'

type ErrorState = { code: 'embedder-offline'; pendingRows: number } | { code: 'classifier-offline' }

type GenerationStatusPillProps = {
  activePhase?: GenerationPhase
  error?: ErrorState
  onCancel: () => void
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
    case 'embedder-offline':
      return t('chrome.generationStatusPill.error.embedderOffline', {
        count: error.pendingRows,
      })
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
    return (
      <Popover>
        <PopoverTrigger ref={triggerRef}>
          <Tag tone="accent" leading={<Spinner size="sm" colorSlot="--accent-fg" />}>
            {isPhone ? null : phaseCopy(activePhase)}
          </Tag>
        </PopoverTrigger>
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
