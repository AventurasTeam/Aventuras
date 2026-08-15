import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import type { GenerateStructuredResult } from '@/lib/ai'
import { emptyCastDraft } from '@/lib/db'
import { appSettingsStore, wizardStore } from '@/lib/stores'

import { StepOpening } from './step-opening'

const LEAD_ID = 'char_11111111-1111-1111-1111-111111111111'
const LOCATION_ID = 'loc_22222222-2222-2222-2222-222222222222'
const STAGED_ID = 'char_33333333-3333-3333-3333-333333333333'
const MISKIND_ID = 'char_44444444-4444-4444-4444-444444444444'
const STAGED_LOCATION_ID = 'loc_55555555-5555-5555-5555-555555555555'
const FACTION_ID = 'fact_66666666-6666-6666-6666-666666666666'
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
    // importCast (not addCast) so the row lands on the fixed LEAD_ID the
    // assist mock's sceneEntities reference, instead of a minted one.
    wizardStore.importCast([{ ...emptyCastDraft('character', LEAD_ID), name: 'Aria' }])
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

export const SceneMetadataJoinsCastAndLocation: Story = {
  beforeEach: () => {
    wizardStore.reset()
    appSettingsStore.__reset()
    wizardStore.patchDefinition({ mode: 'adventure', narration: 'first' })
    wizardStore.importCast([
      { ...emptyCastDraft('character', LEAD_ID), name: 'Aria' },
      { ...emptyCastDraft('location', LOCATION_ID), name: 'Mornstone Keep' },
    ])
    wizardStore.setLeadEntityId(LEAD_ID)
  },
  render: () => (
    <StepOpening
      onSetupAssist={fn()}
      assist={{
        resolveModelId: () => MODEL_ID,
        opening: okRun({
          content: 'Aria drew her blade as the storm broke over Mornstone Keep.',
          sceneEntities: [LEAD_ID],
          currentLocationId: LOCATION_ID,
          model: MODEL_ID,
        }),
      }}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest opening' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await userEvent.click(screen.getByRole('button', { name: 'Use this' }))

    // wizard.md → Committed prose: cast names and the resolved location join
    // with the canon separator ("Aria Stoneheart · Mornstone Keep").
    expect(await screen.findByText('Scene metadata: Aria · Mornstone Keep')).toBeInTheDocument()
  },
}

export const SceneMetadataDropsStagedAndKindMismatchedRefs: Story = {
  beforeEach: () => {
    wizardStore.reset()
    appSettingsStore.__reset()
    wizardStore.patchDefinition({ mode: 'adventure', narration: 'first' })
    wizardStore.importCast([
      { ...emptyCastDraft('character', LEAD_ID), name: 'Aria' },
      { ...emptyCastDraft('character', STAGED_ID), name: 'Gandalf', status: 'staged' },
      // Active but not in sceneEntities, so it can only surface through the
      // (mis-typed) location slot — a distinguishable name for the kind guard,
      // unlike reusing the lead's id, whose name would collide via dedupe.
      { ...emptyCastDraft('character', MISKIND_ID), name: 'Bran' },
      { ...emptyCastDraft('faction', FACTION_ID), name: 'The Ashen Court' },
    ])
    wizardStore.setLeadEntityId(LEAD_ID)
  },
  render: () => (
    <StepOpening
      onSetupAssist={fn()}
      assist={{
        resolveModelId: () => MODEL_ID,
        opening: okRun({
          content: 'Aria drew her blade as the storm broke.',
          sceneEntities: [LEAD_ID, STAGED_ID, FACTION_ID],
          // An active CHARACTER id in the location slot — resolveOpening's
          // reverse substitution doesn't validate kind, so this must render
          // as absent rather than showing a character's name as a location.
          currentLocationId: MISKIND_ID,
          model: MODEL_ID,
        }),
      }}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest opening' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await userEvent.click(screen.getByRole('button', { name: 'Use this' }))

    // Staged Gandalf is dropped (wizard.md → Status field: staged entities
    // can't appear in scene metadata); the kind-mismatched location ref
    // (Bran, a character) is dropped too; and the active faction is dropped
    // because factions are never scene-tagged (data-model.md → Scene presence
    // is kind-aware) — the same filter Finish commits through, so the preview
    // can't promise scene state the story never gets.
    expect(await screen.findByText('Scene metadata: Aria')).toBeInTheDocument()
    expect(screen.queryByText(/Gandalf/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Bran/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Ashen Court/)).not.toBeInTheDocument()
  },
}

