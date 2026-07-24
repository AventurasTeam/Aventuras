import { useEffect, useState } from 'react'
import { Platform, Pressable, View } from 'react-native'

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type SwapCandidate = { id: string; label: string; isCurrent: boolean }

type SwapDialogProps = {
  open: boolean
  candidates: readonly SwapCandidate[]
  onReindex: (targetModelId: string) => void
  onKeep: () => void
  onRelabel: (targetModelId: string) => void
  onDismiss: () => void
}

type Stage = 'pick' | 'options'

export function SwapDialog({
  open,
  candidates,
  onReindex,
  onKeep,
  onRelabel,
  onDismiss,
}: SwapDialogProps) {
  const [stage, setStage] = useState<Stage>('pick')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Reopening must not resurrect a selection from a prior pass at the
  // dialog — the caller may reuse one `open` state across candidates.
  useEffect(() => {
    if (open) {
      setStage('pick')
      setSelectedId(null)
    }
  }, [open])

  function handleOpenChange(next: boolean) {
    if (!next) onDismiss()
  }

  const target = candidates.find((c) => c.id === selectedId) ?? null

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        {stage === 'options' && target != null ? (
          <OptionsPane
            target={target}
            onBack={() => setStage('pick')}
            onReindex={() => onReindex(target.id)}
            onKeep={onKeep}
            onRelabel={() => onRelabel(target.id)}
            onDismiss={onDismiss}
          />
        ) : (
          <PickPane
            candidates={candidates}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNext={() => setStage('options')}
            onDismiss={onDismiss}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

type PickPaneProps = {
  candidates: readonly SwapCandidate[]
  selectedId: string | null
  onSelect: (id: string) => void
  onNext: () => void
  onDismiss: () => void
}

function PickPane({ candidates, selectedId, onSelect, onNext, onDismiss }: PickPaneProps) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{t('storySettings:swap.title')}</AlertDialogTitle>
        <AlertDialogDescription>{t('storySettings:swap.pickBody')}</AlertDialogDescription>
      </AlertDialogHeader>

      <View role="radiogroup" className="gap-2">
        {candidates.map((candidate) => (
          <CandidateRow
            key={candidate.id}
            candidate={candidate}
            selected={candidate.id === selectedId}
            onPress={() => onSelect(candidate.id)}
          />
        ))}
      </View>

      <AlertDialogFooter>
        <Button variant="secondary" onPress={onDismiss}>
          <Text>{t('storySettings:swap.cancel')}</Text>
        </Button>
        <Button variant="primary" onPress={onNext} disabled={selectedId == null}>
          <Text>{t('storySettings:swap.next')}</Text>
        </Button>
      </AlertDialogFooter>
    </>
  )
}

type CandidateRowProps = {
  candidate: SwapCandidate
  selected: boolean
  onPress: () => void
}

function CandidateRow({ candidate, selected, onPress }: CandidateRowProps) {
  const disabled = candidate.isCurrent
  return (
    <Pressable
      testID={`swap-candidate-${candidate.id}`}
      role="radio"
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      className={cn(
        'flex-row items-center gap-3 rounded-md border bg-bg-base px-row-x-md py-row-y-md',
        selected ? 'border-accent' : 'border-border',
        !disabled && 'active:bg-tint-press',
        Platform.select({
          web: cn(
            !disabled && !selected && 'hover:bg-tint-hover',
            'outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring',
          ),
        }),
        disabled && 'opacity-50',
      )}
    >
      <View
        className={cn(
          'size-4 items-center justify-center rounded-full border-2',
          selected ? 'border-accent bg-accent' : 'border-border-strong bg-bg-base',
        )}
      >
        {selected ? <View className="size-1.5 rounded-full bg-accent-fg" /> : null}
      </View>
      <Text size="sm" className="flex-1 font-medium">
        {candidate.label}
      </Text>
      {candidate.isCurrent ? (
        <Text size="xs" variant="muted">
          {t('storySettings:swap.current')}
        </Text>
      ) : null}
    </Pressable>
  )
}

type OptionsPaneProps = {
  target: SwapCandidate
  onBack: () => void
  onReindex: () => void
  onKeep: () => void
  onRelabel: () => void
  onDismiss: () => void
}

function OptionsPane({
  target,
  onBack,
  onReindex,
  onKeep,
  onRelabel,
  onDismiss,
}: OptionsPaneProps) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {t('storySettings:swap.optionsTitle', { model: target.label })}
        </AlertDialogTitle>
        <AlertDialogDescription>{t('storySettings:swap.optionsBody')}</AlertDialogDescription>
      </AlertDialogHeader>

      <View className="gap-3">
        <View className="gap-1">
          <Button testID="swap-reindex" variant="primary" className="w-full" onPress={onReindex}>
            <Text>{t('storySettings:swap.reindex')}</Text>
          </Button>
          <Text size="xs" variant="muted" className="px-1">
            {t('storySettings:swap.reindexHint')}
          </Text>
        </View>

        <View className="gap-1">
          <Button testID="swap-keep" variant="secondary" className="w-full" onPress={onKeep}>
            <Text>{t('storySettings:swap.keep')}</Text>
          </Button>
          <Text size="xs" variant="muted" className="px-1">
            {t('storySettings:swap.keepHint')}
          </Text>
        </View>

        <View className="gap-1">
          <Button testID="swap-relabel" variant="secondary" className="w-full" onPress={onRelabel}>
            <Text>{t('storySettings:swap.relabel')}</Text>
          </Button>
          <Text size="xs" variant="muted" className="px-1">
            {t('storySettings:swap.relabelHint')}
          </Text>
          <Text size="xs" variant="muted" className="px-1">
            {t('storySettings:swap.relabelDisclaimer')}
          </Text>
        </View>
      </View>

      <AlertDialogFooter>
        <Button variant="ghost" onPress={onBack}>
          <Text>{t('storySettings:swap.back')}</Text>
        </Button>
        <Button variant="secondary" onPress={onDismiss}>
          <Text>{t('storySettings:swap.cancel')}</Text>
        </Button>
      </AlertDialogFooter>
    </>
  )
}

export type { SwapCandidate, SwapDialogProps }
