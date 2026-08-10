import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Text } from '@/components/ui/text'
import type { GenerateStructuredResult } from '@/lib/ai'

import { AiAssist } from './ai-assist'

// AiAssist drives the popover state machine around two injected seams: `run`
// (the bound assist call) and `resolveModelId` (configured model id, or null).
// The stories feed fakes so nothing hits a real provider or the settings store.

const MODEL_ID = 'gpt-4o-mini'

function okRun<T>(value: T) {
  return async (_guidance: string, _signal: AbortSignal): Promise<GenerateStructuredResult<T>> => ({
    status: 'ok',
    value,
  })
}

function failRun<T>(detail: string) {
  return async (_guidance: string, _signal: AbortSignal): Promise<GenerateStructuredResult<T>> => ({
    status: 'failed',
    detail,
  })
}

// Fails once (drives the Failure state), then succeeds — exercises "Try
// again" re-invoking the same call rather than just re-showing guidance.
function flakyThenOkRun<T>(value: T, detail: string) {
  let calls = 0
  return async (_guidance: string, _signal: AbortSignal): Promise<GenerateStructuredResult<T>> => {
    calls += 1
    if (calls === 1) return { status: 'failed', detail }
    return { status: 'ok', value }
  }
}

// Never settles — holds the component in 'loading' so a play function can
// assert the spinner + model name without racing a real resolution.
function neverResolvingRun<T>() {
  return (_guidance: string, _signal: AbortSignal): Promise<GenerateStructuredResult<T>> =>
    new Promise(() => {})
}

// Never settles — holds a refine in 'loading' so a play function can cancel
// it mid-flight and assert the ORIGINAL preview survives, not an empty one.
function neverResolvingRefine<T>() {
  return (
    _current: T,
    _instruction: string,
    _signal: AbortSignal,
  ): Promise<GenerateStructuredResult<T>> => new Promise(() => {})
}

// Fails once, then succeeds — and records every (current, instruction) pair
// it was called with, so a play function can assert Try-again replayed the
// SAME refine rather than falling back to a fresh generate.
function flakyThenOkRefine<T>(
  value: T,
  detail: string,
  calls: { current: T; instruction: string }[],
) {
  let attempts = 0
  return async (
    current: T,
    instruction: string,
    _signal: AbortSignal,
  ): Promise<GenerateStructuredResult<T>> => {
    calls.push({ current, instruction })
    attempts += 1
    if (attempts === 1) return { status: 'failed', detail }
    return { status: 'ok', value }
  }
}

// Records every guidance string `run` was called with — proves Regenerate
// replays the guidance the original generate used, not an empty string.
function guidanceCapturingRun<T>(value: T, calls: string[]) {
  return async (guidance: string, _signal: AbortSignal): Promise<GenerateStructuredResult<T>> => {
    calls.push(guidance)
    return { status: 'ok', value }
  }
}

type DescriptionValue = { description: string }
type TitlesValue = { titles: string[] }

// Appends the instruction to the CURRENT description rather than replacing
// it, so a play function can observe refine's cumulative stacking.
async function appendInstructionRefine(
  current: DescriptionValue,
  instruction: string,
  _signal: AbortSignal,
): Promise<GenerateStructuredResult<DescriptionValue>> {
  return { status: 'ok', value: { description: `${current.description} / ${instruction}` } }
}

type ProseDemoProps = {
  resolveModelId: () => string | null
  run: (
    guidance: string,
    signal: AbortSignal,
  ) => Promise<GenerateStructuredResult<DescriptionValue>>
  refine?: (
    current: DescriptionValue,
    instruction: string,
    signal: AbortSignal,
  ) => Promise<GenerateStructuredResult<DescriptionValue>>
  onSetup: () => void
  onUse: (value: DescriptionValue) => void
}

