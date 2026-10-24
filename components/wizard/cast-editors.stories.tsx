import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, screen, spyOn, userEvent, waitFor, within } from 'storybook/test'

import {
  emptyCastDraft,
  type WizardCastDraft,
  type WizardCharacterDraft,
  type WizardFactionDraft,
  type WizardItemDraft,
  type WizardLocationDraft,
} from '@/lib/db'
import { wizardStore } from '@/lib/stores'
import { toastStore, type ToastItem } from '@/lib/toast'

import { CharacterEditor, FactionEditor, ItemEditor, LocationEditor } from './cast-editors'
import { invalidCastRowIds } from './step-cast-logic'

// Each per-kind editor reads/writes the wizardStore singleton (patchCast /
// setCastStatus / setLeadEntityId) but takes `row` / `cast` / `leadEntityId`
// as props — mirrors LoreList's split between store-owned content and
// caller-supplied validation. Each story reseeds the working-state in
// `beforeEach` so a prior story's rows never leak into the next one.

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

function itemRow(overrides: Partial<WizardItemDraft> & { id: string }): WizardItemDraft {
  return { ...emptyCastDraft('item', overrides.id), ...overrides }
}

function factionRow(overrides: Partial<WizardFactionDraft> & { id: string }): WizardFactionDraft {
  return { ...emptyCastDraft('faction', overrides.id), ...overrides }
}

function seedCast(rows: WizardCastDraft[], leadEntityId: string | null = null) {
  wizardStore.hydrate({ ...wizardStore.getWizard().state, cast: rows, leadEntityId })
}

function castRowById(id: string): WizardCastDraft {
  return wizardStore.getWizard().state.cast.find((r) => r.id === id)!
}

// Placeholders remain the most specific handle while these fields are empty;
// after a chip commits, the persistent labels below are the only stable names.
const PLACEHOLDER = {
  traits: 'e.g. "methodical, guarded"',
  drives: 'e.g. "find her sister, clear the family name"',
  tags: 'e.g. "ally, nobility"',
  agenda: 'e.g. "seize the docks, discredit the guild"',
} as const

function CharacterEditorDemo({ id }: { id: string }) {
  const cast = wizardStore.useWizard((s) => s.state.cast)
  const leadEntityId = wizardStore.useWizard((s) => s.state.leadEntityId)
  const row = cast.find((r): r is WizardCharacterDraft => r.id === id && r.kind === 'character')
  if (!row) return null
  return (
    <CharacterEditor
      row={row}
      invalid={invalidCastRowIds(cast).includes(id)}
      cast={cast}
      leadEntityId={leadEntityId}
    />
  )
}

function LocationEditorDemo({ id }: { id: string }) {
  const cast = wizardStore.useWizard((s) => s.state.cast)
  const row = cast.find((r): r is WizardLocationDraft => r.id === id && r.kind === 'location')
  if (!row) return null
  return (
    <LocationEditor
      row={row}
      invalid={invalidCastRowIds(cast).includes(id)}
      cast={cast}
      leadEntityId={null}
    />
  )
}

function ItemEditorDemo({ id }: { id: string }) {
  const cast = wizardStore.useWizard((s) => s.state.cast)
  const row = cast.find((r): r is WizardItemDraft => r.id === id && r.kind === 'item')
  if (!row) return null
  return (
    <ItemEditor
      row={row}
      invalid={invalidCastRowIds(cast).includes(id)}
      cast={cast}
      leadEntityId={null}
    />
  )
}

function FactionEditorDemo({ id }: { id: string }) {
  const cast = wizardStore.useWizard((s) => s.state.cast)
  const row = cast.find((r): r is WizardFactionDraft => r.id === id && r.kind === 'faction')
  if (!row) return null
  return (
    <FactionEditor
      row={row}
      invalid={invalidCastRowIds(cast).includes(id)}
      cast={cast}
      leadEntityId={null}
    />
  )
}

