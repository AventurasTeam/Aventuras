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
}

function Demo({ initial = SEED, disabled, onRequestDelete }: DemoProps) {
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

let requestDeleteSpy: ReturnType<typeof fn>

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
  render: () => {
    const spy = fn()
    requestDeleteSpy = spy
    return <Demo onRequestDelete={spy} />
  },
  play: async () => {
    const target = SEED[0]!
    const deleteButton = screen.getByTestId(`suggestion-category-delete-${target.id}`)
    await userEvent.click(deleteButton)
    await waitFor(() => expect(requestDeleteSpy).toHaveBeenCalledWith(target.id))
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
