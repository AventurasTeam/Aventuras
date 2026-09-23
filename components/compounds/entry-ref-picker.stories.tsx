import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
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

// `#12` prefix-matches #12 and #120…#129 — enough 3-digit entries to reproduce the
// auto-highlight bug (newest-first would put #129 first without exact-match ordering).
const MANY_ENTRIES: EntryRef[] = Array.from({ length: 200 }, (_, i) => {
  const position = 200 - i
  return {
    id: `e_${position}`,
    position,
    kind: position % 2 === 0 ? 'user_action' : 'ai_reply',
    chapterId: null,
    excerpt: `Entry ${position} — the lantern gutters as you press deeper.`,
  }
})

// Bare digits union position and excerpt matches — `e_5`'s excerpt only contains "12"
// as prose, `e_9`'s excerpt has no "12" anywhere.
const UNION_ENTRIES: EntryRef[] = [
  {
    id: 'e_12',
    position: 12,
    kind: 'ai_reply',
    chapterId: null,
    excerpt: 'The vault door creaks open.',
  },
  {
    id: 'e_5',
    position: 5,
    kind: 'user_action',
    chapterId: null,
    excerpt: 'You count all 12 coins twice.',
  },
  {
    id: 'e_9',
    position: 9,
    kind: 'ai_reply',
    chapterId: null,
    excerpt: 'Nothing relevant happens here.',
  },
]

// Small enough that every row renders unvirtualized — the exact count is assertable.
const SMALL_ENTRIES: EntryRef[] = Array.from({ length: 5 }, (_, i) => {
  const position = 5 - i
  return {
    id: `e_${position}`,
    position,
    kind: position % 2 === 0 ? 'user_action' : 'ai_reply',
    chapterId: null,
    excerpt: `Entry ${position} — the lantern gutters as you press deeper.`,
  }
})

// No entry's position equals "5" exactly — isolates the length-ordering rule from the
// exact-match rule already covered by `PositionSearchExactMatchCommitsOnEnter`.
const LENGTH_ORDER_ENTRIES: EntryRef[] = [57, 578, 5789].map((position) => ({
  id: `e_${position}`,
  position,
  kind: 'ai_reply' as const,
  chapterId: null,
  excerpt: `Entry ${position} — the lantern gutters as you press deeper.`,
}))

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
    // The resolved value folds into the accessible name too, not just the dangling one.
    await expect(screen.getByTestId('picker')).toHaveAccessibleName(
      t('picker.fieldLabel', { label: 'Occurred at', value: 'entry #12' }),
    )
  },
}

