import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import type { GenerateStructuredResult } from '@/lib/ai'
import { appSettingsStore, wizardStore } from '@/lib/stores'
import { GENRE_PRESETS } from '@/lib/wizard'

import { StepWorld } from './step-world'

const MODEL_ID = 'gpt-4o-mini'

function okRun<T>(value: T) {
  return async (_guidance: string, _signal: AbortSignal): Promise<GenerateStructuredResult<T>> => ({
    status: 'ok',
    value,
  })
}

const NOIR_PRESET = GENRE_PRESETS.find((preset) => preset.id === 'noir')
if (NOIR_PRESET == null) throw new Error('expected a "noir" fixture in GENRE_PRESETS')

const meta: Meta<typeof StepWorld> = {
  title: 'Compounds/Wizard/StepWorld',
  component: StepWorld,
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
type Story = StoryObj<typeof StepWorld>

export const EmptyStateRendersAllTriggers: Story = {
  beforeEach: () => {
    wizardStore.reset()
    appSettingsStore.__reset()
  },
  play: async () => {
    expect(await screen.findByText("What's the world like?")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Browse genre presets' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Browse tone presets' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suggest genre' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suggest tone' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suggest setting' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suggest lore' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add lore' })).toBeInTheDocument()
    expect(
      screen.getByText('No lore yet. Add an entry or let AI suggest some.'),
    ).toBeInTheDocument()
  },
}

export const PresetIntoEmptyGenreAppliesImmediately: Story = {
  beforeEach: () => {
    wizardStore.reset()
    appSettingsStore.__reset()
  },
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Browse genre presets' }))
    await userEvent.click(await screen.findByText(NOIR_PRESET.displayName))

    // No confirm — the field was empty, so the pick applies straight through.
    expect(screen.queryByText(/^Replace genre with/)).not.toBeInTheDocument()
    await waitFor(() =>
      expect(wizardStore.getWizard().state.definition.genre).toEqual({
        label: NOIR_PRESET.displayName,
        promptBody: NOIR_PRESET.promptBody,
      }),
    )
    expect(screen.getByLabelText('Genre')).toHaveValue(NOIR_PRESET.displayName)
  },
}

const SEEDED_GENRE = {
  label: 'Homebrew genre',
  promptBody: 'A homebrew description of the genre, authored by hand.',
}

export const PresetOverNonEmptyGenreCancelLeavesLabelAndBodyUntouched: Story = {
  beforeEach: () => {
    wizardStore.reset()
    appSettingsStore.__reset()
    wizardStore.patchDefinition({ genre: SEEDED_GENRE })
  },
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Browse genre presets' }))
    await userEvent.click(await screen.findByText(NOIR_PRESET.displayName))

    expect(await screen.findByText('Replace genre with "Noir"?')).toBeInTheDocument()
    expect(screen.getByText('Your current label and body will be lost.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByText('Replace genre with "Noir"?')).not.toBeInTheDocument(),
    )

    // Store AND rendered fields both still hold the pre-existing authored value.
    expect(wizardStore.getWizard().state.definition.genre).toEqual(SEEDED_GENRE)
    expect(screen.getByLabelText('Genre')).toHaveValue(SEEDED_GENRE.label)
    expect(screen.getByLabelText('Genre description')).toHaveValue(SEEDED_GENRE.promptBody)
  },
}

export const PresetOverNonEmptyGenreReplaceOverwritesLabelAndBody: Story = {
  beforeEach: () => {
    wizardStore.reset()
    appSettingsStore.__reset()
    wizardStore.patchDefinition({ genre: SEEDED_GENRE })
  },
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Browse genre presets' }))
    await userEvent.click(await screen.findByText(NOIR_PRESET.displayName))
    expect(await screen.findByText('Replace genre with "Noir"?')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Replace' }))
    await waitFor(() =>
      expect(wizardStore.getWizard().state.definition.genre).toEqual({
        label: NOIR_PRESET.displayName,
        promptBody: NOIR_PRESET.promptBody,
      }),
    )
    expect(screen.queryByText('Replace genre with "Noir"?')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Genre')).toHaveValue(NOIR_PRESET.displayName)
  },
}

const SEEDED_TONE = { label: 'Wry and irreverent', promptBody: 'Dry, deflating, never precious.' }
const AI_TONE_SUGGESTION = {
  label: 'Grim and unsparing',
  promptBody: 'Consequences land and stay landed.',
}

// Proves the shared hook, not a second copy of the rule: a preset pick and an
// AI-suggest accept are two different entry points into the same `request()`.
export const AiSuggestOverNonEmptyToneAlsoTriggersConfirm: Story = {
  beforeEach: () => {
    wizardStore.reset()
    appSettingsStore.__reset()
    wizardStore.patchDefinition({ tone: SEEDED_TONE })
  },
  render: () => (
    <StepWorld
      onSetupAssist={fn()}
      assist={{ resolveModelId: () => MODEL_ID, tone: okRun(AI_TONE_SUGGESTION) }}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest tone' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(await screen.findByText(/Grim and unsparing/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Use this' }))

    expect(await screen.findByText('Replace tone with "Grim and unsparing"?')).toBeInTheDocument()
    // Not yet applied — the guard is blocking, same as the preset path.
    expect(wizardStore.getWizard().state.definition.tone).toEqual(SEEDED_TONE)

    await userEvent.click(screen.getByRole('button', { name: 'Replace' }))
    await waitFor(() =>
      expect(wizardStore.getWizard().state.definition.tone).toEqual(AI_TONE_SUGGESTION),
    )
  },
}

