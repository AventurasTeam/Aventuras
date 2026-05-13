import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'

type GenerationPhase = 'reasoning' | 'generating-narrative' | 'classifying' | 'closing-chapter'

type ErrorState = { code: 'embedder-offline'; pendingRows: number } | { code: 'classifier-offline' }

type GenerationStatusPillProps = {
  activePhase?: GenerationPhase
  error?: ErrorState
  onCancel: () => void
  onErrorTap: (code: ErrorState['code']) => void
}

const PHASE_COPY: Record<GenerationPhase, string> = {
  reasoning: 'reasoning…',
  'generating-narrative': 'generating narrative…',
  classifying: 'classifying…',
  'closing-chapter': 'closing chapter…',
}

function errorCopy(error: ErrorState): string {
  switch (error.code) {
    case 'embedder-offline':
      return `Embedder offline — ${error.pendingRows} rows pending`
    case 'classifier-offline':
      return 'Classifier offline — retrieval coverage thinning'
  }
}

function cancelCopy(phase: GenerationPhase): string {
  return phase === 'closing-chapter' ? 'Cancel chapter close' : 'Cancel generation'
}

export function GenerationStatusPill({
  activePhase,
  error,
  onCancel,
  onErrorTap,
}: GenerationStatusPillProps) {
  const tier = useTier()
  // Imperative ref exposes `close()` — same pattern as importer-menu.tsx.
  const triggerRef = React.useRef<React.ComponentRef<typeof PopoverTrigger>>(null)

  // Priority: active generation > error state > hidden.
  if (activePhase != null) {
    const isPhone = tier === 'phone'
    // asChild skipped — Tag isn't forwardRef'd; Trigger renders its own Pressable wrapper.
    // Popover is uncontrolled: rn-primitives Root doesn't accept an `open` prop.
    return (
      <Popover>
        <PopoverTrigger ref={triggerRef}>
          <Tag tone="accent" leading={<Spinner size="sm" colorSlot="--accent-fg" />}>
            {isPhone ? null : PHASE_COPY[activePhase]}
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

export type { GenerationStatusPillProps, GenerationPhase, ErrorState }
