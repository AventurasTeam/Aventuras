import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { expectInsetFocusRing } from '@/components/ui/focus-ring-probe'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { themes } from '@/lib/themes'

import { DeltaLogRow, type Delta } from './delta-log-row'

const baseDelta: Delta = {
  id: 'delta-1',
  op: 'update',
  source: 'ai_classifier',
  targetTable: 'entities',
  targetDisplayName: 'Kael',
  fieldPath: 'state.traits',
  summary: 'Added "former soldier"; was ["brave", "loyal"]',
  entryId: 'entry #47',
  createdAtRelative: '2h ago',
  actionId: 'action-1',
}

const LONG_SUMMARY =
  'A long summary that should clamp to two lines and ellipsize cleanly. The host format covers the diff so the row can leave overflow rendering to the layout layer; consumers should expect the bound at exactly two lines so the meta strip keeps its baseline.'

// The review window's row: one close's change, its entry in the footer's link, not in its name.
const reviewDelta: Delta = {
  ...baseDelta,
  id: 'delta-review',
  source: 'chapter_close',
  fieldPath: 'Voice',
  summary: 'wry, joking → short, flat sentences',
  entryId: null,
  createdAtRelative: '',
}

const openEntry = fn()

function ReviewFooter() {
  return (
    <View className="flex-row flex-wrap items-center gap-x-2">
      <Text variant="muted" size="sm">
        He stops joking after Oss.
      </Text>
      <Pressable accessibilityRole="link" aria-label="entry #47 →" onPress={openEntry}>
        <Text>entry #47 →</Text>
      </Pressable>
    </View>
  )
}