// Shared demo for every prose-result scenario (guidance / loading / result /
// failure / not-configured) — result presentation only diverges at the
// 'result' state, so one wrapper covers the rest of the state machine too.
function ProseDemo({ resolveModelId, run, refine, onSetup, onUse }: ProseDemoProps) {
  const [committed, setCommitted] = useState('(none)')
  return (
    <View className="w-96 gap-3 rounded-md bg-bg-base p-6">
      <Text size="sm" variant="muted">
        Committed: {committed}
      </Text>
      <AiAssist
        ariaLabel="Suggest description"
        guidancePlaceholder='e.g. "a tense heist thriller"'
        run={run}
        refine={refine}
        resolveModelId={resolveModelId}
        result="prose"
        getProse={(v) => v.description}
        onUse={(v) => {
          setCommitted(v.description)
          onUse(v)
        }}
        onSetup={onSetup}
      />
    </View>
  )
}

type ChipsDemoProps = {
  resolveModelId: () => string | null
  run: (guidance: string, signal: AbortSignal) => Promise<GenerateStructuredResult<TitlesValue>>
  onSetup: () => void
  onPickChip: (chip: string, value: TitlesValue) => void
}

function ChipsDemo({ resolveModelId, run, onSetup, onPickChip }: ChipsDemoProps) {
  const [committed, setCommitted] = useState('(none)')
  return (
    <View className="w-96 gap-3 rounded-md bg-bg-base p-6">
      <Text size="sm" variant="muted">
        Committed: {committed}
      </Text>
      <AiAssist
        ariaLabel="Suggest title"
        guidancePlaceholder='e.g. "punchy, one word"'
        run={run}
        resolveModelId={resolveModelId}
        result="chips"
        getChips={(v) => v.titles}
        onPickChip={(chip, value) => {
          setCommitted(chip)
          onPickChip(chip, value)
        }}
        onSetup={onSetup}
      />
    </View>
  )
}

const meta: Meta<typeof AiAssist> = {
  title: 'Compounds/Wizard/AiAssist',
  component: AiAssist,
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof AiAssist>

export const Guidance: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={neverResolvingRun<DescriptionValue>()}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    expect(await screen.findByText('Optional guidance')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('e.g. "a tense heist thriller"')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate' })).toBeInTheDocument()
  },
}

export const Loading: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={neverResolvingRun<DescriptionValue>()}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('Generating with gpt-4o-mini…')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeInTheDocument()

    // Cancel aborts the in-flight call and returns to guidance rather than
    // closing outright — the user can tweak guidance and retry.
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Optional guidance')).toBeInTheDocument()
  },
}

const proseUseThisMock = fn()
export const ProseResult_UseThis: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<DescriptionValue>({
        description: 'A grizzled captain smuggles refugees past a naval blockade.',
      })}
      onSetup={fn()}
      onUse={proseUseThisMock}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(await screen.findByText(/grizzled captain/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Use this' }))
    await waitFor(() =>
      expect(proseUseThisMock).toHaveBeenCalledWith({
        description: 'A grizzled captain smuggles refugees past a naval blockade.',
      }),
    )
    expect(
      await screen.findByText(
        'Committed: A grizzled captain smuggles refugees past a naval blockade.',
      ),
    ).toBeInTheDocument()
    // The overlay closed — its chrome is gone from the DOM.
    expect(screen.queryByText('Optional guidance')).not.toBeInTheDocument()
  },
}

const proseDiscardMock = fn()
export const ProseResult_Discard: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<DescriptionValue>({ description: 'Discarded suggestion text.' })}
      onSetup={fn()}
      onUse={proseDiscardMock}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('Discarded suggestion text.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() =>
      expect(screen.queryByText('Discarded suggestion text.')).not.toBeInTheDocument(),
    )
    expect(proseDiscardMock).not.toHaveBeenCalled()
  },
}

