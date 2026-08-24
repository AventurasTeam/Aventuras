import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import type { GenerateStructuredResult } from '@/lib/ai'
import {
  emptyCastDraft,
  type WizardCastDraft,
  type WizardCharacterDraft,
  type WizardFactionDraft,
  type WizardLocationDraft,
} from '@/lib/db'
import { appSettingsStore, wizardStore } from '@/lib/stores'
import { toastStore, type ToastItem } from '@/lib/toast'

import { StepCast } from './step-cast'
import type { CastAssistValue } from './wizard-assist'

const MODEL_ID = 'gpt-4o-mini'

function okListRun(value: CastAssistValue) {
  return async (
    _guidance: string,
    _signal: AbortSignal,
    _exclude: readonly string[],
  ): Promise<GenerateStructuredResult<CastAssistValue>> => ({ status: 'ok', value })
}

function characterRow(
  overrides: Partial<WizardCharacterDraft> & { id: string },
): WizardCharacterDraft {
  return { ...emptyCastDraft('character', overrides.id), ...overrides }
}

function locationRow(
  overrides: Partial<WizardLocationDraft> & { id: string },
): WizardLocationDraft {
  return { ...emptyCastDraft('location', overrides.id), ...overrides }
}

function factionRow(overrides: Partial<WizardFactionDraft> & { id: string }): WizardFactionDraft {
  return { ...emptyCastDraft('faction', overrides.id), ...overrides }
}

type SeedOptions = {
  cast?: WizardCastDraft[]
  leadEntityId?: string | null
  mode?: 'adventure' | 'creative'
  narration?: 'first' | 'second' | 'third'
}

// `hydrate` deliberately, not the mutators: it is the resume path, and the only
// way to seed a lead pointer the store's own cascades would have refused.
function seed({ cast = [], leadEntityId = null, mode, narration }: SeedOptions = {}) {
  wizardStore.reset()
  appSettingsStore.__reset()
  toastStore.__reset()
  const state = wizardStore.getWizard().state
  wizardStore.hydrate({
    ...state,
    definition: {
      ...state.definition,
      ...(mode ? { mode } : null),
      ...(narration ? { narration } : null),
    },
    cast,
    leadEntityId,
  })
}

// Row names disambiguate expand / collapse / remove, but "Set as lead" and
// every editor field label still repeat across rows, and more than one row can
// be open at once — per-row queries scope through the row's `dataSet` anchor
// (docs/testing.md → Selector strategy, tier 3).
function castRow(id: string): HTMLElement {
  const el = document.querySelector(`[data-cast-id="${id}"]`)
  if (el == null) throw new Error(`no cast row rendered for id ${id}`)
  return el as HTMLElement
}

function collectToasts(): { items: () => ToastItem[]; stop: () => void } {
  let items: ToastItem[] = []
  const stop = toastStore.subscribe((next) => {
    items = next
  })
  return { items: () => items, stop }
}