const meta: Meta<typeof DeltaLogRow> = {
  title: 'Compounds/DeltaLogRow',
  component: DeltaLogRow,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <View className="rounded-md border border-border bg-bg-base" style={{ width: 480 }}>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof DeltaLogRow>

export const UpdateOp: Story = {
  args: { delta: baseDelta, onPress: fn() },
  play: async () => {
    const row = await screen.findByTestId('delta-log-row')
    // Without a footer the outer element holds the row alone, at even vertical padding.
    expect(row.parentElement?.childElementCount).toBe(1)
    const style = getComputedStyle(row)
    expect(style.paddingBottom).toBe(style.paddingTop)
    await expectInsetFocusRing(row)
  },
}

export const CreateOp: Story = {
  args: {
    delta: {
      ...baseDelta,
      id: 'delta-2',
      op: 'create',
      fieldPath: null,
      summary: 'Created',
    },
    onPress: fn(),
  },
}

export const DeleteOp: Story = {
  args: {
    delta: {
      ...baseDelta,
      id: 'delta-3',
      op: 'delete',
      fieldPath: null,
      summary: 'Deleted',
    },
    onPress: fn(),
  },
}

export const SourceUserEdit: Story = {
  args: { delta: { ...baseDelta, source: 'user_edit' }, onPress: fn() },
}

export const SourceLoreAgent: Story = {
  args: { delta: { ...baseDelta, source: 'lore_agent' }, onPress: fn() },
}

export const SourcePeriodicClassifier: Story = {
  args: {
    delta: {
      ...baseDelta,
      source: 'periodic_classifier',
      entryId: null,
      summary: 'Reconciled entity state from recent turns',
    },
    onPress: fn(),
  },
}

export const SourceChapterClose: Story = {
  args: {
    delta: {
      ...baseDelta,
      source: 'chapter_close',
      entryId: null,
      summary: 'Chapter 3 closed; world snapshot taken',
    },
    onPress: fn(),
  },
}

export const NoEntryLink: Story = {
  args: {
    delta: { ...baseDelta, entryId: null },
    onPress: fn(),
  },
}

export const NoFieldPath: Story = {
  args: {
    delta: { ...baseDelta, op: 'create', fieldPath: null, summary: 'Created' },
    onPress: fn(),
  },
}

export const LongTargetName: Story = {
  args: {
    delta: {
      ...baseDelta,
      targetDisplayName:
        'A character with an unusually long display name that should truncate inline',
      fieldPath: 'state.relationships.factions[2].standing',
    },
    onPress: fn(),
  },
}

export const LongSummary: Story = {
  args: {
    delta: { ...baseDelta, summary: LONG_SUMMARY },
    onPress: fn(),
  },
}

export const NonInteractive: Story = {
  args: { delta: baseDelta },
}

export const PressFires: Story = {
  args: { delta: baseDelta, onPress: fn() },
  play: async ({ args }) => {
    const button = screen.getByRole('button', { name: 'update Kael, entry #47' })
    await userEvent.click(button)
    await waitFor(() => expect(args.onPress).toHaveBeenCalledTimes(1))
  },
}

export const PressableNameWithoutEntry: Story = {
  args: { delta: { ...baseDelta, entryId: null }, onPress: fn() },
  play: async () => {
    expect(screen.getByRole('button', { name: 'update Kael' })).toBeVisible()
  },
}

export const PressableDescribesTheChange: Story = {
  args: { delta: baseDelta, onPress: fn() },
  play: async () => {
    const meta = [t('history:source.ai_classifier'), 'entry #47', '2h ago'].join(' · ')
    expect(
      screen.getByRole('button', { name: 'update Kael, entry #47' }),
    ).toHaveAccessibleDescription(
      `state.traits Added "former soldier"; was ["brave", "loyal"] ${meta}`,
    )
  },
}

export const NonInteractiveIsNotAControl: Story = {
  args: { delta: baseDelta },
  play: async ({ canvasElement }) => {
    expect(screen.queryByRole('button')).toBeNull()
    const row = screen.getByTestId('delta-log-row')
    expect(row).not.toHaveAttribute('aria-label')
    expect(canvasElement.querySelector('[aria-disabled]')).toBeNull()
    expect(row).not.toHaveAttribute('tabindex')
    expect(row).toHaveTextContent('Added "former soldier"')
  },
}

export const WithFooter: Story = {
  args: {
    delta: reviewDelta,
    onPress: fn(),
    showMeta: false,
    className: 'border-b border-border',
  },
  render: (args) => <DeltaLogRow {...args} footer={<ReviewFooter />} />,
  play: async ({ args }) => {
    openEntry.mockClear()
    const link = screen.getByRole('link', { name: 'entry #47 →' })
    // A control of its own: no button around it, the row's included.
    expect(link.parentElement?.closest('[role="button"]')).toBeNull()
    // The badge's twin that holds the indent is hidden from readers and takes no height.
    const spacers = screen
      .getAllByText(t('history:op.update'))
      .map((el) => el.closest('[aria-hidden="true"]'))
      .filter((el) => el != null)
    expect(spacers).toHaveLength(1)
    expect(spacers[0].getBoundingClientRect().height).toBe(0)
    // The host's className sits on the outermost element, the wrapper.
    const row = screen.getByTestId('delta-log-row')
    expect(row).not.toHaveClass('border-b')
    expect(row.parentElement).toHaveClass('border-b')
    // Indented to the summary column, past the op badge.
    const why = screen.getByText('He stops joking after Oss.')
    const summary = screen.getByText('wry, joking → short, flat sentences')
    expect(
      Math.abs(why.getBoundingClientRect().left - summary.getBoundingClientRect().left),
    ).toBeLessThanOrEqual(1)

    await userEvent.click(link)
    await waitFor(() => expect(openEntry).toHaveBeenCalledTimes(1))
    expect(args.onPress).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'update Kael' }))
    await waitFor(() => expect(args.onPress).toHaveBeenCalledTimes(1))
    expect(openEntry).toHaveBeenCalledTimes(1)
  },
}

function FooterToggleHarness() {
  const [withFooter, setWithFooter] = useState(false)
  return (
    <DeltaLogRow
      delta={reviewDelta}
      onPress={() => setWithFooter((on) => !on)}
      showMeta={false}
      className="border-b border-border"
      footer={withFooter ? <ReviewFooter /> : undefined}
    />
  )
}