const proseRefineCumulativeMock = fn()
export const ProseResult_RefineCumulative: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<DescriptionValue>({ description: 'A quiet village wakes to strange lights.' })}
      refine={appendInstructionRefine}
      onSetup={fn()}
      onUse={proseRefineCumulativeMock}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('A quiet village wakes to strange lights.')).toBeInTheDocument()

    // First refine: 'current' is the original generation.
    await userEvent.click(screen.getByRole('button', { name: 'Refine…' }))
    await userEvent.type(
      await screen.findByPlaceholderText('e.g. make it darker'),
      'make it darker',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Refine…' }))
    expect(
      await screen.findByText('A quiet village wakes to strange lights. / make it darker'),
    ).toBeInTheDocument()

    // Second refine: 'current' must be the FIRST refine's output, not the
    // original generation — this is what "cumulative" means.
    await userEvent.click(screen.getByRole('button', { name: 'Refine…' }))
    await userEvent.type(await screen.findByPlaceholderText('e.g. make it darker'), 'add a storm')
    await userEvent.click(screen.getByRole('button', { name: 'Refine…' }))
    expect(
      await screen.findByText(
        'A quiet village wakes to strange lights. / make it darker / add a storm',
      ),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Use this' }))
    await waitFor(() =>
      expect(proseRefineCumulativeMock).toHaveBeenCalledWith({
        description: 'A quiet village wakes to strange lights. / make it darker / add a storm',
      }),
    )
  },
}

const proseCancelRefineMock = fn()
export const ProseResult_CancelRefineKeepsPreview: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<DescriptionValue>({ description: 'The original generated take.' })}
      refine={neverResolvingRefine<DescriptionValue>()}
      onSetup={fn()}
      onUse={proseCancelRefineMock}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('The original generated take.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Refine…' }))
    await userEvent.type(await screen.findByPlaceholderText('e.g. make it darker'), 'darker')
    await userEvent.click(screen.getByRole('button', { name: 'Refine…' }))
    expect(await screen.findByRole('progressbar', { name: 'Loading' })).toBeInTheDocument()

    // Cancelling an in-flight REFINE must return to the preview that was
    // already there, not the empty guidance screen — there's a generated
    // result to protect, unlike cancelling a first-time generate.
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('The original generated take.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Use this' }))
    await waitFor(() =>
      expect(proseCancelRefineMock).toHaveBeenCalledWith({
        description: 'The original generated take.',
      }),
    )
  },
}

const regenerateGuidanceCalls: string[] = []
export const ProseResult_RegeneratePreservesGuidance: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={guidanceCapturingRun<DescriptionValue>(
        { description: 'Same result either way.' },
        regenerateGuidanceCalls,
      )}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.type(
      screen.getByPlaceholderText('e.g. "a tense heist thriller"'),
      'moody and slow-burn',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('Same result either way.')).toBeInTheDocument()

    // Regenerate carries no guidance UI of its own — it must replay the
    // guidance from the original generate, not an empty string.
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(regenerateGuidanceCalls).toHaveLength(2))
    expect(regenerateGuidanceCalls).toEqual(['moody and slow-burn', 'moody and slow-burn'])
  },
}

const chipsPickMock = fn()
export const ChipsResult: Story = {
  render: () => (
    <ChipsDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<TitlesValue>({
        titles: ['The Last Blockade', 'Smoke and Salt', 'Iron Tide'],
      })}
      onSetup={fn()}
      onPickChip={chipsPickMock}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest title' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('The Last Blockade')).toBeInTheDocument()
    expect(screen.getByText('Smoke and Salt')).toBeInTheDocument()
    expect(screen.getByText('Iron Tide')).toBeInTheDocument()

    await userEvent.click(screen.getByText('Smoke and Salt'))
    await waitFor(() =>
      expect(chipsPickMock).toHaveBeenCalledWith('Smoke and Salt', {
        titles: ['The Last Blockade', 'Smoke and Salt', 'Iron Tide'],
      }),
    )
    expect(await screen.findByText('Committed: Smoke and Salt')).toBeInTheDocument()
  },
}

export const Failure: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={failRun<DescriptionValue>('Provider request timed out after 3 retries')}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(
      await screen.findByText("Couldn't generate. Provider request timed out after 3 retries."),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  },
}

export const FailureThenRetrySucceeds: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={flakyThenOkRun<DescriptionValue>(
        { description: 'Recovered description after retry.' },
        'Provider request timed out after 3 retries',
      )}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(
      await screen.findByText("Couldn't generate. Provider request timed out after 3 retries."),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Recovered description after retry.')).toBeInTheDocument()
  },
}