const meta: Meta = {
  title: 'Compounds/Wizard/CastEditors',
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <View className="w-[720px] gap-4 rounded-md bg-bg-base p-6">
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj

function seedCharacterWithFaction() {
  wizardStore.reset()
  seedCast([
    characterRow({ id: 'char-1', name: 'Aria Stoneheart' }),
    factionRow({ id: 'fact-1', name: 'The Iron Guild' }),
  ])
}

// Typed strings stay short and the walkthrough spans two stories: typing dominates these plays,
// and CI runs them several times slower than local against a 15 s timeout.
export const Character: Story = {
  beforeEach: seedCharacterWithFaction,
  render: () => <CharacterEditorDemo id="char-1" />,
  play: async () => {
    const nameInput = await screen.findByLabelText('Name')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Kael Ash')
    await waitFor(() => expect(castRowById('char-1').name).toBe('Kael Ash'))

    await userEvent.type(screen.getByLabelText('Description'), 'A smith.')
    await waitFor(() =>
      expect((castRowById('char-1') as WizardCharacterDraft).description).toBe('A smith.'),
    )

    // Status renders as a two-option radio segment: the group itself carries
    // `label` as its accessible name, and each option is separately named.
    expect(screen.getByRole('radiogroup', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Active' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Staged' })).not.toBeChecked()

    // Labelled "Speech"; the state key it writes is still `voice`.
    await userEvent.type(screen.getByLabelText('Speech'), 'curt, dry')
    await waitFor(() =>
      expect((castRowById('char-1') as WizardCharacterDraft).voice).toBe('curt, dry'),
    )

    await userEvent.type(screen.getByPlaceholderText(PLACEHOLDER.traits), 'stubborn{Enter}')
    await userEvent.type(screen.getByPlaceholderText(PLACEHOLDER.drives), 'find kin{Enter}')
    await waitFor(() => {
      const row = castRowById('char-1') as WizardCharacterDraft
      expect(row.traits).toEqual(['stubborn'])
      expect(row.drives).toEqual(['find kin'])
    })
    expect(screen.getByRole('textbox', { name: 'Traits' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Drives' })).toBeInTheDocument()
  },
}

export const CharacterVisualAndMoreOptions: Story = {
  beforeEach: seedCharacterWithFaction,
  render: () => <CharacterEditorDemo id="char-1" />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Visual' }))
    await userEvent.type(await screen.findByLabelText('Physique'), 'Tall, lean')
    await userEvent.type(screen.getByLabelText('Distinguishing'), 'A burn scar')
    await waitFor(() => {
      const row = castRowById('char-1') as WizardCharacterDraft
      expect(row.visual.physique).toBe('Tall, lean')
      expect(row.visual.distinguishing).toBe('A burn scar')
    })

    // More options — Tags + the faction picker.
    await userEvent.click(screen.getByRole('button', { name: 'More options' }))
    await userEvent.type(await screen.findByPlaceholderText(PLACEHOLDER.tags), 'smith{Enter}')
    await waitFor(() =>
      expect((castRowById('char-1') as WizardCharacterDraft).tags).toEqual(['smith']),
    )
    expect(screen.getByRole('textbox', { name: 'Tags' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: 'The Iron Guild' }))
    await waitFor(() =>
      expect((castRowById('char-1') as WizardCharacterDraft).factionId).toBe('fact-1'),
    )
    await userEvent.click(screen.getByRole('radio', { name: 'Unaffiliated' }))
    await waitFor(() =>
      expect((castRowById('char-1') as WizardCharacterDraft).factionId).toBeNull(),
    )

    // Set as lead — visible because this active row isn't the lead yet.
    await userEvent.click(screen.getByRole('button', { name: 'Set as lead' }))
    await waitFor(() => expect(wizardStore.getWizard().state.leadEntityId).toBe('char-1'))
  },
}

export const CharacterHasNoFactionsYetShowsEmptyState: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedCast([characterRow({ id: 'char-1', name: 'Aria Stoneheart' })])
  },
  render: () => <CharacterEditorDemo id="char-1" />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'More options' }))
    expect(await screen.findByText('(no factions yet — add one with + Add)')).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Unaffiliated' })).not.toBeInTheDocument()
  },
}

