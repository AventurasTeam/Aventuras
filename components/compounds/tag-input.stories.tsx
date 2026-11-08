import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useState, type ComponentProps } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { expectThemeSelection } from '@/components/ui/selection-probe'
import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes'

import { TagInput } from './tag-input'

const meta: Meta<typeof TagInput> = {
  title: 'Compounds/TagInput',
  component: TagInput,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <View style={{ width: 480 }}>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof TagInput>

function Harness({
  initial = [] as readonly string[],
  ...rest
}: {
  initial?: readonly string[]
} & Omit<ComponentProps<typeof TagInput>, 'value' | 'onChange'>) {
  const [value, setValue] = useState<string[]>(initial as string[])
  return <TagInput value={value} onChange={setValue} {...rest} />
}

export const Empty: Story = {
  render: () => <Harness placeholder="Add tags…" />,
}

export const SelectsWithTheThemeTint: Story = {
  render: () => <Harness placeholder="Add tags…" />,
  play: ({ canvasElement }) => {
    expectThemeSelection(canvasElement.querySelector('input')!)
  },
}

export const Populated: Story = {
  render: () => <Harness initial={['sci-fi', 'fantasy', 'dystopia']} placeholder="Add tags…" />,
}

export const Disabled: Story = {
  render: () => (
    <Harness
      initial={['sci-fi', 'fantasy']}
      placeholder="Add tags…"
      disabled
      disabledReason="Generation is in flight. Cancel to edit."
    />
  ),
}

const RUN_REASON = 'Generation is in flight. Cancel to edit.'
const START_RUN = 'story:start-run'

// A run starts elsewhere, so the field keeps focus; the play function fires it.
function DisablingHarness({ initial }: { initial: string[] }) {
  const [disabled, setDisabled] = useState(false)
  const [value, setValue] = useState<string[]>(initial)
  useEffect(() => {
    const start = () => setDisabled(true)
    window.addEventListener(START_RUN, start)
    return () => window.removeEventListener(START_RUN, start)
  }, [])
  return (
    <TagInput
      value={value}
      onChange={setValue}
      placeholder="Add tags…"
      disabled={disabled}
      disabledReason={RUN_REASON}
    />
  )
}

async function startRun(input: HTMLElement): Promise<void> {
  window.dispatchEvent(new Event(START_RUN))
  await waitFor(() => expect(input).toHaveAttribute('readonly'))
}

// A run disables every field at once; the reason's tooltip must not remount the input under it.
export const KeepsItsInputAsARunStarts: Story = {
  render: () => <DisablingHarness initial={['sci-fi']} />,
  play: async ({ canvas }) => {
    const before = canvas.getByRole('textbox')
    expect(before.closest('[title]')).toBeNull()
    await userEvent.click(before)
    await startRun(before)
    const after = canvas.getByRole('textbox')
    expect(after).toBe(before)
    expect(after).toHaveFocus()
    expect(after.closest('[title]')).toHaveAttribute('title', RUN_REASON)
    await userEvent.keyboard('{Backspace}')
    expect(canvas.getByText('sci-fi')).toBeInTheDocument()
  },
}

// Enter on a single-line input also blurs it, so this covers the blur's commit too.
export const CommitsNoTypedTagOnceARunStarts: Story = {
  render: () => <DisablingHarness initial={[]} />,
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox')
    await userEvent.click(input)
    await userEvent.type(input, 'noir')
    await startRun(input)
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(input).not.toHaveFocus())
    expect(canvas.queryByText('noir')).toBeNull()
    expect(input).toHaveValue('noir')
  },
}

export const Invalid: Story = {
  render: () => <Harness initial={['sci-fi']} placeholder="Add tags…" aria-invalid="true" />,
}

export const MaxCountReached: Story = {
  render: () => (
    <Harness initial={['sci-fi', 'fantasy', 'dystopia']} placeholder="Add tags…" maxCount={3} />
  ),
}

export const MaxTagLength: Story = {
  render: () => <Harness placeholder="Type a long tag — capped at 12 chars" maxTagLength={12} />,
}

export const CommitOnEnter: Story = {
  render: () => <Harness placeholder="Add tags…" />,
  play: async () => {
    const input = screen.getByPlaceholderText('Add tags…')
    await userEvent.click(input)
    await userEvent.type(input, 'sci-fi{Enter}')
    await waitFor(() => expect(screen.getByText('sci-fi')).toBeInTheDocument())
  },
}

