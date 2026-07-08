import { Sparkles } from 'lucide-react-native'
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import { Platform, ScrollView, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { IconAction } from '@/components/ui/icon-action'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { type GenerateStructuredResult } from '@/lib/ai'
import { t } from '@/lib/i18n'

const GUIDANCE_MAX_LENGTH = 200

type AssistState<T> =
  | { kind: 'idle' }
  | { kind: 'not-configured' }
  | { kind: 'guidance' }
  | { kind: 'loading'; modelId: string }
  | { kind: 'result'; value: T }
  | { kind: 'failure'; detail: string }

type AiAssistCommonProps<T> = {
  /** Accessible name for the trigger AND the overlay's visible heading (e.g. "Suggest setting"). */
  ariaLabel: string
  guidancePlaceholder?: string
  /**
   * Runs the assist from the optional guidance text. The caller bakes in the
   * template, schema, config and any post-processing — this component only drives
   * the popover state machine around the async result.
   */
  run: (guidance: string, signal: AbortSignal) => Promise<GenerateStructuredResult<T>>
  /**
   * The configured model id, or null when unconfigured. Drives the pre-generate
   * "set up in Settings" branch and the loading label; the caller owns which
   * agent target it resolves.
   */
  resolveModelId: () => string | null
  /** "Set up in Settings" from the not-configured state. Caller owns the navigation. */
  onSetup: () => void
  disabled?: boolean
}

type AiAssistProseProps<T> = AiAssistCommonProps<T> & {
  result: 'prose'
  getProse: (value: T) => string
  onUse: (value: T) => void
}

type AiAssistChipsProps<T> = AiAssistCommonProps<T> & {
  result: 'chips'
  getChips: (value: T) => string[]
  onPickChip: (chip: string, value: T) => void
}

export type AiAssistProps<T> = AiAssistProseProps<T> | AiAssistChipsProps<T>

export function AiAssist<T>(props: AiAssistProps<T>) {
  const { ariaLabel, guidancePlaceholder, run, resolveModelId, onSetup, disabled } = props

  const isPhone = useTier() === 'phone'

  const [assist, setAssist] = useState<AssistState<T>>({ kind: 'idle' })
  const [guidanceText, setGuidanceText] = useState('')
  const [phoneOpen, setPhoneOpen] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  // Guards against a stale in-flight response clobbering state set by a
  // later Generate / Try again / Cancel — AbortController's own 'aborted'
  // status already covers the common case, this is the defensive backstop.
  const requestSeqRef = useRef(0)
  const triggerRef = useRef<ComponentRef<typeof PopoverTrigger>>(null)

  // Abort any in-flight request on unmount
  useEffect(() => () => abortRef.current?.abort(), [])

  function resetOnClose() {
    abortRef.current?.abort()
    abortRef.current = null
    requestSeqRef.current += 1
    setAssist({ kind: 'idle' })
  }

  function closeOverlay() {
    if (isPhone) setPhoneOpen(false)
    // rn-primitives Popover has no controlled `open` prop; PopoverTrigger's
    // ref exposes an imperative close() that flips the shared root context.
    else triggerRef.current?.close()
    // Direct call is load-bearing on the phone path (setPhoneOpen doesn't fire
    // the Sheet's onOpenChange) and an idempotent no-op on desktop (close()
    // already routed through handlePopoverOpenChange → resetOnClose).
    resetOnClose()
  }

  // Catches dismiss paths that bypass closeOverlay() — tap-outside, Escape,
  // hardware back, sheet swipe-down — so an in-flight request still aborts
  // and stale result/failure state doesn't survive to the next open.
  function handlePopoverOpenChange(next: boolean) {
    if (!next) resetOnClose()
  }

  function handlePhoneOpenChange(next: boolean) {
    setPhoneOpen(next)
    if (!next) resetOnClose()
  }

  function handleTriggerPress() {
    if (disabled) return
    if (resolveModelId() == null) {
      setAssist({ kind: 'not-configured' })
    } else {
      setGuidanceText('')
      setAssist({ kind: 'guidance' })
    }
    if (isPhone) setPhoneOpen(true)
  }

  async function runGenerate(guidance: string) {
    const modelId = resolveModelId()
    if (modelId == null) {
      setAssist({ kind: 'not-configured' })
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const seq = ++requestSeqRef.current
    setAssist({ kind: 'loading', modelId })

    const result = await run(guidance, controller.signal)
    if (requestSeqRef.current !== seq) return

    if (result.status === 'ok') setAssist({ kind: 'result', value: result.value })
    else if (result.status === 'not-configured') setAssist({ kind: 'not-configured' })
    else if (result.status === 'failed') setAssist({ kind: 'failure', detail: result.detail })
    // 'aborted' — whichever action triggered the abort already set its own state.
  }

  const handleGenerate = () => void runGenerate(guidanceText)

  function handleCancelLoading() {
    abortRef.current?.abort()
    // Bump the seq alongside the abort so a response that loses the abort race
    // (e.g. a future multi-tick run) can't resurrect a stale 'result'
    // over the user's cancel — same backstop resetOnClose relies on.
    requestSeqRef.current += 1
    setAssist({ kind: 'guidance' })
  }

  function handleSetupPress() {
    onSetup()
    closeOverlay()
  }

  function renderBody(): ReactNode {
    switch (assist.kind) {
      case 'idle':
        return null

      case 'not-configured':
        return (
          <View className="gap-3">
            <Text size="sm">{t('wizard:aiAssist.notConfigured')}</Text>
            <View className="flex-row justify-end gap-2">
              <Button variant="ghost" onPress={closeOverlay}>
                <Text>{t('wizard:aiAssist.actions.cancel')}</Text>
              </Button>
              <Button onPress={handleSetupPress}>
                <Text>{t('wizard:aiAssist.actions.setup')}</Text>
              </Button>
            </View>
          </View>
        )

      case 'guidance':
        return (
          <View className="gap-3">
            <Heading level={3}>{`✨ ${ariaLabel}`}</Heading>
            <View className="gap-1">
              <Text size="sm" variant="muted">
                {t('wizard:aiAssist.guidance.label')}
              </Text>
              <Input
                value={guidanceText}
                onChangeText={setGuidanceText}
                placeholder={guidancePlaceholder}
                maxLength={GUIDANCE_MAX_LENGTH}
                aria-label={t('wizard:aiAssist.guidance.label')}
              />
            </View>
            <View className="flex-row justify-end gap-2">
              <Button variant="ghost" onPress={closeOverlay}>
                <Text>{t('wizard:aiAssist.actions.cancel')}</Text>
              </Button>
              <Button onPress={handleGenerate}>
                <Text>{t('wizard:aiAssist.actions.generate')}</Text>
              </Button>
            </View>
          </View>
        )

      case 'loading':
        return (
          <View className="gap-3">
            <Heading level={3}>{`✨ ${ariaLabel}`}</Heading>
            <View className="flex-row items-center gap-2">
              <Spinner size="sm" />
              <Text size="sm" variant="muted">
                {t('wizard:aiAssist.loading', { model: assist.modelId })}
              </Text>
            </View>
            <View className="flex-row justify-end">
              <Button variant="ghost" onPress={handleCancelLoading}>
                <Text>{t('wizard:aiAssist.actions.cancel')}</Text>
              </Button>
            </View>
          </View>
        )

      case 'result': {
        if (props.result === 'chips') {
          const chips = props.getChips(assist.value)
          return (
            <View className="gap-3">
              <Heading level={3}>{`✨ ${ariaLabel}`}</Heading>
              <View className="flex-row flex-wrap gap-2">
                {chips.map((chip) => (
                  <Tag
                    key={chip}
                    onPress={() => {
                      props.onPickChip(chip, assist.value)
                      closeOverlay()
                    }}
                  >
                    {chip}
                  </Tag>
                ))}
              </View>
              <View className="flex-row justify-end">
                <Button variant="ghost" onPress={closeOverlay}>
                  <Text>{t('wizard:aiAssist.actions.discard')}</Text>
                </Button>
              </View>
            </View>
          )
        }

        const prose = props.getProse(assist.value)
        return (
          <View className="gap-3">
            <Heading level={3}>{`✨ ${ariaLabel}`}</Heading>
            <ScrollView className="max-h-60 rounded-md border border-border bg-bg-sunken p-3">
              <Text size="sm">{prose}</Text>
            </ScrollView>
            <View className="flex-row justify-end gap-2">
              <Button variant="ghost" onPress={closeOverlay}>
                <Text>{t('wizard:aiAssist.actions.discard')}</Text>
              </Button>
              <Button
                onPress={() => {
                  props.onUse(assist.value)
                  closeOverlay()
                }}
              >
                <Text>{t('wizard:aiAssist.actions.useThis')}</Text>
              </Button>
            </View>
          </View>
        )
      }

      case 'failure':
        return (
          <View className="gap-3">
            <Heading level={3}>{`✨ ${ariaLabel}`}</Heading>
            <Text size="sm" className="text-danger">
              {t('wizard:aiAssist.failure', { reason: assist.detail })}
            </Text>
            <View className="flex-row justify-end gap-2">
              <Button variant="ghost" onPress={closeOverlay}>
                <Text>{t('wizard:aiAssist.actions.cancel')}</Text>
              </Button>
              <Button onPress={handleGenerate}>
                <Text>{t('wizard:aiAssist.actions.tryAgain')}</Text>
              </Button>
            </View>
          </View>
        )

      default: {
        // A future AssistState variant must add a branch — fails to compile here.
        const _exhaustive: never = assist
        return _exhaustive
      }
    }
  }

  const trigger = (
    <IconAction
      icon={Sparkles}
      label={ariaLabel}
      onPress={handleTriggerPress}
      disabled={disabled}
      // rn-primitives + Radix let the Trigger's own onClick open the popover
      // even when the child Pressable is `disabled` (per lessons-learned/
      // rn-primitives-disabled.md). The inline DOM-level pointerEvents gate is
      // the reliable web block; native/phone are covered by IconAction's
      // disabled onPress + the handleTriggerPress guard.
      style={Platform.OS === 'web' && disabled ? ({ pointerEvents: 'none' } as never) : undefined}
    />
  )

  if (isPhone) {
    // Sheet's DialogPrimitive.Root renders a real (portaled) View sibling even
    // while closed — a bare Fragment here would leak two layout children to the
    // consumer's row. Wrap in one View, mirroring SearchableOverlayList's phone branch.
    return (
      <View>
        {trigger}
        <Sheet open={phoneOpen} onOpenChange={handlePhoneOpenChange} ariaLabel={ariaLabel}>
          <SheetContent anchor="bottom" size="auto">
            {renderBody()}
          </SheetContent>
        </Sheet>
      </View>
    )
  }

  return (
    <Popover ariaLabel={ariaLabel} onOpenChange={handlePopoverOpenChange}>
      <PopoverTrigger ref={triggerRef} asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent className="w-80">{renderBody()}</PopoverContent>
    </Popover>
  )
}
