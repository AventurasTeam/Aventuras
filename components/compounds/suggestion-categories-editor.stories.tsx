import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { SuggestionCategoriesEditor, type SuggestionCategory } from './suggestion-categories-editor'
import type { ColorValue } from '../ui/color-picker'

const SWATCHES: ColorValue[] = [
  '#ef4444',
  '#f97316',
  '#facc15',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
]

const FALLBACK: ColorValue = '#9ca3af'

const SEED: SuggestionCategory[] = [
  {
    id: 'cat-action',
    label: 'Action',
    color: '#ef4444',
    promptHint: 'Move the story forward with a decisive action — fight, flee, intervene.',
    enabled: true,
  },
  {
    id: 'cat-dialogue',
    label: 'Dialogue',
    color: '#3b82f6',
    promptHint: 'Suggest something for the protagonist to say next.',
    enabled: true,
  },
  {
    id: 'cat-introspect',
    label: 'Introspect',
    color: '#8b5cf6',
    promptHint: '',
    enabled: false,
  },
  {
    id: 'cat-observe',
    label: 'Observe',
    color: '#22c55e',
    promptHint: 'Suggest something the protagonist could examine more closely.',
    enabled: true,
  },
]

type DemoProps = {
  initial?: SuggestionCategory[]
  disabled?: boolean
  onRequestDelete?: (id: string) => void
  minRows?: number
}

function Demo({ initial = SEED, disabled, onRequestDelete, minRows }: DemoProps) {
  const [categories, setCategories] = useState<SuggestionCategory[]>(initial)
  return (
    <View className="w-full flex-col gap-3" style={{ minHeight: 480 }}>
      <SuggestionCategoriesEditor
        categories={categories}
        onChange={setCategories}
        swatches={SWATCHES}
        fallbackColor={FALLBACK}
        disabled={disabled}
        onRequestDelete={onRequestDelete}
        minRows={minRows}
      />
    </View>
  )
}

const meta: Meta<typeof SuggestionCategoriesEditor> = {
  title: 'Compounds/SuggestionCategoriesEditor',
  component: SuggestionCategoriesEditor,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <View style={{ width: 720 }}>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof SuggestionCategoriesEditor>

export const Default: Story = { render: () => <Demo /> }

// Validation surfaces: duplicate label (Dialogue x2 + case variant), empty
// label. Inline error appears below the affected row's label input; row
// summary on phone tints danger.
export const ValidationErrors: Story = {
  render: () => (
    <Demo
      initial={[
        ...SEED.slice(0, 2),
        // Duplicate of Dialogue (case-insensitive).
        { ...SEED[1]!, id: 'cat-dialogue-dup', label: 'DIALOGUE' },
        // Empty label.
        { id: 'cat-empty', label: '', color: null, promptHint: '', enabled: true },
      ]}
    />
  ),
}

export const SingleCategory: Story = {
  render: () => <Demo initial={[SEED[0]!]} />,
}

// The floor is the host's rule, so with the default `minRows` the last row is
// still deletable — App Settings treats an empty palette as "not configured".
export const LastRowDeletableByDefault: Story = {
  args: { onRequestDelete: fn() },
  render: (args) => <Demo initial={[SEED[0]!]} onRequestDelete={args.onRequestDelete} />,
  play: async ({ args }) => {
    const target = SEED[0]!
    await userEvent.click(screen.getByTestId(`suggestion-category-delete-${target.id}`))
    await waitFor(() => expect(args.onRequestDelete).toHaveBeenCalledWith(target.id))
  },
}

// Story Settings passes minRows={1}: an empty palette stops emission entirely,
// so the delete is refused at the floor rather than saved and repaired later.
export const MinRowsBlocksLastDelete: Story = {
  args: { onRequestDelete: fn() },
  render: (args) => (
    <Demo initial={[SEED[0]!]} minRows={1} onRequestDelete={args.onRequestDelete} />
  ),
  // Asserts the control is genuinely unclickable, not that its handler no-ops:
  // a gate that only dropped the press would still pass a spy-never-fired check
  // while leaving the button reachable by keyboard.
  play: async () => {
    const target = SEED[0]!
    const deleteButton = screen.getByTestId(`suggestion-category-delete-${target.id}`)
    expect(deleteButton).toBeDisabled()
    expect(deleteButton).toHaveStyle({ pointerEvents: 'none' })
    expect(screen.getByTestId(`suggestion-category-label-${target.id}`)).toBeInTheDocument()
  },
}

// The floor gates only the last row — deleting down *to* it must still work, or
// a palette could never be trimmed.
export const MinRowsAllowsDeleteAboveFloor: Story = {
  args: { onRequestDelete: fn() },
  render: (args) => (
    <Demo initial={SEED.slice(0, 2)} minRows={1} onRequestDelete={args.onRequestDelete} />
  ),
  play: async ({ args }) => {
    const target = SEED[1]!
    await userEvent.click(screen.getByTestId(`suggestion-category-delete-${target.id}`))
    await waitFor(() => expect(args.onRequestDelete).toHaveBeenCalledWith(target.id))
  },
}

export const Empty: Story = {
  render: () => <Demo initial={[]} />,
}

// Disabled when the master `suggestionsEnabled` toggle is off. Whole editor
// dims; rows stay editable shape but inputs are non-editable.
export const Disabled: Story = {
  render: () => <Demo disabled />,
}

// Stress test for the desktop sortable list — 10 categories so the user can
// verify drag-and-drop reordering doesn't choke under longer lists.
export const ManyCategories: Story = {
  render: () => (
    <Demo
      initial={Array.from({ length: 10 }, (_, i) => ({
        id: `cat-${i}`,
        label: `Category ${i + 1}`,
        color: SWATCHES[i % SWATCHES.length] ?? null,
        promptHint: `Hint text for category ${i + 1}.`,
        enabled: i % 3 !== 0,
      }))}
    />
  ),
}

// onRequestDelete routes the delete press to the host instead of removing the
// row — the host owns the confirmation dialog. The row must survive the click;
// a story that only checks the spy fired would still pass if the compound
// removed the row itself.
export const HostOwnedDeleteKeepsRow: Story = {
  args: { onRequestDelete: fn() },
  render: (args) => <Demo onRequestDelete={args.onRequestDelete} />,
  play: async ({ args }) => {
    const target = SEED[0]!
    const deleteButton = screen.getByTestId(`suggestion-category-delete-${target.id}`)
    await userEvent.click(deleteButton)
    await waitFor(() => expect(args.onRequestDelete).toHaveBeenCalledWith(target.id))
    expect(screen.getByTestId(`suggestion-category-label-${target.id}`)).toBeInTheDocument()
  },
}

// Without onRequestDelete, delete falls back to removing the row through onChange.
export const DeleteWithoutHostRemovesRow: Story = {
  render: () => <Demo />,
  play: async () => {
    const target = SEED[0]!
    const deleteButton = screen.getByTestId(`suggestion-category-delete-${target.id}`)
    await userEvent.click(deleteButton)
    await waitFor(() =>
      expect(
        screen.queryByTestId(`suggestion-category-label-${target.id}`),
      ).not.toBeInTheDocument(),
    )
  },
}