/** A footer that comes and goes leaves the row's button where it was, and its focus with it. */
export const FooterToggleKeepsFocus: Story = {
  render: () => <FooterToggleHarness />,
  play: async () => {
    const button = screen.getByRole('button', { name: 'update Kael' })
    const outer = button.parentElement
    button.focus()

    await userEvent.keyboard('{Enter}')
    await screen.findByRole('link', { name: 'entry #47 →' })
    expect(button).toHaveFocus()
    expect(screen.getByRole('button', { name: 'update Kael' })).toBe(button)
    // One outermost element in both shapes, carrying the host's className.
    expect(button.parentElement).toBe(outer)
    expect(outer).toHaveClass('border-b')

    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('link', { name: 'entry #47 →' })).toBeNull())
    expect(button).toHaveFocus()
    expect(screen.getByRole('button', { name: 'update Kael' })).toBe(button)
    expect(button.parentElement).toBe(outer)
  },
}

export const WithoutMeta: Story = {
  args: { delta: baseDelta, onPress: fn(), showMeta: false },
  play: async () => {
    const meta = [t('history:source.ai_classifier'), 'entry #47', '2h ago'].join(' · ')
    expect(screen.queryByText(meta)).toBeNull()
    const button = screen.getByRole('button', { name: 'update Kael, entry #47' })
    expect(button).toHaveAccessibleDescription(
      'state.traits Added "former soldier"; was ["brave", "loyal"]',
    )
    // The dropped line leaves no id behind: every element the description names is there.
    const ids = button.getAttribute('aria-describedby')?.split(' ') ?? []
    expect(ids).toHaveLength(2)
    for (const id of ids) expect(document.getElementById(id)).not.toBeNull()
  },
}

/** A refusal that proposed no value has no summary: no empty line, and no empty description part. */
export const EmptySummary: Story = {
  args: { delta: { ...reviewDelta, summary: '' }, onPress: fn(), showMeta: false },
  play: async () => {
    const button = screen.getByRole('button', { name: 'update Kael' })
    expect(button).toHaveAccessibleDescription('Voice')
    // Native joins the same parts into its hint, so an empty one would read "Voice, ".
    expect(button.getAttribute('aria-describedby')?.split(' ')).toHaveLength(1)
    expect(button.querySelectorAll('[id]')).toHaveLength(1)
  },
}

export const UnclampedSummary: Story = {
  render: () => (
    <View>
      <DeltaLogRow delta={{ ...baseDelta, summary: LONG_SUMMARY }} />
      <DeltaLogRow
        delta={{ ...baseDelta, id: 'delta-unclamped', summary: LONG_SUMMARY }}
        summaryLines={null}
      />
    </View>
  ),
  play: async () => {
    const [clamped, unclamped] = screen.getAllByText(LONG_SUMMARY)
    // Taller than its clamped twin: the value runs past two lines, and nothing cuts it.
    expect(unclamped.getBoundingClientRect().height).toBeGreaterThan(
      clamped.getBoundingClientRect().height,
    )
  },
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="flex-col gap-3">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="overflow-hidden rounded-md border border-border bg-bg-base p-3"
        >
          <View className="pb-2">
            <Text variant="muted" size="xs">
              {t.name}
            </Text>
          </View>
          <View className="flex-col">
            <DeltaLogRow
              delta={{
                ...baseDelta,
                id: `${t.id}-create`,
                op: 'create',
                fieldPath: null,
                summary: 'Created',
              }}
              onPress={fn()}
            />
            <DeltaLogRow delta={{ ...baseDelta, id: `${t.id}-update` }} onPress={fn()} />
            <DeltaLogRow
              delta={{
                ...baseDelta,
                id: `${t.id}-delete`,
                op: 'delete',
                fieldPath: null,
                summary: 'Deleted',
              }}
              onPress={fn()}
            />
          </View>
        </View>
      ))}
    </View>
  ),
}
