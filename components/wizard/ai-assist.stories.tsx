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

type DescriptionValue = { description: string }
type TitlesValue = { titles: string[] }

type ProseDemoProps = {
  resolveModelId: () => string | null
  run: (
    guidance: string,
    signal: AbortSignal,
  ) => Promise<GenerateStructuredResult<DescriptionValue>>
  onSetup: () => void
  onUse: (value: DescriptionValue) => void
}

// Shared demo for every prose-result scenario (guidance / loading / result /
// failure / not-configured) — result presentation only diverges at the
// 'result' state, so one wrapper covers the rest of the state machine too.
function ProseDemo({ resolveModelId, run, onSetup, onUse }: ProseDemoProps) {
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
