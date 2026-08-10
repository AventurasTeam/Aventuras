import { BottomSheetScrollView } from '@gorhom/bottom-sheet'
import { Sparkles } from 'lucide-react-native'
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import { Platform, ScrollView, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'

import {
  markExisting,
  mergePages,
  type AssistListItem,
  type MarkedAssistListItem,
} from './assist-list-logic'

const GUIDANCE_MAX_LENGTH = 200

type AssistState<T> =
  | { kind: 'idle' }
  | { kind: 'not-configured' }
  | { kind: 'guidance' }
  | { kind: 'loading'; modelId: string; from?: T }
  | { kind: 'result'; value: T }
  | { kind: 'refine'; value: T }
  | { kind: 'failure'; detail: string; retry: () => void }

type AiAssistCommonProps = {
  /** Accessible name for the trigger AND the overlay's visible heading (e.g. "Suggest setting"). */
  ariaLabel: string
  guidancePlaceholder?: string
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

/**
 * Runs the assist from the optional guidance text. The caller bakes in the
 * template, schema, config and any post-processing — this component only drives
 * the overlay state machine around the async result.
 */
type AssistRun<T> = (guidance: string, signal: AbortSignal) => Promise<GenerateStructuredResult<T>>

type AiAssistProseProps<T> = AiAssistCommonProps & {
  result: 'prose'
  run: AssistRun<T>
  getProse: (value: T) => string
  onUse: (value: T) => void
  /**
   * Prose-result refine (wizard.md → Refine). Cumulative: each call receives the
   * CURRENT preview plus the user's instruction, so repeated refines stack.
   * Omit to hide the Refine action (chips results never refine).
   */
  refine?: (
    current: T,
    instruction: string,
    signal: AbortSignal,
  ) => Promise<GenerateStructuredResult<T>>
}

type AiAssistChipsProps<T> = AiAssistCommonProps & {
  result: 'chips'
  run: AssistRun<T>
  getChips: (value: T) => string[]
  onPickChip: (chip: string, value: T) => void
}

type AiAssistListProps<T, P> = AiAssistCommonProps & {
  result: 'list'
  /**
   * `exclude` carries the names already on screen when `Generate more` runs.
   * Without it that call re-sends the first page's prompt verbatim and the
   * reply is deduped away, costing a round-trip for nothing. Empty on a fresh
   * Generate, which is meant to re-roll.
   */
  run: (
    guidance: string,
    signal: AbortSignal,
    exclude: readonly string[],
  ) => Promise<GenerateStructuredResult<T>>
  /** Flattens one model reply into renderable rows. */
  getItems: (value: T) => AssistListItem<P>[]
  /** Names already in the wizard's own list — drives the `(already exists)` mark. */
  existingNames: readonly string[]
  /**
   * Fires once with every checked row when `Import selected` is pressed.
   * `exists` is always false here — an already-existing row cannot be checked.
   */
  onImport: (items: MarkedAssistListItem<P>[]) => void
}

export type AiAssistProps<T, P = unknown> =
  | AiAssistProseProps<T>
  | AiAssistChipsProps<T>
  | AiAssistListProps<T, P>

export function AiAssist<T, P = unknown>(props: AiAssistProps<T, P>) {
  const { ariaLabel, guidancePlaceholder, resolveModelId, onSetup, disabled } = props

  const isPhone = useTier() === 'phone'
  // Inside a gorhom sheet a plain ScrollView's touches lose to the sheet's pan
  // gesture, so rows past the fold are unreachable; BottomSheetScrollView
  // registers with that gesture system. It is not an RN core component, so
  // NativeWind drops className on it — every class stays on the wrapping View.
  const Scroller = isPhone ? BottomSheetScrollView : ScrollView

  const [assist, setAssist] = useState<AssistState<T>>({ kind: 'idle' })
  const [guidanceText, setGuidanceText] = useState('')
  const [refineText, setRefineText] = useState('')
  const [phoneOpen, setPhoneOpen] = useState(false)
  // List results accumulate across `Generate more` pages; selection is by
  // trimmed name rather than index so a later page cannot shift what is checked.
  const [listItems, setListItems] = useState<AssistListItem<P>[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const abortRef = useRef<AbortController | null>(null)
  // Guards against a stale in-flight response clobbering state set by a
  // later Generate / Try again / Cancel — AbortController's own 'aborted'
  // status already covers the common case, this is the defensive backstop.
  const requestSeqRef = useRef(0)
  const triggerRef = useRef<ComponentRef<typeof PopoverTrigger>>(null)
  // The guidance the last run actually used, which is not guidanceText: opening
  // the trigger clears the input, and an unconfigured run returns before syncing.
  // Regenerate has to replay the former. Not a cache; don't fold into state.
  const lastGuidanceRef = useRef('')
  // `Generate more` accumulates; a fresh Generate / Regenerate replaces.
  const appendRef = useRef(false)

  // Abort any in-flight request on unmount
  useEffect(() => () => abortRef.current?.abort(), [])

  function resetOnClose() {
    abortRef.current?.abort()
    abortRef.current = null
    requestSeqRef.current += 1
    setAssist({ kind: 'idle' })
    setListItems([])
    setSelected(new Set())
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

  // Shared by runGenerate/runRefine: both need the same abort / seq-bump /
  // loading / await / status-branch dance, differing only in the call itself,
  // the `from` value to fall back to on cancel, and the retry to attach on failure.
  async function runCall(
    modelId: string,
    from: T | undefined,
    call: (signal: AbortSignal) => Promise<GenerateStructuredResult<T>>,
    retry: () => void,
  ) {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const seq = ++requestSeqRef.current
    setAssist({ kind: 'loading', modelId, from })

    // 'loading' is already set, and the runners are not async — an unresolved
    // provider endpoint or an unregistered template id throws synchronously out
    // of `call`. Without this the spinner never stops and nothing is logged.
    let result: GenerateStructuredResult<T>
    try {
      result = await call(controller.signal)
    } catch (err) {
      if (requestSeqRef.current !== seq) return
      const detail = err instanceof Error ? err.message : String(err)
      logger.error('provider.wizard_assist_threw', { modelId, error: detail })
      setAssist({ kind: 'failure', detail, retry })
      return
    }
    if (requestSeqRef.current !== seq) return

    if (result.status === 'ok') {
      if (props.result === 'list') {
        const page = props.getItems(result.value)
        // A replace invalidates every checkmark; only an append preserves them.
        if (!appendRef.current) setSelected(new Set())
        setListItems((prev) => (appendRef.current ? mergePages(prev, page) : mergePages([], page)))
      }
      setAssist({ kind: 'result', value: result.value })
    } else if (result.status === 'not-configured') setAssist({ kind: 'not-configured' })
    else if (result.status === 'failed')
      setAssist({ kind: 'failure', detail: result.detail, retry })
    // 'aborted' — whichever action triggered the abort already set its own state.
  }

  async function runGenerate(guidance: string, from?: T) {
    const modelId = resolveModelId()
    if (modelId == null) {
      setAssist({ kind: 'not-configured' })
      return
    }
    lastGuidanceRef.current = guidance
    // Only an append needs exclusions; a replace is meant to re-roll the same
    // prompt, and listItems is about to be discarded anyway.
    const exclude = appendRef.current ? listItems.map((item) => item.name) : []
    const call =
      props.result === 'list'
        ? (signal: AbortSignal) => props.run(guidance, signal, exclude)
        : (signal: AbortSignal) => props.run(guidance, signal)

    await runCall(modelId, from, call, () => void runGenerate(guidance, from))
  }

  const handleGenerate = () => {
    appendRef.current = false
    void runGenerate(guidanceText)
  }
  // Regenerate/Generate more run on top of a result the user can still want
  // back; cancelling must restore it rather than drop to the guidance form.
  const handleRegenerate = () =>
    void runGenerate(lastGuidanceRef.current, assist.kind === 'result' ? assist.value : undefined)

  async function runRefine(current: T, instruction: string) {
    const refineFn = props.result === 'prose' ? props.refine : undefined
    if (refineFn == null) return
    const modelId = resolveModelId()
    if (modelId == null) {
      setAssist({ kind: 'not-configured' })
      return
    }

    await runCall(
      modelId,
      current,
      (signal) => refineFn(current, instruction, signal),
      () => void runRefine(current, instruction),
    )
  }

  function handleCancelLoading() {
    abortRef.current?.abort()
    // Bump the seq alongside the abort so a response that loses the abort race
    // (e.g. a future multi-tick run) can't resurrect a stale 'result'
    // over the user's cancel — same backstop resetOnClose relies on.
    requestSeqRef.current += 1
    // A cancelled `Generate more` leaves the append flag set; cancelling returns
    // to the result view, where Regenerate would then merge instead of replace.
    appendRef.current = false
    setAssist(
      assist.kind === 'loading' && assist.from !== undefined
        ? { kind: 'result', value: assist.from }
        : { kind: 'guidance' },
    )
  }

  function handleSetupPress() {
    onSetup()
    closeOverlay()
  }

  function renderListResult(): ReactNode {
    if (props.result !== 'list') return null
    const marked = markExisting(listItems, props.existingNames)
    return (
      <View className="gap-3">
        <Heading level={3}>{`✨ ${ariaLabel}`}</Heading>
        {marked.length === 0 ? (
          <Text size="sm" variant="muted">
            {t('wizard:aiAssist.list.empty')}
          </Text>
        ) : (
          <View className="max-h-72">
            <Scroller>
              <View className="gap-2">
                {marked.map((row) => (
                  <View
                    key={row.name}
                    className="flex-row items-start gap-2 rounded-md border border-border bg-bg-sunken p-2"
                  >
                    <Checkbox
                      checked={selected.has(row.name)}
                      // RN-Web blocks the disabled root; Radix's Indicator wrapper forces
                      // pointer-events:none too, closing box-none's direct-children gap.
                      disabled={row.exists}
                      onCheckedChange={(next) =>
                        setSelected((prev) => {
                          const draft = new Set(prev)
                          if (next) draft.add(row.name)
                          else draft.delete(row.name)
                          return draft
                        })
                      }
                      aria-label={row.name}
                    />
                    <View className="min-w-0 flex-1 gap-0.5">
                      <Text size="sm" className="font-medium">
                        {row.name}
                      </Text>
                      <Text size="xs" variant="muted" numberOfLines={2}>
                        {row.detail}
                      </Text>
                      {row.exists ? (
                        <Text size="xs" variant="muted">
                          {t('wizard:aiAssist.list.alreadyExists')}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            </Scroller>
          </View>
        )}
        <View className="flex-row flex-wrap justify-end gap-2">
          <Button variant="ghost" onPress={closeOverlay}>
            <Text>{t('wizard:aiAssist.actions.discard')}</Text>
          </Button>
          <Button
            variant="secondary"
            onPress={() => {
              appendRef.current = false
              handleRegenerate()
            }}
          >
            <Text>{t('wizard:aiAssist.actions.regenerate')}</Text>
          </Button>
          <Button
            variant="secondary"
            onPress={() => {
              appendRef.current = true
              handleRegenerate()
            }}
          >
            <Text>{t('wizard:aiAssist.actions.generateMore')}</Text>
          </Button>
          <Button
            disabled={selected.size === 0}
            onPress={() => {
              props.onImport(marked.filter((row) => selected.has(row.name) && !row.exists))
              closeOverlay()
            }}
          >
            <Text>{t('wizard:aiAssist.actions.importSelected')}</Text>
          </Button>
        </View>
      </View>
    )
  }

  function renderChipsResult(): ReactNode {
    if (props.result !== 'chips' || assist.kind !== 'result') return null
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
        <View className="flex-row justify-end gap-2">
          <Button variant="ghost" onPress={closeOverlay}>
            <Text>{t('wizard:aiAssist.actions.discard')}</Text>
          </Button>
          <Button variant="secondary" onPress={handleRegenerate}>
            <Text>{t('wizard:aiAssist.actions.regenerate')}</Text>
          </Button>
        </View>
      </View>
    )
  }

  function renderProseResult(): ReactNode {
    if (props.result !== 'prose' || assist.kind !== 'result') return null
    const prose = props.getProse(assist.value)
    return (
      <View className="gap-3">
        <Heading level={3}>{`✨ ${ariaLabel}`}</Heading>
        <View className="max-h-60 rounded-md border border-border bg-bg-sunken p-3">
          <Scroller>
            <Text size="sm">{prose}</Text>
          </Scroller>
        </View>
        <View className="flex-row flex-wrap justify-end gap-2">
          <Button variant="ghost" onPress={closeOverlay}>
            <Text>{t('wizard:aiAssist.actions.discard')}</Text>
          </Button>
          {props.refine != null ? (
            <Button
              variant="secondary"
              onPress={() => {
                setRefineText('')
                setAssist({ kind: 'refine', value: assist.value })
              }}
            >
              <Text>{t('wizard:aiAssist.actions.refine')}</Text>
            </Button>
          ) : null}
          <Button variant="secondary" onPress={handleRegenerate}>
            <Text>{t('wizard:aiAssist.actions.regenerate')}</Text>
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

      case 'result':
        if (props.result === 'list') return renderListResult()
        if (props.result === 'chips') return renderChipsResult()
        return renderProseResult()

      case 'refine':
        return (
          <View className="gap-3">
            <Heading level={3}>{`✨ ${ariaLabel}`}</Heading>
            <View className="gap-1">
              <Text size="sm" variant="muted">
                {t('wizard:aiAssist.refine.label')}
              </Text>
              <Input
                value={refineText}
                onChangeText={setRefineText}
                placeholder={t('wizard:aiAssist.refine.placeholder')}
                maxLength={GUIDANCE_MAX_LENGTH}
                aria-label={t('wizard:aiAssist.refine.label')}
              />
            </View>
            <View className="flex-row justify-end gap-2">
              <Button
                variant="ghost"
                onPress={() => setAssist({ kind: 'result', value: assist.value })}
              >
                <Text>{t('wizard:aiAssist.actions.cancel')}</Text>
              </Button>
              <Button onPress={() => void runRefine(assist.value, refineText)}>
                <Text>{t('wizard:aiAssist.actions.refine')}</Text>
              </Button>
            </View>
          </View>
        )

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
              <Button onPress={assist.retry}>
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