export const CommitOnComma: Story = {
  render: () => <Harness placeholder="Add tags…" />,
  play: async () => {
    const input = screen.getByPlaceholderText('Add tags…')
    await userEvent.click(input)
    await userEvent.type(input, 'fantasy,')
    await waitFor(() => expect(screen.getByText('fantasy')).toBeInTheDocument())
  },
}

export const CommitOnBlur: Story = {
  render: () => (
    <View className="flex-col gap-3">
      <Harness placeholder="Add tags…" />
      <View testID="elsewhere" />
    </View>
  ),
  play: async () => {
    const input = screen.getByPlaceholderText('Add tags…')
    await userEvent.click(input)
    await userEvent.type(input, 'dystopia')
    // Blur via Tab — moves focus elsewhere; commitTyped fires.
    await userEvent.tab()
    await waitFor(() => expect(screen.getByText('dystopia')).toBeInTheDocument())
  },
}

export const PasteSplitsOnComma: Story = {
  render: () => <Harness placeholder="Paste comma-separated tags here" />,
  play: async () => {
    const input = screen.getByPlaceholderText('Paste comma-separated tags here')
    await userEvent.click(input)
    // Type comma-separated text to simulate the paste path —
    // userEvent.paste isn't reliable across the RN-Web bridge, but
    // typing fires onChangeText with each character; the trailing
    // comma forces split-and-commit on the prefix pieces. The last
    // fragment (with trailing comma) commits cleanly.
    await userEvent.type(input, 'sci-fi, fantasy, dystopia,')
    await waitFor(() => {
      expect(screen.getByText('sci-fi')).toBeInTheDocument()
      expect(screen.getByText('fantasy')).toBeInTheDocument()
      expect(screen.getByText('dystopia')).toBeInTheDocument()
    })
  },
}

export const DedupeIsCaseInsensitive: Story = {
  render: () => <Harness initial={['sci-fi']} placeholder="Try adding 'Sci-Fi'…" />,
  play: async () => {
    // Placeholder is hidden once tags are present (tag-input.tsx renders
    // it only when value.length === 0) — query by role instead.
    const input = screen.getByRole('textbox')
    await userEvent.click(input)
    await userEvent.type(input, 'Sci-Fi{Enter}')
    // Original casing preserved; dupe rejected.
    await waitFor(() => {
      expect(screen.getByText('sci-fi')).toBeInTheDocument()
      expect(screen.queryByText('Sci-Fi')).not.toBeInTheDocument()
    })
  },
}

export const RemoveViaChipX: Story = {
  render: () => <Harness initial={['sci-fi', 'fantasy', 'dystopia']} placeholder="Add tags…" />,
  play: async () => {
    // Each chip's × is a separate Pressable with aria-label="Remove".
    // Clicking the first one removes "sci-fi".
    const removes = screen.getAllByRole('button', { name: 'Remove' })
    await userEvent.click(removes[0]!)
    await waitFor(() => {
      expect(screen.queryByText('sci-fi')).not.toBeInTheDocument()
      expect(screen.getByText('fantasy')).toBeInTheDocument()
      expect(screen.getByText('dystopia')).toBeInTheDocument()
    })
  },
}

export const BackspaceOnEmptyRemovesLast: Story = {
  render: () => <Harness initial={['sci-fi', 'fantasy']} placeholder="Add tags…" />,
  play: async () => {
    const input = screen.getByRole('textbox')
    await userEvent.click(input)
    // Input is currently empty — Backspace removes last chip.
    await userEvent.keyboard('{Backspace}')
    await waitFor(() => {
      expect(screen.getByText('sci-fi')).toBeInTheDocument()
      expect(screen.queryByText('fantasy')).not.toBeInTheDocument()
    })
  },
}

export const DisabledBlocksInput: Story = {
  args: {
    value: ['sci-fi', 'fantasy'],
    onChange: fn(),
    disabled: true,
    placeholder: 'Add tags…',
  },
  play: async ({ args }) => {
    const input = screen.getByRole('textbox')
    // react-native-web renders disabled TextInput as `readonly`, not
    // `disabled` — assertion matches the actual DOM contract.
    expect(input).toHaveAttribute('readonly')
    expect(args.onChange).not.toHaveBeenCalled()
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
          <TagInput
            value={['sci-fi', 'fantasy', 'dystopia']}
            onChange={fn()}
            placeholder="Add tags…"
          />
        </View>
      ))}
    </View>
  ),
}
