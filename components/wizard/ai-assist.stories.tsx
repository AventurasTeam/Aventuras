import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'
import type { ZodType } from 'zod'

import { Text } from '@/components/ui/text'
import type { ResolveModelConfig } from '@/lib/ai'
import { descriptionOutputSchema, titleChipsSchema, type WizardAssistResult } from '@/lib/wizard'

import { AiAssist } from './ai-assist'

// AiAssist resolves its ResolveModelConfig from the live appSettingsStore and
// calls the real runWizardAssist by default. Both are injectable seams
// (`resolveConfig` / `runAssist`) — the same shape Task 19's `calendars?` prop
// used on StepCalendar — so these stories drive the real component end to end
// without a provider network call or module-level mocking.

const PROVIDER_ID = 'provider-1'
const PROFILE_ID = 'profile-1'
const MODEL_ID = 'gpt-4o-mini'

const CONFIGURED_CONFIG: ResolveModelConfig = {
  providers: [
    {
      id: PROVIDER_ID,
      type: 'openai-compatible',
      displayName: 'Test Provider',
      apiKey: 'test-key',
      favoriteModelIds: [],
    },
  ],
  profiles: [
    {
      id: PROFILE_ID,
      kind: 'agent',
      name: 'Wizard Assist',
      modelRef: { providerId: PROVIDER_ID, modelId: MODEL_ID },
    },
  ],
  assignments: { 'wizard-assist': PROFILE_ID },
  defaultProviderId: PROVIDER_ID,
}

const NOT_CONFIGURED_CONFIG: ResolveModelConfig = {
  providers: [],
  profiles: [],
  assignments: {},
  defaultProviderId: null,
}

function okAssist<T>(value: T) {
  return async (
    _prompt: string,
    _schema: ZodType<T>,
    _config: ResolveModelConfig,
    _signal: AbortSignal,
  ): Promise<WizardAssistResult<T>> => ({ status: 'ok', value })
}

function failAssist<T>(detail: string) {
  return async (
    _prompt: string,
    _schema: ZodType<T>,
    _config: ResolveModelConfig,
    _signal: AbortSignal,
  ): Promise<WizardAssistResult<T>> => ({ status: 'failed', detail })
}

// Fails once (drives the Failure state), then succeeds — exercises "Try
// again" re-invoking the same call rather than just re-showing guidance.
function flakyThenOkAssist<T>(value: T, detail: string) {
  let calls = 0
  return async (
    _prompt: string,
    _schema: ZodType<T>,
    _config: ResolveModelConfig,
    _signal: AbortSignal,
  ): Promise<WizardAssistResult<T>> => {
    calls += 1
    if (calls === 1) return { status: 'failed', detail }
    return { status: 'ok', value }
  }
}

// Never settles — holds the component in 'loading' so a play function can
// assert the spinner + model name without racing a real resolution.
function neverResolvingAssist<T>() {
  return (
    _prompt: string,
    _schema: ZodType<T>,
    _config: ResolveModelConfig,
    _signal: AbortSignal,
  ): Promise<WizardAssistResult<T>> => new Promise(() => {})
}

type DescriptionValue = { description: string }
type TitlesValue = { titles: string[] }

type ProseDemoProps = {
  resolveConfig: () => ResolveModelConfig
  // Matches AiAssist's own `runAssist` prop shape (schema: ZodType<T>, not the
  // concrete ZodObject) — zod v4's ZodObject and ZodType carry distinct
  // internals branding, so a function typed against the concrete schema
  // doesn't structurally satisfy the generic-T slot.
  runAssist: (
    prompt: string,
    schema: ZodType<DescriptionValue>,
    config: ResolveModelConfig,
    signal: AbortSignal,
  ) => Promise<WizardAssistResult<DescriptionValue>>
  onSetup: () => void
  onUse: (value: DescriptionValue) => void
}