const meta: Meta<typeof StepCast> = {
  title: 'Compounds/Wizard/StepCast',
  component: StepCast,
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
type Story = StoryObj<typeof StepCast>

export const EmptyCastShowsBothAddAffordances: Story = {
  beforeEach: () => seed(),
  play: async () => {
    expect(await screen.findByText("Who's in this story?")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suggest cast' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
    expect(
      screen.getByText('No cast yet. Add someone, or let ✨ suggest a few.'),
    ).toBeInTheDocument()

    // Creative + third person: no lead is required, so no notice.
    expect(screen.queryByText(/needs a lead character/)).not.toBeInTheDocument()
  },
}

const MIXED_CAST = [
  characterRow({
    id: 'char_aria',
    name: 'Aria Stoneheart',
    description: 'A young blacksmith from a fallen kingdom.',
  }),
  locationRow({
    id: 'loc_keep',
    name: 'Mornstone Keep',
    description: 'The fortified seat of House Aerwyn.',
  }),
  characterRow({ id: 'char_gandalf', name: 'Gandalf', status: 'staged' }),
]

export const MixedCastRendersLeadAndStagedMarkers: Story = {
  beforeEach: () => seed({ cast: MIXED_CAST, leadEntityId: 'char_aria' }),
  play: async () => {
    expect(await screen.findByText('Aria Stoneheart')).toBeInTheDocument()
    const leadChip = within(castRow('char_aria')).getByText('Lead')
    expect(leadChip).toBeInTheDocument()
    // iconography.md maps the wireframe's ⭐ to Lucide `Star`; the badge renders
    // it through Tag's `leading` slot rather than an emoji in the copy.
    expect(leadChip.parentElement?.querySelector('svg')).not.toBeNull()
    expect(within(castRow('char_aria')).getByText(/A young blacksmith/)).toBeInTheDocument()

    expect(within(castRow('char_gandalf')).getByText('Staged')).toBeInTheDocument()
    expect(within(castRow('char_gandalf')).queryByText('Lead')).not.toBeInTheDocument()

    // A location is neither lead-able nor staged here — no marker, no compact
    // "Set as lead", and the kind is carried by the icon rather than a chip.
    expect(within(castRow('loc_keep')).queryByRole('button', { name: 'Set as lead' })).toBeNull()

    // `aria-label` on the row Pressable suppresses the row's own text, so the
    // name has to be interpolated in or all three rows — including all three
    // DESTRUCTIVE removes — announce identically.
    const names = (pattern: RegExp) =>
      new Set(screen.getAllByRole('button', { name: pattern }).map((el) => el.ariaLabel))
    expect(names(/^Expand /)).toEqual(
      new Set(['Expand Aria Stoneheart', 'Expand Mornstone Keep', 'Expand Gandalf']),
    )
    expect(names(/^Remove /)).toEqual(
      new Set(['Remove Aria Stoneheart', 'Remove Mornstone Keep', 'Remove Gandalf']),
    )
  },
}

export const AddMenuAppendsAnExpandedRowOfThePickedKind: Story = {
  beforeEach: () => seed(),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Location' }))

    await waitFor(() => expect(wizardStore.getWizard().state.cast).toHaveLength(1))
    const added = wizardStore.getWizard().state.cast[0]
    expect(added.kind).toBe('location')

    // Added rows open straight into their editor (expandAdded), unlike an
    // import batch — the row is blank and there is nothing else to do with it.
    expect(within(castRow(added.id)).getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByText('Unnamed entry')).toBeInTheDocument()
    // A blank row is still addressable: the name falls back rather than
    // interpolating an empty string into the label.
    expect(screen.getByRole('button', { name: 'Collapse Unnamed entry' })).toBeInTheDocument()
  },
}

const TWO_ACTIVE_CHARACTERS = [
  characterRow({ id: 'char_aria', name: 'Aria Stoneheart', description: 'A young blacksmith.' }),
  characterRow({ id: 'char_jorin', name: 'Old Jorin', description: 'The grizzled barkeeper.' }),
]

export const SetAsLeadFromTheCompactRowClearsTheNoticeWithoutExpanding: Story = {
  // Both triggers fire at once here, which is what pins mode as the winner:
  // the narration copy would be equally "true" and is the wrong sentence.
  beforeEach: () => seed({ cast: TWO_ACTIVE_CHARACTERS, mode: 'adventure', narration: 'first' }),
  play: async () => {
    expect(
      await screen.findByText(
        'Adventure mode needs a lead character. Mark one active character as lead to continue.',
      ),
    ).toBeInTheDocument()

    const jorin = castRow('char_jorin')
    // The compact affordance rides ExpandableRow's `compactAction` slot, which
    // renders outside the row-wide expand Pressable. Nested in `compact` it
    // would be a button inside a button — RN-Web still swallows the press
    // rather than bubbling it, so only the DOM nesting catches that.
    const expandJorin = within(jorin).getByRole('button', { name: 'Expand Old Jorin' })
    expect(within(expandJorin).queryByRole('button', { name: 'Set as lead' })).toBeNull()

    const setLead = within(jorin).getByRole('button', { name: 'Set as lead' })
    expect(setLead.querySelector('svg')).not.toBeNull()
    await userEvent.click(setLead)

    await waitFor(() => expect(wizardStore.getWizard().state.leadEntityId).toBe('char_jorin'))
    await waitFor(() =>
      expect(screen.queryByText(/needs a lead character/)).not.toBeInTheDocument(),
    )
    expect(within(castRow('char_jorin')).getByText('Lead')).toBeInTheDocument()

    // The compact action sits OUTSIDE ExpandableRow's row-wide expand
    // Pressable; nested inside it, this press would also have opened the editor.
    expect(within(castRow('char_jorin')).queryByLabelText('Name')).not.toBeInTheDocument()

    // The affordance is per-row, and only the row anchor tells them apart: the
    // new lead loses its own button while the other character keeps one.
    expect(within(castRow('char_jorin')).queryByRole('button', { name: 'Set as lead' })).toBeNull()
    expect(
      within(castRow('char_aria')).getByRole('button', { name: 'Set as lead' }),
    ).toBeInTheDocument()
  },
}

export const RemovingTheLeadToastsAndDropsTheBadge: Story = {
  beforeEach: () =>
    seed({ cast: TWO_ACTIVE_CHARACTERS, leadEntityId: 'char_aria', mode: 'adventure' }),
  play: async () => {
    const toasts = collectToasts()
    try {
      expect(await screen.findByText('Aria Stoneheart')).toBeInTheDocument()
      expect(screen.queryByText(/needs a lead character/)).not.toBeInTheDocument()

      await userEvent.click(
        within(castRow('char_aria')).getByRole('button', { name: 'Remove Aria Stoneheart' }),
      )

      await waitFor(() => expect(wizardStore.getWizard().state.cast).toHaveLength(1))
      expect(wizardStore.getWizard().state.leadEntityId).toBeNull()
      await waitFor(() =>
        expect(
          toasts
            .items()
            .some((item) => item.message === 'Lead unset — the lead was removed from the cast.'),
        ).toBe(true),
      )
      // The gate re-arms the moment the lead goes.
      expect(await screen.findByText(/Adventure mode needs a lead character/)).toBeInTheDocument()
    } finally {
      toasts.stop()
    }
  },
}

export const AStagedLeadPointerBadgesNoRowAndKeepsTheNotice: Story = {
  // A resumed draft can carry a leadEntityId pointing at a row that was staged
  // (or turned non-character) since — the store's cascades only fire on live
  // edits, so hydrate reaches this state and the UI has to survive it.
  beforeEach: () =>
    seed({
      cast: [characterRow({ id: 'char_ghost', name: 'Gandalf', status: 'staged' })],
      leadEntityId: 'char_ghost',
      narration: 'first',
    }),
  play: async () => {
    expect(
      await screen.findByText(
        'First- and second-person narration need a lead character. Mark one active character as lead to continue.',
      ),
    ).toBeInTheDocument()

    // The notice and the row must agree: resolving through activeLead is what
    // keeps a "⭐ Lead" badge off a row the step just said isn't the lead.
    expect(within(castRow('char_ghost')).getByText('Staged')).toBeInTheDocument()
    expect(within(castRow('char_ghost')).queryByText('Lead')).not.toBeInTheDocument()
  },
}

const CAST_SUGGESTIONS: CastAssistValue = {
  entities: [
    {
      kind: 'faction',
      name: 'Ashfall Pact',
      description: 'A brittle alliance of the ash-country holds.',
      status: 'active',
      agenda: ['hold the passes'],
    },
    {
      kind: 'character',
      name: 'Aria Stoneheart',
      description: 'A young blacksmith from a fallen kingdom.',
      status: 'active',
      // Resolved case-insensitively against the same import batch.
      faction_name: 'ashfall pact',
    },
  ],
}

export const ImportingSuggestedCastResolvesCrossBatchRefs: Story = {
  beforeEach: () => seed(),
  render: () => (
    <StepCast
      onSetupAssist={fn()}
      assist={{ resolveModelId: () => MODEL_ID, cast: okListRun(CAST_SUGGESTIONS) }}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest cast' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Ashfall Pact' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Aria Stoneheart' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import selected' }))

    await waitFor(() => expect(wizardStore.getWizard().state.cast).toHaveLength(2))
    const imported = wizardStore.getWizard().state.cast
    const faction = imported.find((row) => row.kind === 'faction')!
    const character = imported.find((row) => row.kind === 'character')!
    expect(character.kind === 'character' && character.factionId).toBe(faction.id)

    // Imported rows land collapsed — expandAdded is the add path only.
    expect(await screen.findByText('Aria Stoneheart')).toBeInTheDocument()
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  },
}

