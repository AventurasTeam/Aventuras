import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import type { WizardLoreDraft } from '@/lib/db'
import { wizardStore } from '@/lib/stores'

import { LoreList } from './lore-list'
import { invalidLoreRowIds } from './step-world-logic'

// LoreList reads/writes the wizardStore singleton for content (add/patch/
// remove) but takes `rows` + `invalidIds` as props — mirrors step-world's
// split between store-owned content and step-level validation. Each story
// reseeds the working-state in `beforeEach` so a prior story's rows never
// leak into the next one.
function LoreListDemo() {
  const rows = wizardStore.useWizard((s) => s.state.lore)
  return <LoreList rows={rows} invalidIds={invalidLoreRowIds(rows)} />
}

function loreRow(overrides: Partial<WizardLoreDraft> & { id: string }): WizardLoreDraft {
  return {
    title: '',
    body: '',
    category: '',
    tags: [],
    injectionMode: 'auto',
    priority: 0,
    ...overrides,
  }
}

function seedLore(rows: WizardLoreDraft[]) {
  wizardStore.hydrate({ ...wizardStore.getWizard().state, lore: rows })
}

const meta: Meta<typeof LoreList> = {
  title: 'Compounds/Wizard/LoreList',
  component: LoreList,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <View className="w-[640px] gap-4 rounded-md bg-bg-base p-6">
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof LoreList>

export const Empty: Story = {
  beforeEach: () => {
    wizardStore.reset()
  },
  render: () => <LoreListDemo />,
  play: async () => {
    expect(
      await screen.findByText('No lore yet. Add an entry or let AI suggest some.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove lore entry' })).not.toBeInTheDocument()
  },
}

export const AddAppendsExpandedBlankRow: Story = {
  beforeEach: () => {
    wizardStore.reset()
  },
  render: () => <LoreListDemo />,
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Add lore' }))
    // No further click needed to reach the editor — Add lands directly expanded.
    const titleInput = await screen.findByLabelText('Title')
    expect(titleInput).toHaveValue('')
    expect(screen.getByLabelText('Body')).toHaveValue('')
    expect(screen.getByLabelText('Category')).toHaveValue('')
  },
}

export const MultiCharacterTitleKeepsFocusAndLandsAllCharacters: Story = {
  beforeEach: () => {
    wizardStore.reset()
  },
  render: () => <LoreListDemo />,
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Add lore' }))
    const titleInput = await screen.findByLabelText('Title')

    // A single-character type would pass even with the adornment-DOM-identity
    // trap live (lessons-learned/input-adornment-dom-identity.md) — only a
    // multi-character run proves the field isn't re-keying mid-type.
    await userEvent.click(titleInput)
    await userEvent.type(titleInput, 'Ancient Sunken Ruins')

    expect(titleInput).toHaveValue('Ancient Sunken Ruins')
    expect(titleInput).toHaveFocus()
  },
}

export const EditingTitleUpdatesCompactRowAfterCollapse: Story = {
  beforeEach: () => {
    wizardStore.reset()
  },
  render: () => <LoreListDemo />,
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Add lore' }))
    const titleInput = await screen.findByLabelText('Title')
    await userEvent.type(titleInput, 'Sunken Archive')
    await userEvent.type(screen.getByLabelText('Body'), 'A flooded library beneath the temple.')

    await userEvent.click(screen.getByRole('button', { name: 'Collapse lore entry' }))

    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
    expect(screen.getByText('Sunken Archive')).toBeInTheDocument()
  },
}

export const MoreOptionsFieldsRoundTripThroughCollapse: Story = {
  beforeEach: () => {
    wizardStore.reset()
  },
  render: () => <LoreListDemo />,
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Add lore' }))
    await userEvent.type(await screen.findByLabelText('Title'), 'Sealed Wells')
    await userEvent.type(screen.getByLabelText('Body'), 'Magic flows from sealed wells.')

    await userEvent.click(screen.getByRole('button', { name: 'More options' }))

    // The Tags field has no aria-label of its own (TagInput doesn't expose one —
    // its inner TextInput only forwards a fixed prop set), so it's picked out by
    // its fixed position after Title / Body / Category in render order.
    const textboxes = screen.getAllByRole('textbox')
    const tagsInput = textboxes[3]!
    await userEvent.type(tagsInput, 'ancient{Enter}')
    await userEvent.type(tagsInput, 'ruins{Enter}')
    await waitFor(() => expect(screen.getByText('ancient')).toBeInTheDocument())
    expect(screen.getByText('ruins')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: 'Always' }))
    expect(screen.getByRole('radio', { name: 'Always' })).toBeChecked()

    const increment = screen.getByRole('button', { name: 'Increase priority' })
    for (let i = 0; i < 5; i++) {
      await userEvent.click(increment)
    }
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Collapse lore entry' }))
    expect(screen.queryByText('ancient')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Expand lore entry' }))
    await userEvent.click(screen.getByRole('button', { name: 'More options' }))

    expect(await screen.findByText('ancient')).toBeInTheDocument()
    expect(screen.getByText('ruins')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Always' })).toBeChecked()
    expect(screen.getByText('5')).toBeInTheDocument()
  },
}

