import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import type { Lore } from '@/lib/db'

import { LoreRow } from './lore-row'

const meta: Meta<typeof LoreRow> = {
  title: 'Compounds/Entity/LoreRow',
  component: LoreRow,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <View className="rounded-md bg-bg-base" style={{ width: 340 }}>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof LoreRow>

const VEIL: Lore = {
  id: 'lore_veil',
  branchId: 'br_1',
  title: 'The Veil',
  body: 'A membrane between the city and what it was built to contain; it thins where memory is thickest.',
  category: 'cosmology',
  tags: ['veil', 'magic'],
  keywords: [],
  injectionMode: 'always',
  priority: 10,
  embeddingStale: 1,
  createdAt: 1,
  updatedAt: 1,
}

const onPressDefault = fn()

export const Default: Story = {
  args: { row: VEIL, selected: false, onPress: onPressDefault, signals: {} },
  play: async () => {
    const row = screen.getByRole('button', { name: 'The Veil' })
    expect(row).toBeInTheDocument()
    expect(screen.getByText('cosmology')).toBeInTheDocument()
    expect(
      screen.getByText(
        'A membrane between the city and what it was built to contain; it thins where memory is thickest.',
      ),
    ).toBeInTheDocument()
    await userEvent.click(row)
    await waitFor(() => expect(onPressDefault).toHaveBeenCalled())
  },
}

export const SelectedFresh: Story = {
  args: {
    row: VEIL,
    selected: true,
    onPress: fn(),
    signals: { recentlyClassified: 'fresh' },
  },
  play: async () => {
    const row = screen.getByRole('button', { name: 'The Veil' })
    expect(row).toHaveAttribute('aria-selected', 'true')
    expect(row).toHaveClass('bg-recently-classified-bg')
  },
}

/** No category set — the tag slot must not render an empty pill. */
export const NoCategory: Story = {
  args: {
    row: { ...VEIL, id: 'lore_no_category', category: '' },
    selected: false,
    onPress: fn(),
    signals: {},
  },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('.rounded-full')).toBeNull()
  },
}

/** A category that's only whitespace is functionally empty — same as NoCategory. */
export const WhitespaceOnlyCategory: Story = {
  args: {
    row: { ...VEIL, id: 'lore_whitespace_category', category: '   ' },
    selected: false,
    onPress: fn(),
    signals: {},
  },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('.rounded-full')).toBeNull()
  },
}

// Word-boundary backoff, not a hard character cut: the 120th character lands
// mid-run of the long word, so the excerpt must back off to the space before it.
const MIDWORD_BODY = `The cartographers call it the ${'a'.repeat(150)} wall.`

const VEIL_MIDWORD: Lore = { ...VEIL, id: 'lore_veil_midword', body: MIDWORD_BODY }

export const LongBodyTruncates: Story = {
  args: { row: VEIL_MIDWORD, selected: false, onPress: fn(), signals: {} },
  play: async () => {
    expect(screen.getByText('The cartographers call it the…')).toBeInTheDocument()
    expect(screen.queryByText(MIDWORD_BODY)).toBeNull()
  },
}

// 120 real-word chars end exactly on "Ta"; the 121st is the space before "Uniform" — an
// earlier space (after "Sierra") must not fool the excerpt into cutting off the last word.
const WORD_BOUNDARY_BODY =
  'Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliet Kilo Lima Mike November Oscar Papa Quebec Romeo Sierra Ta Uniform Victor Whiskey'

const VEIL_WORD_BOUNDARY: Lore = {
  ...VEIL,
  id: 'lore_veil_word_boundary',
  body: WORD_BOUNDARY_BODY,
}

export const ExactWordBoundaryCutKeepsFullWord: Story = {
  args: { row: VEIL_WORD_BOUNDARY, selected: false, onPress: fn(), signals: {} },
  play: async () => {
    expect(
      screen.getByText(
        'Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliet Kilo Lima Mike November Oscar Papa Quebec Romeo Sierra Ta…',
      ),
    ).toBeInTheDocument()
  },
}

// A 2-code-unit emoji at code-point index 119 (in an unbroken run, no spaces) — Array.from
// must keep it whole; splitting by UTF-16 code unit would sever the surrogate pair.
const EMOJI_BODY = `${'A'.repeat(119)}😀${'B'.repeat(40)}`

const VEIL_EMOJI: Lore = { ...VEIL, id: 'lore_veil_emoji', body: EMOJI_BODY }

export const EmojiAtCutBoundary: Story = {
  args: { row: VEIL_EMOJI, selected: false, onPress: fn(), signals: {} },
  play: async () => {
    expect(screen.getByText(`${'A'.repeat(119)}😀…`)).toBeInTheDocument()
  },
}

const MESSY_BODY = 'A   membrane\n\nbetween  the\tcity.'

const VEIL_MESSY: Lore = { ...VEIL, id: 'lore_veil_messy', body: MESSY_BODY }

/** Irregular whitespace (runs, newlines, tabs) collapses to single spaces. */
export const CollapsesWhitespace: Story = {
  args: { row: VEIL_MESSY, selected: false, onPress: fn(), signals: {} },
  play: async () => {
    // Disabled getByText's normalizer, or a broken collapse could pass by matching raw text.
    expect(
      screen.getByText('A membrane between the city.', { normalizer: (text) => text }),
    ).toBeInTheDocument()
  },
}

const WHITESPACE_ONLY_BODY = '   \n\t  '

const VEIL_WHITESPACE_BODY: Lore = {
  ...VEIL,
  id: 'lore_veil_whitespace_body',
  body: WHITESPACE_ONLY_BODY,
}

/** A body that's only whitespace renders no description line at all. */
export const WhitespaceOnlyBody: Story = {
  args: { row: VEIL_WHITESPACE_BODY, selected: false, onPress: fn(), signals: {} },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('.text-sm.text-fg-muted')).toBeNull()
  },
}

export const Compact: Story = {
  args: {
    row: VEIL,
    selected: false,
    onPress: fn(),
    signals: {},
    density: 'compact',
  },
  play: async () => {
    expect(screen.queryByText(/membrane/)).toBeNull()
  },
}