export const ImportingWithoutTheReferencedFactionToastsTheDrop: Story = {
  beforeEach: () => seed(),
  render: () => (
    <StepCast
      onSetupAssist={fn()}
      assist={{ resolveModelId: () => MODEL_ID, cast: okListRun(CAST_SUGGESTIONS) }}
    />
  ),
  play: async () => {
    const toasts = collectToasts()
    await userEvent.click(screen.getByRole('button', { name: 'Suggest cast' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    // The character alone: resolution scopes to the imported SELECTION, so the
    // faction it names is out of scope and its factionId lands null.
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Aria Stoneheart' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import selected' }))

    await waitFor(() => expect(wizardStore.getWizard().state.cast).toHaveLength(1))
    const [character] = wizardStore.getWizard().state.cast
    expect(character.kind === 'character' && character.factionId).toBeNull()

    // Without this the discard is invisible — the Faction picker just says
    // "No factions yet", which reads as "you have none".
    await waitFor(() =>
      expect(
        toasts
          .items()
          .some((item) => item.message === "1 reference couldn't be matched and was left blank."),
      ).toBe(true),
    )
    toasts.stop()
  },
}

// The toast above is transient; the row itself has to carry the ask, and the
// message has to track a cast the user is still editing. Importing the faction
// afterwards must downgrade "not in your cast" without a re-import.
export const ADroppedRefWarnsOnTheRowAndTracksTheLiveCast: Story = {
  beforeEach: () => seed(),
  render: () => (
    <StepCast
      onSetupAssist={fn()}
      assist={{ resolveModelId: () => MODEL_ID, cast: okListRun(CAST_SUGGESTIONS) }}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest cast' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Aria Stoneheart' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import selected' }))

    // The faction was left out of the selection, so the row shows the ask.
    expect(
      await screen.findByText('Suggested faction “ashfall pact” is not in your cast.'),
    ).toBeInTheDocument()

    // Add the faction by hand; the row's warning re-checks and downgrades.
    wizardStore.importCast([{ ...emptyCastDraft('faction', 'fact_added'), name: 'Ashfall Pact' }])
    expect(
      await screen.findByText('“ashfall pact” is in your cast — attach it in the editor.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Suggested faction “ashfall pact” is not in your cast.'),
    ).not.toBeInTheDocument()
  },
}

