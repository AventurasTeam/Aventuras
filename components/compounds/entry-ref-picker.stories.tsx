import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import type { EntryRef } from '@/lib/entry-refs'
import { t } from '@/lib/i18n'

import { EntryRefPicker, EntryRefText } from './entry-ref-picker'

const ENTRIES: EntryRef[] = Array.from({ length: 40 }, (_, i) => {
  const position = 40 - i
  return {
    id: `e_${position}`,
    position,
    kind: position % 2 === 0 ? 'user_action' : 'ai_reply',
    chapterId: position <= 30 ? 'chap_1' : null,
    excerpt:
      position === 12
        ? 'The broker is waiting where the alley narrows.'
        : `Entry ${position} — the lantern gutters as you press deeper.`,
  }
})

const LONG_EXCERPT =
  'The broker counts the coin twice before speaking, and even then the words come slow, weighed against the risk of saying too much in a place where every wall has ears.'
const LONG_EXCERPT_ENTRIES: EntryRef[] = [
  { id: 'e_long', position: 1, kind: 'ai_reply', chapterId: null, excerpt: LONG_EXCERPT },
]

function Harness(props: { initial: string | null; entries?: EntryRef[]; disabled?: boolean }) {
  const [value, setValue] = useState<string | null>(props.initial)
  return (
    <View style={{ width: 420 }} className="gap-2 p-4">
      <EntryRefPicker
        value={value}
        onChange={setValue}
        entries={props.entries ?? ENTRIES}
        label="Occurred at"
        placeholder="Pick the entry it happened at"
        disabled={props.disabled}
        disabledReason={props.disabled ? 'Generation is in flight. Cancel to edit.' : undefined}
        testID="picker"
      />
    </View>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Compounds/EntryRefPicker',
  component: Harness,
  parameters: { layout: 'padded' },
  args: { initial: null },
}
export default meta
type Story = StoryObj<typeof Harness>

export const Empty: Story = {
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    await userEvent.type(await screen.findByRole('combobox'), '#12')
    await userEvent.click(await screen.findByRole('option', { name: /entry #12/ }))
    await waitFor(async () => {
      await expect(screen.getByTestId('picker')).toHaveTextContent('entry #12')
    })
    await expect(screen.getByTestId('picker')).toHaveTextContent('The broker is waiting')
  },
}

export const SearchByExcerpt: Story = {
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    const search = await screen.findByRole('combobox')
    await userEvent.type(search, 'alley narrows')
    await waitFor(async () => {
      await expect(screen.getAllByRole('option')).toHaveLength(1)
    })
    await expect(screen.getByRole('option', { name: /entry #12/ })).toBeVisible()

    await userEvent.clear(search)
    await userEvent.type(search, 'zzz-no-such-entry')
    await waitFor(async () => {
      await expect(screen.getByText(t('picker.entryNoResults'))).toBeInTheDocument()
    })
  },
}

export const Selected: Story = { args: { initial: 'e_40' } }

export const NoEntriesAvailable: Story = {
  args: { entries: [] },
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    await expect(await screen.findByText(t('picker.entryNone'))).toBeInTheDocument()
  },
}

export const Dangling: Story = {
  args: { initial: 'e_gone' },
  play: async () => {
    const trigger = screen.getByTestId('picker')
    await expect(trigger).toHaveTextContent(t('entryRefDangling'))
    // The dangling state still folds into the accessible name — a screen reader
    // hears that a value is set even though nothing resolvable renders.
    await expect(trigger).toHaveAccessibleName(
      t('picker.fieldLabel', { label: 'Occurred at', value: t('entryRefDangling') }),
    )
    const clearButton = screen.getByRole('button', { name: t('picker.clear') })
    await expect(clearButton).toBeEnabled()
    await userEvent.click(clearButton)
    await waitFor(async () => {
      await expect(trigger).toHaveTextContent('Pick the entry it happened at')
    })
    await waitFor(async () => {
      await expect(trigger).toHaveFocus()
    })
  },
}

export const Disabled: Story = {
  args: { initial: null, disabled: true },
  play: async () => {
    const trigger = screen.getByTestId('picker')
    await expect(trigger).toBeDisabled()
    await expect(screen.getByTitle('Generation is in flight. Cancel to edit.')).toBeInTheDocument()
    await userEvent.click(trigger, { pointerEventsCheck: 0 })
    await expect(screen.queryByRole('dialog', { name: 'Occurred at' })).not.toBeInTheDocument()
  },
}

// F2 flips `disabled` from a capture-phase document listener — not a button click, which
// Radix's own outside-click dismissal would also close the popover for, making the
// assertion pass regardless of whether EntryRefPicker's own disabled-while-open effect runs.
function DisableToggleHarness() {
  const [disabled, setDisabled] = useState(false)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') setDisabled((prev) => !prev)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])
  return (
    <View style={{ width: 420 }} className="p-4">
      <EntryRefPicker
        value={null}
        onChange={() => undefined}
        entries={ENTRIES}
        label="Occurred at"
        placeholder="Pick the entry it happened at"
        disabled={disabled}
        disabledReason={disabled ? 'Generation is in flight. Cancel to edit.' : undefined}
        testID="picker"
      />
    </View>
  )
}

export const ClosesWhenDisabled: Story = {
  render: () => <DisableToggleHarness />,
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    await screen.findByRole('dialog', { name: 'Occurred at' })

    await userEvent.keyboard('{F2}')
    await waitFor(async () => {
      await expect(screen.queryByRole('dialog', { name: 'Occurred at' })).not.toBeInTheDocument()
    })

    await userEvent.keyboard('{F2}')
    await userEvent.click(screen.getByTestId('picker'))
    await expect(await screen.findByRole('dialog', { name: 'Occurred at' })).toBeVisible()
  },
}

// The current value opens scrolled into view, not at the top of a 40-row list —
// `e_1` is the last row rendered (newest first), the farthest possible target.
export const OpensScrolledToValue: Story = {
  args: { initial: 'e_1' },
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    await waitFor(
      async () => {
        const listbox = screen.getByRole('listbox')
        const row = screen.getByRole('option', { name: /entry #1\b/ })
        const box = listbox.getBoundingClientRect()
        const rect = row.getBoundingClientRect()
        await expect(rect.top).toBeGreaterThanOrEqual(box.top)
        await expect(rect.bottom).toBeLessThanOrEqual(box.bottom)
      },
      { timeout: 5000 },
    )
  },
}

export const LongExcerptStaysWithinField: Story = {
  args: { initial: 'e_long', entries: LONG_EXCERPT_ENTRIES },
  play: async () => {
    const trigger = screen.getByTestId('picker')
    const triggerRect = trigger.getBoundingClientRect()
    const excerptText = screen.getByText(LONG_EXCERPT)
    const excerptRect = excerptText.getBoundingClientRect()
    await expect(excerptRect.right).toBeLessThanOrEqual(triggerRect.right)
    // `numberOfLines={1}` keeps it to a single line — a dropped truncation class
    // would wrap onto a second line instead of overflowing horizontally, since
    // the browser wraps at word boundaries by default.
    const lineHeight = parseFloat(getComputedStyle(excerptText).lineHeight)
    await expect(excerptRect.height).toBeLessThanOrEqual(lineHeight * 1.2)
  },
}

export const ReadOnlyText: StoryObj = {
  render: () => (
    <View className="gap-2 p-4">
      <EntryRefText entry={ENTRIES[0]!} />
      <EntryRefText entry={null} />
    </View>
  ),
}