export const CharacterIsLeadHidesSetAsLead: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedCast([characterRow({ id: 'char-1', name: 'Aria Stoneheart' })], 'char-1')
  },
  render: () => <CharacterEditorDemo id="char-1" />,
  play: async () => {
    await screen.findByLabelText('Name')
    expect(screen.queryByRole('button', { name: 'Set as lead' })).not.toBeInTheDocument()
  },
}

export const StagedCharacterHidesSetAsLead: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedCast([characterRow({ id: 'char-1', name: 'Gandalf', status: 'staged' })])
  },
  render: () => <CharacterEditorDemo id="char-1" />,
  play: async () => {
    await screen.findByLabelText('Name')
    expect(screen.getByRole('radio', { name: 'Staged' })).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Set as lead' })).not.toBeInTheDocument()
  },
}

export const TogglingLeadToStagedCascadesAndToasts: Story = {
  beforeEach: () => {
    wizardStore.reset()
    toastStore.__reset()
    seedCast([characterRow({ id: 'char-1', name: 'Aria Stoneheart' })], 'char-1')
  },
  render: () => <CharacterEditorDemo id="char-1" />,
  play: async () => {
    let toasts: ToastItem[] = []
    const unsubscribe = toastStore.subscribe((items) => {
      toasts = items
    })

    await userEvent.click(await screen.findByRole('radio', { name: 'Staged' }))

    await waitFor(() => expect(wizardStore.getWizard().state.leadEntityId).toBeNull())
    await waitFor(() =>
      expect(
        toasts.some((item) => item.message === "Lead unset — staged characters can't be lead."),
      ).toBe(true),
    )
    expect(screen.queryByRole('button', { name: 'Set as lead' })).not.toBeInTheDocument()

    unsubscribe()
  },
}

export const ReassigningLeadToAnotherCharacterIsSilent: Story = {
  beforeEach: () => {
    wizardStore.reset()
    toastStore.__reset()
    seedCast(
      [
        characterRow({ id: 'char-a', name: 'Aria Stoneheart' }),
        characterRow({ id: 'char-b', name: 'Old Jorin' }),
      ],
      'char-a',
    )
  },
  // Renders the NON-lead row's editor — canSetLead only ever shows the
  // button on a row that isn't already the lead.
  render: () => <CharacterEditorDemo id="char-b" />,
  play: async () => {
    let toasts: ToastItem[] = []
    const unsubscribe = toastStore.subscribe((items) => {
      toasts = items
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Set as lead' }))

    await waitFor(() => expect(wizardStore.getWizard().state.leadEntityId).toBe('char-b'))
    // The decision this task makes: reassignment demotes the incumbent lead
    // with no toast — only the two lead-UNSET paths (staged, removed) toast.
    expect(toasts).toHaveLength(0)

    unsubscribe()
  },
}

export const Location: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedCast([
      locationRow({ id: 'loc-1', name: 'Mornstone Keep' }),
      locationRow({ id: 'loc-2', name: 'The Sundered Vale' }),
    ])
  },
  render: () => <LocationEditorDemo id="loc-1" />,
  play: async () => {
    const nameInput = await screen.findByLabelText('Name')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Mornstone Ruins')
    await waitFor(() => expect(castRowById('loc-1').name).toBe('Mornstone Ruins'))

    await userEvent.type(
      screen.getByLabelText('Description'),
      'The fortified seat of House Aerwyn.',
    )
    await waitFor(() =>
      expect((castRowById('loc-1') as WizardLocationDraft).description).toBe(
        'The fortified seat of House Aerwyn.',
      ),
    )

    await userEvent.click(screen.getByRole('button', { name: 'More options' }))
    await userEvent.type(await screen.findByPlaceholderText(PLACEHOLDER.tags), 'fortress{Enter}')
    await waitFor(() =>
      expect((castRowById('loc-1') as WizardLocationDraft).tags).toEqual(['fortress']),
    )

    // Parent-location candidates exclude this row itself — a location can't
    // be its own parent.
    expect(screen.queryByRole('radio', { name: 'Mornstone Ruins' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'The Sundered Vale' }))
    await waitFor(() =>
      expect((castRowById('loc-1') as WizardLocationDraft).parentLocationId).toBe('loc-2'),
    )
    await userEvent.click(screen.getByRole('radio', { name: 'Top level' }))
    await waitFor(() =>
      expect((castRowById('loc-1') as WizardLocationDraft).parentLocationId).toBeNull(),
    )

    await userEvent.type(screen.getByLabelText('Condition'), 'Recently besieged')
    await waitFor(() =>
      expect((castRowById('loc-1') as WizardLocationDraft).condition).toBe('Recently besieged'),
    )
  },
}

