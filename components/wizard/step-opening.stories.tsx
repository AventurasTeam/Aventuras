import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'
import type { ZodType } from 'zod'

import type { ResolveModelConfig } from '@/lib/ai'
import { appSettingsStore, wizardStore } from '@/lib/stores'
import type { OpeningOutput, WizardAssistResult } from '@/lib/wizard'

import { StepOpening } from './step-opening'

const LEAD_ID = 'char_11111111-1111-1111-1111-111111111111'
const MODEL_ID = 'gpt-4o-mini'

const CONFIGURED_CONFIG: ResolveModelConfig = {
  providers: [
    {
      id: 'provider-1',
      type: 'openai-compatible',
      displayName: 'Test Provider',
      apiKey: 'test-key',
      favoriteModelIds: [],
    },
  ],
  profiles: [
    {
      id: 'profile-1',
      kind: 'agent',
      name: 'Wizard Assist',
      modelRef: { providerId: 'provider-1', modelId: MODEL_ID },
    },
  ],
  assignments: { 'wizard-assist': 'profile-1' },
  defaultProviderId: 'provider-1',
}

function okAssist<T>(value: T) {
  return async (
    _prompt: string,
    _schema: ZodType<T>,
    _config: ResolveModelConfig,
    _signal: AbortSignal,
  ): Promise<WizardAssistResult<T>> => ({ status: 'ok', value })
}

const meta: Meta<typeof StepOpening> = {
  title: 'Compounds/Wizard/StepOpening',
  component: StepOpening,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <View className="w-[720px] gap-4 rounded-md bg-bg-base p-6">
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof StepOpening>

export const EmptyState: Story = {
  beforeEach: () => {
    wizardStore.reset()
    appSettingsStore.__reset()
  },
  play: async () => {
    expect(await screen.findByText('How does this story begin?')).toBeInTheDocument()
    expect(screen.getByText('Generate with ✨, or start typing below.')).toBeInTheDocument()
    // The opening ✨ + the two identity assists all render their triggers.
    expect(screen.getByRole('button', { name: 'Suggest opening' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suggest title' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suggest description' })).toBeInTheDocument()
    // No committed metadata line while empty.
    expect(screen.queryByText(/Scene metadata/)).not.toBeInTheDocument()
  },
}

export const CommittedUserWritten: Story = {
  beforeEach: () => {
    wizardStore.reset()
    appSettingsStore.__reset()
    wizardStore.patchOpening({ content: 'The harbor lay still under a bruised sky.' })
  },
  play: async () => {
    // User-written prose shows in the editable textarea, no scene-metadata line.
    expect(
      await screen.findByDisplayValue('The harbor lay still under a bruised sky.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Generate with ✨, or start typing below.')).not.toBeInTheDocument()
    expect(screen.queryByText(/Scene metadata/)).not.toBeInTheDocument()
    // ✨ stays available in the committed state.
    expect(screen.getByRole('button', { name: 'Suggest opening' })).toBeInTheDocument()
  },
}

// The load-bearing id-consistency path: the model returns a placeholder ('c1')
// for the lead; onUse round-trips it back to the SAME real lead id stored in
// working-state, and marks the opening AI-generated.
export const OpeningAssistRoundTripsLeadId: Story = {
  beforeEach: () => {
    wizardStore.reset()
    appSettingsStore.__reset()
    wizardStore.patchDefinition({ mode: 'adventure', narration: 'first' })
    wizardStore.setLeadName('Aria')
    wizardStore.setLeadEntityId(LEAD_ID)
  },
  render: () => (
    <StepOpening
      onSetupAssist={fn()}
      assist={{
        resolveConfig: () => CONFIGURED_CONFIG,
        opening: okAssist<OpeningOutput>({
          prose: 'Aria drew her blade as the storm broke over the harbor.',
          sceneEntities: ['c1'],
          currentLocationId: null,
          worldTime: 0,
        }),
      }}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest opening' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(await screen.findByText(/Aria drew her blade/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Use this' }))

    await waitFor(() => {
      const opening = wizardStore.getWizard().state.opening
      expect(opening.content).toBe('Aria drew her blade as the storm broke over the harbor.')
      // 'c1' resolved back to the real lead id — refs, working-state, and (at
      // Finish) the lead entities row + definition.leadEntityId all agree.
      expect(opening.sceneEntities).toEqual([LEAD_ID])
      expect(opening.model).toBe(MODEL_ID)
    })
    // Committed state surfaces the resolved cast name in the metadata line.
    expect(await screen.findByText('Scene metadata: Aria')).toBeInTheDocument()
  },
}

// Malformed refs (an unresolvable placeholder on a lead-less path) fall back to
// user-written semantics: keep the prose, drop the metadata, model = null.
export const MalformedRefsFallBackToUserWritten: Story = {
  beforeEach: () => {
    wizardStore.reset()
    appSettingsStore.__reset()
  },
  render: () => (
    <StepOpening
      onSetupAssist={fn()}
      assist={{
        resolveConfig: () => CONFIGURED_CONFIG,
        opening: okAssist<OpeningOutput>({
          prose: 'The archivist unrolled a map no living hand had drawn.',
          sceneEntities: ['c1'],
          currentLocationId: null,
          worldTime: 0,
        }),
      }}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest opening' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Use this' }))

    await waitFor(() => {
      const opening = wizardStore.getWizard().state.opening
      expect(opening.content).toBe('The archivist unrolled a map no living hand had drawn.')
      expect(opening.sceneEntities).toEqual([])
      expect(opening.model).toBeNull()
    })
    expect(screen.queryByText(/Scene metadata/)).not.toBeInTheDocument()
  },
}

export const TitleChipsFillTitle: Story = {
  beforeEach: () => {
    wizardStore.reset()
    appSettingsStore.__reset()
    wizardStore.patchOpening({ content: 'The harbor lay still under a bruised sky.' })
  },
  render: () => (
    <StepOpening
      onSetupAssist={fn()}
      assist={{
        resolveConfig: () => CONFIGURED_CONFIG,
        title: okAssist({ titles: ['The Bruised Sky', 'Harbor of Ash', 'Still Water'] }),
      }}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest title' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await userEvent.click(await screen.findByText('Harbor of Ash'))

    await waitFor(() =>
      expect(wizardStore.getWizard().state.definition.title).toBe('Harbor of Ash'),
    )
    expect(await screen.findByDisplayValue('Harbor of Ash')).toBeInTheDocument()
  },
}

export const DescriptionAssistFillsDescription: Story = {
  beforeEach: () => {
    wizardStore.reset()
    appSettingsStore.__reset()
    wizardStore.patchOpening({ content: 'The harbor lay still under a bruised sky.' })
  },
  render: () => (
    <StepOpening
      onSetupAssist={fn()}
      assist={{
        resolveConfig: () => CONFIGURED_CONFIG,
        description: okAssist({
          description: 'A smuggler races a rising storm to reach open water.',
        }),
      }}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(await screen.findByText(/A smuggler races a rising storm/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Use this' }))

    await waitFor(() =>
      expect(wizardStore.getWizard().state.definition.description).toBe(
        'A smuggler races a rising storm to reach open water.',
      ),
    )
  },
}