const LORE_SUGGESTIONS = {
  lore: [
    {
      title: 'Sealed Wells',
      body: 'Magic flows from sealed wells across the realm.',
      category: 'cosmology',
    },
    {
      title: 'The Old Empire',
      body: 'A thousand years ago the Empire ruled most of the coast.',
      category: '',
    },
  ],
}

export const ImportingSuggestedLoreAppendsCollapsedRows: Story = {
  beforeEach: () => {
    wizardStore.reset()
    appSettingsStore.__reset()
  },
  render: () => (
    <StepWorld
      onSetupAssist={fn()}
      assist={{ resolveModelId: () => MODEL_ID, lore: okRun(LORE_SUGGESTIONS) }}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest lore' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Sealed Wells' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'The Old Empire' }))

    await userEvent.click(screen.getByRole('button', { name: 'Import selected' }))

    expect(await screen.findByText('Sealed Wells')).toBeInTheDocument()
    expect(screen.getByText('The Old Empire')).toBeInTheDocument()
    // Collapsed: no inline editor field for either newly-imported row.
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Body')).not.toBeInTheDocument()

    await waitFor(() => expect(wizardStore.getWizard().state.lore).toHaveLength(2))
    const titles = wizardStore.getWizard().state.lore.map((row) => row.title)
    expect(titles).toEqual(['Sealed Wells', 'The Old Empire'])
  },
}

export const GenreAndTonePresetTriggersAreIndividuallyAddressable: Story = {
  beforeEach: () => {
    wizardStore.reset()
    appSettingsStore.__reset()
  },
  play: async () => {
    const genreTrigger = screen.getByRole('button', { name: 'Browse genre presets' })
    const toneTrigger = screen.getByRole('button', { name: 'Browse tone presets' })
    expect(genreTrigger).toBeInTheDocument()
    expect(toneTrigger).toBeInTheDocument()

    await userEvent.click(genreTrigger)
    expect(await screen.findByText('Hard sci-fi')).toBeInTheDocument()
    // Only the genre catalog opened — tone's first preset never rendered.
    expect(screen.queryByText('Grim and unsparing')).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('Hard sci-fi'))

    await userEvent.click(toneTrigger)
    expect(await screen.findByText('Grim and unsparing')).toBeInTheDocument()
  },
}