const parentOf = (id: string) => castRowById(id) as WizardLocationDraft

/** Segmented picker: Unknown is selected until Top level is picked; the control keeps its shape. */
async function expectSegmentUnknownThenTopLevel(opts: { clearedAsk: boolean }) {
  // A group whose value flips between undefined and a pick warns "controlled"/"uncontrolled".
  const warn = spyOn(console, 'warn')
  const error = spyOn(console, 'error')
  try {
    await userEvent.click(await screen.findByRole('button', { name: 'More options' }))
    const unknown = await screen.findByRole('radio', { name: 'Unknown' })
    const topLevel = screen.getByRole('radio', { name: 'Top level' })
    await expect(unknown).toHaveAttribute('aria-checked', 'true')
    await expect(topLevel).toHaveAttribute('aria-checked', 'false')

    // Unknown is the current value, so choosing it changes nothing.
    await userEvent.click(unknown)
    expect(parentOf('loc-1')).toMatchObject({ parentLocationId: null })
    expect(
      parentOf('loc-1').parentUnknown || parentOf('loc-1').unresolvedParentLocationName,
    ).toBeTruthy()

    await userEvent.click(topLevel)
    await waitFor(() => expect(screen.queryByRole('radio', { name: 'Unknown' })).toBeNull())
    expect(parentOf('loc-1')).toMatchObject({
      parentLocationId: null,
      parentUnknown: false,
      ...(opts.clearedAsk ? { unresolvedParentLocationName: '' } : {}),
    })
    await expect(screen.getByRole('radio', { name: 'Top level' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.queryByRole('button', { name: 'Parent location' })).toBeNull()
    const text = (call: unknown[]) => String(call[0])
    expect(warn.mock.calls.map(text).filter((m) => /controlled/.test(m))).toEqual([])
    expect(error.mock.calls.map(text).filter((m) => /controlled/.test(m))).toEqual([])
  } finally {
    warn.mockRestore()
    error.mockRestore()
  }
}

/** An import's unknown parent reads as the selected Unknown option; picking Top level drops it. */
export const LocationUnknownParentPicksTopLevel: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedCast([
      locationRow({ id: 'loc-1', name: 'Lower', parentUnknown: true }),
      locationRow({ id: 'loc-2', name: 'Upper' }),
    ])
  },
  render: () => <LocationEditorDemo id="loc-1" />,
  play: () => expectSegmentUnknownThenTopLevel({ clearedAsk: false }),
}

/** An import's unmatched parent name reads Unknown too; picking Top level clears the ask. */
export const LocationUnresolvedParentPicksTopLevel: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedCast([
      locationRow({ id: 'loc-1', name: 'Lower', unresolvedParentLocationName: 'Mornstone Keep' }),
      locationRow({ id: 'loc-2', name: 'Upper' }),
    ])
  },
  render: () => <LocationEditorDemo id="loc-1" />,
  play: () => expectSegmentUnknownThenTopLevel({ clearedAsk: true }),
}

const optionNamed = (name: string) => screen.findByRole('option', { name })