export const SceneMetadataDropsStagedLocation: Story = {
  beforeEach: () => {
    wizardStore.reset()
    appSettingsStore.__reset()
    wizardStore.patchDefinition({ mode: 'adventure', narration: 'first' })
    wizardStore.importCast([
      { ...emptyCastDraft('character', LEAD_ID), name: 'Aria' },
      { ...emptyCastDraft('location', STAGED_LOCATION_ID), name: 'Shadowfen', status: 'staged' },
    ])
    wizardStore.setLeadEntityId(LEAD_ID)
  },
  render: () => (
    <StepOpening
      onSetupAssist={fn()}
      assist={{
        resolveModelId: () => MODEL_ID,
        opening: okRun({
          content: 'Aria drew her blade as the storm broke.',
          sceneEntities: [LEAD_ID],
          // A staged location — active-only applies to the location slot too,
          // not just cast rows (wizard.md → Status field).
          currentLocationId: STAGED_LOCATION_ID,
          model: MODEL_ID,
        }),
      }}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest opening' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await userEvent.click(screen.getByRole('button', { name: 'Use this' }))

    expect(await screen.findByText('Scene metadata: Aria')).toBeInTheDocument()
    expect(screen.queryByText(/Shadowfen/)).not.toBeInTheDocument()
  },
}

export const SceneMetadataDedupesRepeatedNames: Story = {
  beforeEach: () => {
    wizardStore.reset()
    appSettingsStore.__reset()
    wizardStore.patchDefinition({ mode: 'adventure', narration: 'first' })
    wizardStore.importCast([
      { ...emptyCastDraft('character', LEAD_ID), name: 'Aria' },
      { ...emptyCastDraft('location', LOCATION_ID), name: 'Mornstone Keep' },
    ])
    wizardStore.setLeadEntityId(LEAD_ID)
  },
  render: () => (
    <StepOpening
      onSetupAssist={fn()}
      assist={{
        resolveModelId: () => MODEL_ID,
        opening: okRun({
          content: 'Aria drew her blade as the storm broke over Mornstone Keep.',
          // The location also appears in sceneEntities alongside the lead —
          // the joined label must not repeat "Mornstone Keep".
          sceneEntities: [LEAD_ID, LOCATION_ID],
          currentLocationId: LOCATION_ID,
          model: MODEL_ID,
        }),
      }}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest opening' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await userEvent.click(screen.getByRole('button', { name: 'Use this' }))

    expect(await screen.findByText('Scene metadata: Aria · Mornstone Keep')).toBeInTheDocument()
  },
}

const EXISTING_OPENING = 'The harbor lay still under a bruised sky.'
const REPLACEMENT_OPENING = 'Aria drew her blade as the storm broke over the harbor.'

export const OpeningAssistOverExistingProseConfirms: Story = {
  beforeEach: () => {
    wizardStore.reset()
    appSettingsStore.__reset()
    wizardStore.patchDefinition({ mode: 'adventure', narration: 'first' })
    // importCast (not addCast) so the row lands on the fixed LEAD_ID the
    // assist mock's sceneEntities reference, instead of a minted one.
    wizardStore.importCast([{ ...emptyCastDraft('character', LEAD_ID), name: 'Aria' }])
    wizardStore.setLeadEntityId(LEAD_ID)
    wizardStore.patchOpening({ content: EXISTING_OPENING })
  },
  render: () => (
    <StepOpening
      onSetupAssist={fn()}
      assist={{
        resolveModelId: () => MODEL_ID,
        opening: okRun({
          content: REPLACEMENT_OPENING,
          sceneEntities: [LEAD_ID],
          currentLocationId: null,
          model: MODEL_ID,
        }),
      }}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest opening' }))
    // Existing prose seeds the preview, so a fresh take comes via Regenerate.
    await userEvent.click(await screen.findByRole('button', { name: 'Regenerate' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Use this' }))

    expect(await screen.findByText('Replace the opening?')).toBeInTheDocument()
    // Blocked until confirmed — the authored prose is still what the store holds.
    expect(wizardStore.getWizard().state.opening.content).toBe(EXISTING_OPENING)

    await userEvent.click(screen.getByRole('button', { name: 'Replace' }))
    await waitFor(() =>
      expect(wizardStore.getWizard().state.opening.content).toBe(REPLACEMENT_OPENING),
    )
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
