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
import { ReasonTooltip } from '@/components/ui/reason-tooltip'
import { Text } from '@/components/ui/text'
import { embeddingTargetKey, type EmbeddingTarget } from '@/lib/db'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * The whole target travels with the candidate and comes back out whole: a bare
 * model id would force the host to re-resolve which embedder was meant, and that
 * lookup cannot succeed when one id names both a local and a provider copy.
 */
type SwapCandidate = {
  target: EmbeddingTarget
  /** Model display name. */
  label: string
  /** Where this copy is served from — what tells two same-id rows apart. */
  sourceLabel: string
  isCurrent: boolean
}

type SwapDialogProps = {
  open: boolean
  candidates: readonly SwapCandidate[]
  onReindex: (target: EmbeddingTarget) => void
  onTargetSelected?: (target: EmbeddingTarget) => void
  onKeep: () => void
  onRelabel: (target: EmbeddingTarget) => void
  onDismiss: () => void
  disabled?: boolean
  disabledReason?: string
}

type Stage = 'pick' | 'options'

export function SwapDialog({
  open,
  candidates,
  onReindex,
  onTargetSelected,
  onKeep,
  onRelabel,
  onDismiss,
  disabled = false,
  disabledReason,
}: SwapDialogProps) {
  const [stage, setStage] = useState<Stage>('pick')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  // Reopening must not resurrect a selection from a prior pass at the
  // dialog — the caller may reuse one `open` state across candidates.
  useEffect(() => {
    if (open) {
      setStage('pick')
      setSelectedKey(null)
    }
  }, [open])

  function handleOpenChange(next: boolean) {
    if (!next) onDismiss()
  }

  const selected = candidates.find((c) => embeddingTargetKey(c.target) === selectedKey) ?? null
  const selectTarget = (key: string) => {
    setSelectedKey(key)
    const candidate = candidates.find((item) => embeddingTargetKey(item.target) === key)
    if (candidate != null) onTargetSelected?.(candidate.target)
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        {stage === 'options' && selected != null ? (
          <OptionsPane
            target={selected}
            onBack={() => setStage('pick')}
            onReindex={() => onReindex(selected.target)}
            onKeep={onKeep}
            onRelabel={() => onRelabel(selected.target)}
            onDismiss={onDismiss}
            disabled={disabled}
            disabledReason={disabledReason}
          />
        ) : (
          <PickPane
            candidates={candidates}
            selectedKey={selectedKey}
            onSelect={selectTarget}
            onNext={() => setStage('options')}
            onDismiss={onDismiss}
            disabled={disabled}
            disabledReason={disabledReason}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

type PickPaneProps = {
  candidates: readonly SwapCandidate[]
  selectedKey: string | null
  onSelect: (key: string) => void
  onNext: () => void
  onDismiss: () => void
  disabled: boolean
  disabledReason?: string
}

function PickPane({
  candidates,
  selectedKey,
  onSelect,
  onNext,
  onDismiss,
  disabled,
  disabledReason,
}: PickPaneProps) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{t('storySettings:swap.title')}</AlertDialogTitle>
        <AlertDialogDescription>{t('storySettings:swap.pickBody')}</AlertDialogDescription>
      </AlertDialogHeader>

      <View role="radiogroup" className="gap-2">
        {candidates.map((candidate) => {
          const key = embeddingTargetKey(candidate.target)
          return (
            <CandidateRow
              key={key}
              candidate={candidate}
              selected={key === selectedKey}
              onPress={() => onSelect(key)}
              blocked={disabled}
              disabledReason={disabledReason}
            />
          )
        })}
      </View>

      <AlertDialogFooter>
        <Button variant="secondary" onPress={onDismiss}>
          <Text>{t('storySettings:swap.cancel')}</Text>
        </Button>
        <Button
          variant="primary"
          onPress={onNext}
          disabled={disabled || selectedKey == null}
          disabledReason={disabled ? disabledReason : undefined}
        >
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
  blocked: boolean
  disabledReason?: string
}

function CandidateRow({
  candidate,
  selected,
  onPress,
  blocked,
  disabledReason,
}: CandidateRowProps) {
  const disabled = blocked || candidate.isCurrent
  return (
    <ReasonTooltip reason={blocked ? disabledReason : undefined}>
      <Pressable
        testID={`swap-candidate-${embeddingTargetKey(candidate.target)}`}
        role="radio"
        accessibilityRole="radio"
        aria-checked={selected}
        accessibilityState={{ selected, disabled }}
        accessibilityHint={blocked ? disabledReason : undefined}
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
        <View className="flex-1 gap-0.5">
          <Text size="sm" className="font-medium">
            {candidate.label}
          </Text>
          {/* Load-bearing, not decoration: two rows can share a model id, and this
              is the only thing distinguishing which embedder they mean. */}
          <Text size="xs" variant="muted">
            {candidate.sourceLabel}
          </Text>
        </View>
        {candidate.isCurrent ? (
          <Text size="xs" variant="muted">
            {t('storySettings:swap.current')}
          </Text>
        ) : null}
      </Pressable>
    </ReasonTooltip>
  )
}

type OptionsPaneProps = {
  target: SwapCandidate
  onBack: () => void
  onReindex: () => void
  onKeep: () => void
  onRelabel: () => void
  onDismiss: () => void
  disabled: boolean
  disabledReason?: string
}

function OptionsPane({
  target,
  onBack,
  onReindex,
  onKeep,
  onRelabel,
  onDismiss,
  disabled,
  disabledReason,
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
          <Button
            testID="swap-reindex"
            variant="primary"
            className="w-full"
            disabled={disabled}
            disabledReason={disabledReason}
            onPress={onReindex}
          >
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
          <Button
            testID="swap-relabel"
            variant="secondary"
            className="w-full"
            disabled={disabled}
            disabledReason={disabledReason}
            onPress={onRelabel}
          >
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