/** Dropdown picker: Unknown is selected until a parent is picked; the control stays controlled. */
export const LocationUnknownParentDropdown: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedCast([
      locationRow({ id: 'loc-1', name: 'Lower', parentUnknown: true }),
      locationRow({ id: 'loc-2', name: 'Upper' }),
      locationRow({ id: 'loc-3', name: 'Middle' }),
      locationRow({ id: 'loc-4', name: 'Outer' }),
    ])
  },
  render: () => <LocationEditorDemo id="loc-1" />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'More options' }))
    const trigger = await screen.findByRole('button', { name: 'Parent location' })
    await expect(trigger).toHaveTextContent('Unknown')

    await userEvent.click(trigger)
    await expect(await optionNamed('Unknown')).toBeInTheDocument()
    await userEvent.click(await optionNamed('Upper'))
    await waitFor(() => expect(parentOf('loc-1')).toMatchObject({ parentLocationId: 'loc-2' }))
    expect(parentOf('loc-1').parentUnknown).toBe(false)
    await waitFor(() => expect(trigger).toHaveTextContent('Upper'))

    // The pick removed Unknown from the list, and the control is still a dropdown.
    await userEvent.click(trigger)
    await expect(await optionNamed('Top level')).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Unknown' })).toBeNull()
    await userEvent.keyboard('{Escape}')

    // The picked parent leaves the cast: the row is unknown again and the control still controlled.
    wizardStore.removeCast('loc-2')
    await waitFor(() => expect(trigger).toHaveTextContent('Unknown'))
    expect(parentOf('loc-1')).toMatchObject({ parentLocationId: null, parentUnknown: true })
  },
}

/** Two other places and Unknown make a dropdown; dropping Unknown must not flip it to a segment. */
export const LocationUnknownParentKeepsItsShape: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedCast([
      locationRow({ id: 'loc-1', name: 'Lower', parentUnknown: true }),
      locationRow({ id: 'loc-2', name: 'Upper' }),
      locationRow({ id: 'loc-3', name: 'Middle' }),
    ])
  },
  render: () => <LocationEditorDemo id="loc-1" />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'More options' }))
    const trigger = await screen.findByRole('button', { name: 'Parent location' })
    expect(screen.queryByRole('radio', { name: 'Top level' })).toBeNull()

    await userEvent.click(trigger)
    await userEvent.click(await optionNamed('Top level'))
    await waitFor(() => expect(parentOf('loc-1').parentUnknown).toBe(false))
    await waitFor(() => expect(trigger).toHaveTextContent('Top level'))
    expect(screen.queryByRole('radio', { name: 'Top level' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Parent location' })).toBe(trigger)
  },
}

/** A row that is never unknown keeps Select's density rule: two other places stay a segment. */
export const LocationNeverUnknownStaysSegment: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedCast([
      locationRow({ id: 'loc-1', name: 'Lower' }),
      locationRow({ id: 'loc-2', name: 'Upper' }),
      locationRow({ id: 'loc-3', name: 'Middle' }),
    ])
  },
  render: () => <LocationEditorDemo id="loc-1" />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'More options' }))
    await expect(await screen.findByRole('radio', { name: 'Top level' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Parent location' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Unknown' })).toBeNull()
  },
}

/** Going unknown mid-session reserves the Unknown slot, so the dropdown never becomes a segment. */
export const LocationGoesUnknownKeepsItsShape: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedCast([
      locationRow({ id: 'loc-1', name: 'Lower', parentLocationId: 'loc-2' }),
      locationRow({ id: 'loc-2', name: 'Upper' }),
      locationRow({ id: 'loc-3', name: 'Middle' }),
      locationRow({ id: 'loc-4', name: 'Outer' }),
    ])
  },
  render: () => <LocationEditorDemo id="loc-1" />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'More options' }))
    const trigger = await screen.findByRole('button', { name: 'Parent location' })
    await expect(trigger).toHaveTextContent('Upper')

    wizardStore.removeCast('loc-2')
    await waitFor(() => expect(trigger).toHaveTextContent('Unknown'))

    await userEvent.click(trigger)
    await userEvent.click(await optionNamed('Middle'))
    await waitFor(() => expect(parentOf('loc-1')).toMatchObject({ parentLocationId: 'loc-3' }))
    await waitFor(() => expect(trigger).toHaveTextContent('Middle'))
    expect(screen.queryByRole('radio', { name: 'Top level' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Parent location' })).toBe(trigger)
  },
}

export const LocationHasNoOtherLocationsYetShowsEmptyState: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedCast([locationRow({ id: 'loc-1', name: 'Mornstone Keep' })])
  },
  render: () => <LocationEditorDemo id="loc-1" />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'More options' }))
    expect(await screen.findByText('(no locations yet — add one with + Add)')).toBeInTheDocument()
  },
}