// Shared demo for every prose-result scenario (guidance / loading / result /
// failure / not-configured) — result presentation only diverges at the
// 'result' state, so one wrapper covers the rest of the state machine too.
function ProseDemo({ resolveConfig, runAssist, onSetup, onUse }: ProseDemoProps) {
  const [committed, setCommitted] = useState('(none)')
  return (
    <View className="w-96 gap-3 rounded-md bg-bg-base p-6">
      <Text size="sm" variant="muted">
        Committed: {committed}
      </Text>
      <AiAssist
        ariaLabel="Suggest description"
        guidancePlaceholder='e.g. "a tense heist thriller"'
        buildPrompt={(guidance) => `Write a short story description. Guidance: ${guidance}`}
        schema={descriptionOutputSchema}
        result="prose"
        getProse={(v) => v.description}
        onUse={(v) => {
          setCommitted(v.description)
          onUse(v)
        }}
        onSetup={onSetup}
        resolveConfig={resolveConfig}
        runAssist={runAssist}
      />
    </View>
  )
}

type ChipsDemoProps = {
  resolveConfig: () => ResolveModelConfig
  runAssist: (
    prompt: string,
    schema: ZodType<TitlesValue>,
    config: ResolveModelConfig,
    signal: AbortSignal,
  ) => Promise<WizardAssistResult<TitlesValue>>
  onSetup: () => void
  onPickChip: (chip: string, value: TitlesValue) => void
}

function ChipsDemo({ resolveConfig, runAssist, onSetup, onPickChip }: ChipsDemoProps) {
  const [committed, setCommitted] = useState('(none)')
  return (
    <View className="w-96 gap-3 rounded-md bg-bg-base p-6">
      <Text size="sm" variant="muted">
        Committed: {committed}
      </Text>
      <AiAssist
        ariaLabel="Suggest title"
        guidancePlaceholder='e.g. "punchy, one word"'
        buildPrompt={(guidance) => `Suggest 5 titles. Guidance: ${guidance}`}
        schema={titleChipsSchema}
        result="chips"
        getChips={(v) => v.titles}
        onPickChip={(chip, value) => {
          setCommitted(chip)
          onPickChip(chip, value)
        }}
        onSetup={onSetup}
        resolveConfig={resolveConfig}
        runAssist={runAssist}
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
      resolveConfig={() => CONFIGURED_CONFIG}
      runAssist={neverResolvingAssist<DescriptionValue>()}
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
      resolveConfig={() => CONFIGURED_CONFIG}
      runAssist={neverResolvingAssist<DescriptionValue>()}
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
      resolveConfig={() => CONFIGURED_CONFIG}
      runAssist={okAssist<DescriptionValue>({
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
      resolveConfig={() => CONFIGURED_CONFIG}
      runAssist={okAssist<DescriptionValue>({ description: 'Discarded suggestion text.' })}
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
      resolveConfig={() => CONFIGURED_CONFIG}
      runAssist={okAssist<TitlesValue>({
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
      resolveConfig={() => CONFIGURED_CONFIG}
      runAssist={failAssist<DescriptionValue>('Provider request timed out after 3 retries')}
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
      resolveConfig={() => CONFIGURED_CONFIG}
      runAssist={flakyThenOkAssist<DescriptionValue>(
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
      resolveConfig={() => NOT_CONFIGURED_CONFIG}
      runAssist={okAssist<DescriptionValue>({ description: 'unreachable — never configured' })}
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
      resolveConfig={() => NOT_CONFIGURED_CONFIG}
      runAssist={okAssist<DescriptionValue>({ description: 'unreachable — never configured' })}
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
        buildPrompt={() => 'unused'}
        schema={descriptionOutputSchema}
        result="prose"
        getProse={(v) => v.description}
        onUse={fn()}
        onSetup={fn()}
        disabled
        resolveConfig={() => CONFIGURED_CONFIG}
        runAssist={okAssist<DescriptionValue>({ description: 'should never appear' })}
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
        resolveConfig={() => CONFIGURED_CONFIG}
        runAssist={okAssist<DescriptionValue>({ description: 'Phone-tier sample result.' })}
        onSetup={fn()}
        onUse={fn()}
      />
    </View>
  ),
}
