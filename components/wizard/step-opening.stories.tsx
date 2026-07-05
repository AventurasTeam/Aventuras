import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import type { GenerateStructuredResult } from '@/lib/ai'
import { appSettingsStore, wizardStore } from '@/lib/stores'

import { StepOpening } from './step-opening'

const LEAD_ID = 'char_11111111-1111-1111-1111-111111111111'
const MODEL_ID = 'gpt-4o-mini'

function okRun<T>(value: T) {
  return async (_guidance: string, _signal: AbortSignal): Promise<GenerateStructuredResult<T>> => ({
    status: 'ok',
    value,
  })
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

// Wiring: a resolved opening (the op already round-tripped the lead placeholder
// back to the real id) commits through onUse and surfaces the scene metadata.
// The placeholder round-trip itself is unit-tested in wizard-assist.test.ts.
export const OpeningAssistCommits: Story = {
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
        resolveModelId: () => MODEL_ID,
        opening: okRun({
          content: 'Aria drew her blade as the storm broke over the harbor.',
          sceneEntities: [LEAD_ID],
          currentLocationId: null,
          model: MODEL_ID,
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
      expect(opening.sceneEntities).toEqual([LEAD_ID])
      expect(opening.model).toBe(MODEL_ID)
    })
    // Committed state surfaces the resolved cast name in the metadata line.
    expect(await screen.findByText('Scene metadata: Aria')).toBeInTheDocument()
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
        resolveModelId: () => MODEL_ID,
        title: okRun({ titles: ['The Bruised Sky', 'Harbor of Ash', 'Still Water'] }),
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
        resolveModelId: () => MODEL_ID,
        description: okRun({
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