/** No other place: Unknown and Top level still show; once placed, there is nothing to choose. */
async function expectUnknownThenTopLevelWithNoOtherPlaces(opts: { clearedAsk: boolean }) {
  await userEvent.click(await screen.findByRole('button', { name: 'More options' }))
  await expect(await screen.findByRole('radio', { name: 'Unknown' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  expect(screen.queryByText('(no locations yet — add one with + Add)')).toBeNull()

  await userEvent.click(screen.getByRole('radio', { name: 'Top level' }))
  expect(parentOf('loc-1')).toMatchObject({
    parentLocationId: null,
    parentUnknown: false,
    ...(opts.clearedAsk ? { unresolvedParentLocationName: '' } : {}),
  })
  expect(await screen.findByText('(no locations yet — add one with + Add)')).toBeInTheDocument()
  expect(screen.queryByRole('radio', { name: 'Unknown' })).toBeNull()
}

export const LocationUnresolvedParentWithNoOtherLocationsPicksTopLevel: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedCast([
      locationRow({ id: 'loc-1', name: 'Lower', unresolvedParentLocationName: 'Mornstone Keep' }),
    ])
  },
  render: () => <LocationEditorDemo id="loc-1" />,
  play: () => expectUnknownThenTopLevelWithNoOtherPlaces({ clearedAsk: true }),
}

export const LocationUnknownParentWithNoOtherLocationsPicksTopLevel: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedCast([locationRow({ id: 'loc-1', name: 'Lower', parentUnknown: true })])
  },
  render: () => <LocationEditorDemo id="loc-1" />,
  play: () => expectUnknownThenTopLevelWithNoOtherPlaces({ clearedAsk: false }),
}

export const Item: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedCast([itemRow({ id: 'item-1', name: 'Ashfall Blade' })])
  },
  render: () => <ItemEditorDemo id="item-1" />,
  play: async () => {
    const nameInput = await screen.findByLabelText('Name')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Ashfall Longsword')
    await waitFor(() => expect(castRowById('item-1').name).toBe('Ashfall Longsword'))

    await userEvent.type(screen.getByLabelText('Description'), 'Forged from meteoric iron.')
    await waitFor(() =>
      expect((castRowById('item-1') as WizardItemDraft).description).toBe(
        'Forged from meteoric iron.',
      ),
    )

    await userEvent.click(screen.getByRole('button', { name: 'More options' }))
    await userEvent.type(await screen.findByPlaceholderText(PLACEHOLDER.tags), 'weapon{Enter}')
    await waitFor(() => expect((castRowById('item-1') as WizardItemDraft).tags).toEqual(['weapon']))

    await userEvent.type(screen.getByLabelText('Condition'), 'Nicked but sharp')
    await waitFor(() =>
      expect((castRowById('item-1') as WizardItemDraft).condition).toBe('Nicked but sharp'),
    )
  },
}

export const Faction: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedCast([factionRow({ id: 'fact-1', name: 'The Iron Guild' })])
  },
  render: () => <FactionEditorDemo id="fact-1" />,
  play: async () => {
    const nameInput = await screen.findByLabelText('Name')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'The Ashen Guild')
    await waitFor(() => expect(castRowById('fact-1').name).toBe('The Ashen Guild'))

    await userEvent.type(screen.getByLabelText('Description'), 'A guild of smiths and traders.')
    await waitFor(() =>
      expect((castRowById('fact-1') as WizardFactionDraft).description).toBe(
        'A guild of smiths and traders.',
      ),
    )

    await userEvent.type(
      screen.getByPlaceholderText(PLACEHOLDER.agenda),
      'control the trade routes{Enter}',
    )
    await waitFor(() =>
      expect((castRowById('fact-1') as WizardFactionDraft).agenda).toEqual([
        'control the trade routes',
      ]),
    )
    expect(screen.getByRole('textbox', { name: 'Agenda' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'More options' }))
    await userEvent.type(await screen.findByPlaceholderText(PLACEHOLDER.tags), 'guild{Enter}')
    await waitFor(() =>
      expect((castRowById('fact-1') as WizardFactionDraft).tags).toEqual(['guild']),
    )
    expect(screen.getByRole('textbox', { name: 'Tags' })).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Standing'), 'Respected but feared')
    await waitFor(() =>
      expect((castRowById('fact-1') as WizardFactionDraft).standing).toBe('Respected but feared'),
    )
  },
}