// A `#12` search over 200+ entries prefix-matches #12 and #120…#129 — newest-first
// would auto-highlight #129, and Enter would then commit the wrong entry.
export const PositionSearchExactMatchCommitsOnEnter: Story = {
  args: { entries: MANY_ENTRIES },
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    const search = await screen.findByRole('combobox')
    await userEvent.type(search, '#12')
    await screen.findByRole('option', { name: /entry #12\b/ })
    await userEvent.keyboard('{Enter}')
    await waitFor(async () => {
      // Raw textContent has no inserted whitespace between the field's adjacent elements
      // (unlike an accessible name), so a trailing digit — not `\b` — rules out #120…#129.
      await expect(screen.getByTestId('picker')).toHaveTextContent(/entry #12(?!\d)/)
    })
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

// Position matches (exact-match ordering) come first, then excerpt-only matches, newest
// first — never a match against the localized `entry #n` label itself.
export const BareDigitsUnionPositionAndExcerpt: Story = {
  args: { entries: UNION_ENTRIES },
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    const search = await screen.findByRole('combobox')
    await userEvent.type(search, '12')
    await waitFor(async () => {
      const options = screen.getAllByRole('option')
      await expect(options).toHaveLength(2)
      await expect(options[0]).toHaveAccessibleName(/entry #12(?!\d)/)
      await expect(options[1]).toHaveAccessibleName(/entry #5(?!\d)/)
    })
  },
}

// A leading `#` with inner whitespace is still position mode — `# 12` strips the space,
// matches only #12; bare digits would also union `e_5`'s excerpt-only "12".
export const HashWithInnerSpaceIsPositionOnly: Story = {
  args: { entries: UNION_ENTRIES },
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    const search = await screen.findByRole('combobox')
    await userEvent.type(search, '# 12')
    await waitFor(async () => {
      const options = screen.getAllByRole('option')
      await expect(options).toHaveLength(1)
      await expect(options[0]).toHaveAccessibleName(/entry #12(?!\d)/)
    })
  },
}

// `#` alone must not empty the list — it's position mode with no digits yet. A 5-entry
// fixture keeps every row unvirtualized so the count is exactly assertable.
export const HashAloneMatchesEverything: Story = {
  args: { entries: SMALL_ENTRIES },
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    const search = await screen.findByRole('combobox')
    await userEvent.type(search, '#')
    await waitFor(async () => {
      await expect(screen.getAllByRole('option')).toHaveLength(5)
    })
    await expect(screen.queryByText(t('picker.entryNoResults'))).not.toBeInTheDocument()
  },
}

// Isolates the "shorter position string first" ordering rule with no exact match present.
export const PositionSearchOrdersShorterMatchesFirst: Story = {
  args: { entries: LENGTH_ORDER_ENTRIES },
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    const search = await screen.findByRole('combobox')
    await userEvent.type(search, '#5')
    await waitFor(async () => {
      const options = screen.getAllByRole('option')
      await expect(options).toHaveLength(3)
      await expect(options[0]).toHaveAccessibleName(/entry #57(?!\d)/)
      await expect(options[1]).toHaveAccessibleName(/entry #578(?!\d)/)
      await expect(options[2]).toHaveAccessibleName(/entry #5789(?!\d)/)
    })
  },
}

export const ExcerptSearchIsCaseInsensitive: Story = {
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    const search = await screen.findByRole('combobox')
    await userEvent.type(search, 'BROKER')
    await waitFor(async () => {
      await expect(screen.getAllByRole('option')).toHaveLength(1)
    })
    await expect(screen.getByRole('option', { name: /entry #12/ })).toBeVisible()
  },
}

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
    // A negative check needs a settle window: asserting immediately after the click would pass
    // even if disabled-click handling were broken and the overlay's async open logic hasn't run.
    await new Promise((resolve) => setTimeout(resolve, 150))
    await expect(screen.queryByRole('dialog', { name: 'Occurred at' })).not.toBeInTheDocument()
  },
}

// F2 flips `disabled` via a capture-phase document listener, not a button click — Radix's
// outside-click dismissal would also close the popover, masking whether the disabled effect ran.
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
        await expect(row).toHaveAttribute('aria-selected', 'true')
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
    // `numberOfLines={1}` keeps it to one line — a dropped truncation class would wrap onto a
    // second line instead of overflowing horizontally (browser default: wrap at word boundaries).
    const lineHeight = parseFloat(getComputedStyle(excerptText).lineHeight)
    await expect(excerptRect.height).toBeLessThanOrEqual(lineHeight * 1.2)
  },
}

// Same single-line truncation, but inside a row of the open overlay rather than the field.
export const RowExcerptTruncates: Story = {
  args: { entries: LONG_EXCERPT_ENTRIES },
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    const row = await screen.findByRole('option')
    const excerptText = within(row).getByText(LONG_EXCERPT)
    const excerptRect = excerptText.getBoundingClientRect()
    await expect(excerptRect.right).toBeLessThanOrEqual(row.getBoundingClientRect().right)
    const lineHeight = parseFloat(getComputedStyle(excerptText).lineHeight)
    await expect(excerptRect.height).toBeLessThanOrEqual(lineHeight * 1.2)
  },
}

// gorhom keeps the phone Sheet's children mounted through its ~700ms slide-out —
// `min-h-screen` gives it real height to animate within (SOL's own stories do the same).
function PhoneHarness() {
  const [value, setValue] = useState<string | null>(null)
  const tier = useTier()
  return (
    <View className="min-h-screen w-80 flex-col items-stretch gap-3 p-8">
      <EntryRefPicker
        value={value}
        onChange={setValue}
        entries={ENTRIES}
        label="Occurred at"
        placeholder="Pick the entry it happened at"
        testID="picker"
      />
      <Text testID="tier" variant="muted" size="xs">
        {tier}
      </Text>
    </View>
  )
}

export const ClosePhoneNeverFlashesEmptyState: Story = {
  globals: { viewport: { value: 'mobile1' } },
  render: () => <PhoneHarness />,
  play: async () => {
    // Tier-dependent assertion needs a wait — useTier() reads a stale window width for at
    // least one commit (lessons-learned/storybook-viewport-usetier-async.md).
    await waitFor(() => expect(screen.getByTestId('tier')).toHaveTextContent('phone'))
    await userEvent.click(screen.getByTestId('picker'))
    const options = await screen.findAllByRole('option')
    await userEvent.click(options[0]!)
    await waitFor(async () => {
      await expect(screen.getByTestId('picker')).toHaveTextContent(/entry #40(?!\d)/)
    })

    // The regression this guards (sections gated on `open`) showed the empty copy for
    // the whole close animation, not just its first frame — poll through that window.
    const deadline = Date.now() + 800
    while (Date.now() < deadline) {
      await expect(screen.queryByText(t('picker.entryNoResults'))).not.toBeInTheDocument()
      await expect(screen.queryByText(t('picker.entryNone'))).not.toBeInTheDocument()
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  },
}

export const ReadOnlyText: StoryObj = {
  render: () => (
    <View testID="readonly-column" style={{ width: 400 }} className="gap-2 p-4">
      <EntryRefText entry={ENTRIES[0]!} />
      <EntryRefText entry={null} />
    </View>
  ),
  play: async () => {
    // A bare `Tag` under a column parent's `align-items: stretch` would size the pill
    // to the container's full width instead of hugging its own content.
    const container = screen.getByTestId('readonly-column')
    const containerWidth = container.getBoundingClientRect().width
    const danglingLabel = screen.getByText(/Entry no longer exists/)
    const pill = danglingLabel.parentElement
    if (pill == null) throw new Error('Expected the dangling label to have a parent element.')
    const pillWidth = pill.getBoundingClientRect().width
    await expect(pillWidth).toBeLessThan(containerWidth * 0.7)
  },
}