const SAME_NAME_ACROSS_KINDS: CastAssistValue = {
  entities: [
    {
      kind: 'character',
      name: 'Aria Stoneheart',
      description: 'The same smith the cast already holds.',
      status: 'active',
    },
    {
      kind: 'location',
      name: 'Aria Stoneheart',
      description: 'A waystation named for her, and not the same row at all.',
      status: 'active',
    },
  ],
}

export const DedupeIsKindScopedAndSurvivesAPaddedAuthoredName: Story = {
  // The authored name carries padding: the wizard stores what the user typed.
  // Both sides are built with composeKey, which normalizes each half — a naive
  // `${kind}:${name}` normalizes only the joined string, leaving the padding as
  // interior whitespace, and the duplicate imports silently.
  beforeEach: () =>
    seed({ cast: [characterRow({ id: 'char_aria', name: '  Aria Stoneheart  ' })] }),
  render: () => (
    <StepCast
      onSetupAssist={fn()}
      assist={{ resolveModelId: () => MODEL_ID, cast: okListRun(SAME_NAME_ACROSS_KINDS) }}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest cast' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))

    const rows = await screen.findAllByRole('checkbox', { name: 'Aria Stoneheart' })
    expect(rows).toHaveLength(2)
    const [character, location] = rows
    // RN-Web renders the row as a div[role=checkbox], so disabled state reads
    // off aria-disabled rather than jest-dom's form-element `toBeDisabled`.
    expect(character).toHaveAttribute('aria-disabled', 'true')
    expect(location).not.toHaveAttribute('aria-disabled', 'true')
    expect(screen.getAllByText('(already exists)')).toHaveLength(1)

    // The selectable one is the location; importing it must not be blocked by
    // the character it merely shares a name with.
    await userEvent.click(location)
    await userEvent.click(screen.getByRole('button', { name: 'Import selected' }))
    await waitFor(() => expect(wizardStore.getWizard().state.cast).toHaveLength(2))
    expect(wizardStore.getWizard().state.cast[1].kind).toBe('location')
  },
}

export const ExpandedCharacterPicksAFactionFromTheCast: Story = {
  beforeEach: () =>
    seed({
      cast: [
        characterRow({ id: 'char_aria', name: 'Aria Stoneheart' }),
        factionRow({ id: 'fact_ashfall', name: 'Ashfall Pact' }),
      ],
    }),
  play: async () => {
    await userEvent.click(
      within(castRow('char_aria')).getByRole('button', { name: 'Expand Aria Stoneheart' }),
    )
    const aria = within(castRow('char_aria'))
    await userEvent.click(await aria.findByText('More options'))

    // The picker reads the live cast the list passed down, so a faction
    // authored as a sibling row is offered without a remount.
    await userEvent.click(await aria.findByText('Ashfall Pact'))
    await waitFor(() => {
      const row = wizardStore.getWizard().state.cast[0]
      expect(row.kind === 'character' && row.factionId).toBe('fact_ashfall')
    })
  },
}