export const CharacterFactionPickerRendersAsDropdownAtThreeCandidates: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedCast([
      characterRow({ id: 'char-1', name: 'Aria Stoneheart' }),
      factionRow({ id: 'fact-1', name: 'The Iron Guild' }),
      factionRow({ id: 'fact-2', name: 'The Ashfall Circle' }),
      factionRow({ id: 'fact-3', name: 'The Sunken Court' }),
    ])
  },
  render: () => <CharacterEditorDemo id="char-1" />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'More options' }))
    // 3 candidates + the null sentinel = 4 options, over segmentMax at every
    // tier (2 on phone, 3 elsewhere) — this is the branch every other
    // PickFromCast story skips by staying at 1 candidate.
    const trigger = screen.getByRole('button', { name: 'Faction' })
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('option', { name: 'The Ashfall Circle' }))
    await waitFor(() =>
      expect((castRowById('char-1') as WizardCharacterDraft).factionId).toBe('fact-2'),
    )

    // The trigger's accessible name is the static `label`, not the current
    // value, so the same query still finds it after a selection.
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('option', { name: 'Unaffiliated' }))
    await waitFor(() =>
      expect((castRowById('char-1') as WizardCharacterDraft).factionId).toBeNull(),
    )
  },
}

export const BlankNameShowsInlineErrorThatClearsOnFix: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedCast([characterRow({ id: 'char-1', name: '' })])
  },
  render: () => <CharacterEditorDemo id="char-1" />,
  play: async () => {
    const nameInput = await screen.findByLabelText('Name')
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Name is required.')).toBeInTheDocument()

    await userEvent.type(nameInput, 'Aria Stoneheart')
    await waitFor(() => expect(castRowById('char-1').name).toBe('Aria Stoneheart'))
    expect(screen.queryByText('Name is required.')).not.toBeInTheDocument()
  },
}

export const EditorRespectsInvalidPropRatherThanRecomputingLocally: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedCast([characterRow({ id: 'char-1', name: '' })])
  },
  // Renders CharacterEditor directly with invalid={false} — bypassing
  // CharacterEditorDemo's own invalidCastRowIds derivation — even though the
  // row's name IS blank, to prove the editor defers to the caller-supplied
  // `invalid` prop instead of recomputing castRowErrors itself.
  render: () => {
    const { cast } = wizardStore.getWizard().state
    return (
      <CharacterEditor
        row={cast[0] as WizardCharacterDraft}
        invalid={false}
        cast={cast}
        leadEntityId={null}
      />
    )
  },
  play: async () => {
    const nameInput = await screen.findByLabelText('Name')
    expect(nameInput).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText('Name is required.')).not.toBeInTheDocument()
  },
}

export const TraitsCapAtEightButAnExistingChipStaysRemovable: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedCast([characterRow({ id: 'char-1', name: 'Aria Stoneheart' })])
  },
  render: () => <CharacterEditorDemo id="char-1" />,
  play: async () => {
    // Captured once: the placeholder disappears as soon as the first chip lands.
    const traitsInput = screen.getByPlaceholderText(PLACEHOLDER.traits)
    for (let i = 1; i <= 9; i++) {
      await userEvent.type(traitsInput, `trait${i}{Enter}`)
    }
    await waitFor(() => {
      const row = castRowById('char-1') as WizardCharacterDraft
      expect(row.traits).toEqual([
        'trait1',
        'trait2',
        'trait3',
        'trait4',
        'trait5',
        'trait6',
        'trait7',
        'trait8',
      ])
    })

    // The soft cap only blocks new additions — an existing chip still removes
    // via its own × once the row is at cap.
    const trait1Chip = screen.getByText('trait1').parentElement!
    await userEvent.click(within(trait1Chip).getByRole('button', { name: 'Remove' }))
    await waitFor(() => {
      const row = castRowById('char-1') as WizardCharacterDraft
      expect(row.traits).toHaveLength(7)
      expect(row.traits).not.toContain('trait1')
    })
  },
}