const refineFailureGenerateCalls: string[] = []
const refineFailureRetryCalls: { current: DescriptionValue; instruction: string }[] = []
export const RefineFailureTryAgainRetriesRefine: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={guidanceCapturingRun<DescriptionValue>(
        { description: 'Original generated take.' },
        refineFailureGenerateCalls,
      )}
      refine={flakyThenOkRefine<DescriptionValue>(
        { description: 'Refined and recovered.' },
        'Provider request timed out after 3 retries',
        refineFailureRetryCalls,
      )}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.type(
      screen.getByPlaceholderText('e.g. "a tense heist thriller"'),
      'moody guidance',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('Original generated take.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Refine…' }))
    await userEvent.type(await screen.findByPlaceholderText('e.g. make it darker'), 'darker please')
    await userEvent.click(screen.getByRole('button', { name: 'Refine…' }))
    expect(
      await screen.findByText("Couldn't generate. Provider request timed out after 3 retries."),
    ).toBeInTheDocument()

    // Try again must retry the REFINE that failed — same 'current', same
    // instruction — not fall back to a fresh generate with the old guidance.
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Refined and recovered.')).toBeInTheDocument()

    expect(refineFailureGenerateCalls).toEqual(['moody guidance'])
    expect(refineFailureRetryCalls).toEqual([
      { current: { description: 'Original generated take.' }, instruction: 'darker please' },
      { current: { description: 'Original generated take.' }, instruction: 'darker please' },
    ])
  },
}

export const NotConfigured: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => null}
      run={okRun<DescriptionValue>({ description: 'unreachable — never configured' })}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    expect(await screen.findByText('AI is not configured.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set up in Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  },
}

const notConfiguredSetupMock = fn()
export const NotConfigured_SetupClosesOverlay: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => null}
      run={okRun<DescriptionValue>({ description: 'unreachable — never configured' })}
      onSetup={notConfiguredSetupMock}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Set up in Settings' }))
    await waitFor(() => expect(notConfiguredSetupMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('AI is not configured.')).not.toBeInTheDocument()
  },
}

export const DisabledTrigger: Story = {
  render: () => (
    <View className="w-96 gap-3 rounded-md bg-bg-base p-6">
      <AiAssist
        ariaLabel="Suggest description"
        run={okRun<DescriptionValue>({ description: 'should never appear' })}
        resolveModelId={() => MODEL_ID}
        result="prose"
        getProse={(v) => v.description}
        onUse={fn()}
        onSetup={fn()}
        disabled
      />
    </View>
  ),
  play: async () => {
    const trigger = screen.getByRole('button', { name: 'Suggest description' })
    // The web disabled gate (lessons-learned/rn-primitives-disabled.md): the
    // inline pointer-events:none is what actually blocks the Radix trigger's
    // onClick, since Pressable's own `disabled` doesn't stop it.
    expect(trigger).toHaveStyle({ pointerEvents: 'none' })
    // Nothing opened — no guidance chrome.
    expect(screen.queryByText('Optional guidance')).not.toBeInTheDocument()
  },
}

// useTier() reads the real browser window width, not a wrapper's — resize the
// Storybook preview below 640px to see the ✨ trigger open a bottom Sheet
// instead of a Popover (mirrors GenerationStatusPill's PhonePopover story).
export const PhoneSheetNote: Story = {
  render: () => (
    <View style={{ width: 360 }} className="gap-2 rounded-md bg-bg-base p-4">
      <Text variant="muted" size="sm">
        Resize the Storybook window itself below 640px to see the ✨ trigger open a bottom Sheet
        instead of a Popover.
      </Text>
      <ProseDemo
        resolveModelId={() => MODEL_ID}
        run={okRun<DescriptionValue>({ description: 'Phone-tier sample result.' })}
        onSetup={fn()}
        onUse={fn()}
      />
    </View>
  ),
}