export const EmptyBodyShowsInlineErrorThatClearsOnFix: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedLore([loreRow({ id: 'row-1', title: 'Something', body: '' })])
  },
  render: () => <LoreListDemo />,
  play: async () => {
    expect(await screen.findByText('Body is required.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Expand lore entry' }))
    const bodyInput = await screen.findByLabelText('Body')
    expect(bodyInput).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Body is required.')).toBeInTheDocument()

    await userEvent.type(bodyInput, 'Now it has content.')
    expect(bodyInput).toHaveValue('Now it has content.')
    await waitFor(() => expect(screen.queryByText('Body is required.')).not.toBeInTheDocument())
  },
}

export const EditorRespectsInvalidIdsRatherThanRecomputingLocally: Story = {
  // No wizardStore involvement — `invalidIds` deliberately disagrees with what
  // a local blank() check on the row would say, proving the editor defers to
  // the prop (the single source of truth) instead of re-deriving its own
  // verdict. A real caller would only reach this by gating invalidIds behind
  // some step-level rule (e.g. "only after Next is pressed") that the row
  // data alone can't reproduce.
  render: () => <LoreList rows={[loreRow({ id: 'row-1', title: '', body: '' })]} invalidIds={[]} />,
  play: async () => {
    expect(screen.queryByText('Title is required.')).not.toBeInTheDocument()
    expect(screen.queryByText('Body is required.')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Expand lore entry' }))
    const titleInput = await screen.findByLabelText('Title')
    const bodyInput = screen.getByLabelText('Body')

    expect(titleInput).not.toHaveAttribute('aria-invalid', 'true')
    expect(bodyInput).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText('Title is required.')).not.toBeInTheDocument()
    expect(screen.queryByText('Body is required.')).not.toBeInTheDocument()
  },
}

export const RemoveDeletesTheRightRowAmongThree: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedLore([
      loreRow({ id: 'row-a', title: 'Row A', body: 'Body A' }),
      loreRow({ id: 'row-b', title: 'Row B', body: 'Body B' }),
      loreRow({ id: 'row-c', title: 'Row C', body: 'Body C' }),
    ])
  },
  render: () => <LoreListDemo />,
  play: async () => {
    expect(await screen.findByText('Row A')).toBeInTheDocument()
    expect(screen.getByText('Row B')).toBeInTheDocument()
    expect(screen.getByText('Row C')).toBeInTheDocument()

    const removeButtons = screen.getAllByRole('button', { name: 'Remove lore entry' })
    expect(removeButtons).toHaveLength(3)
    await userEvent.click(removeButtons[1]!) // Row B, the middle row.

    await waitFor(() => expect(screen.queryByText('Row B')).not.toBeInTheDocument())
    expect(screen.getByText('Row A')).toBeInTheDocument()
    expect(screen.getByText('Row C')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Remove lore entry' })).toHaveLength(2)
  },
}

export const HydratingARecycledIdAfterDeleteDoesNotLeakExpansion: Story = {
  beforeEach: () => {
    wizardStore.reset()
    seedLore([
      loreRow({ id: 'dup-id', title: 'Row A', body: 'Body A' }),
      loreRow({ id: 'keep-id', title: 'Row B', body: 'Body B' }),
    ])
  },
  render: () => <LoreListDemo />,
  play: async () => {
    // Expand row A (id "dup-id").
    const expandButtons = await screen.findAllByRole('button', { name: 'Expand lore entry' })
    await userEvent.click(expandButtons[0]!)
    expect(await screen.findByLabelText('Title')).toHaveValue('Row A')

    // Delete it — the remove control is a header sibling, present whether the
    // row is expanded or not, so index 0 is still row A's.
    const removeButtons = screen.getAllByRole('button', { name: 'Remove lore entry' })
    await userEvent.click(removeButtons[0]!)
    await waitFor(() => expect(screen.queryByText('Row A')).not.toBeInTheDocument())

    // A real "Add lore" click always mints a fresh crypto.randomUUID(), which
    // can never collide with "dup-id" — so the only way to reproduce the
    // resurrected-id shape no-harmless-id-leaks.md describes (a hydrated
    // resume reintroducing a previously-seen id) is to hydrate it directly,
    // the same seam a draft resume goes through in production.
    seedLore([
      loreRow({ id: 'keep-id', title: 'Row B', body: 'Body B' }),
      loreRow({ id: 'dup-id', title: 'Row C', body: 'Body C' }),
    ])

    // Row C (the id-recycled row) must render collapsed, not pre-expanded
    // from the leaked "dup-id" entry left over from row A.
    expect(await screen.findByText('Row C')).toBeInTheDocument()
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Expand lore entry' })).toHaveLength(2)
  },
}
