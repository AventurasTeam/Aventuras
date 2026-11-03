import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Text } from '@/components/ui/text'

import { ChapterChip } from './chapter-chip'

const meta: Meta<typeof ChapterChip> = {
  title: 'Compounds/Reader/ChapterChip',
  component: ChapterChip,
  parameters: { layout: 'centered' },
  args: { number: 3 },
}

export default meta
type Story = StoryObj<typeof ChapterChip>

export const Default: Story = {
  args: { onPress: fn() },
  play: async ({ args }) => {
    const chip = await screen.findByRole('button', { name: 'Chapter 3' })
    await expect(chip).toHaveAttribute('data-testid', 'chapter-chip')
    await expect(chip).toHaveAttribute('aria-expanded', 'false')
    await expect(chip.querySelector('svg')).not.toBeNull()
    await userEvent.click(chip)
    await expect(args.onPress).toHaveBeenCalledTimes(1)
  },
}

export const Expanded: Story = {
  args: { expanded: true },
  play: async () => {
    await expect(await screen.findByRole('button', { name: 'Chapter 3' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  },
}

// A trigger measures this ref to place its content; a chip that drops it unanchors the popover.
export const UnderAsChildTrigger: Story = {
  render: () => (
    <Popover ariaLabel="Chapters">
      <PopoverTrigger asChild>
        <ChapterChip number={3} />
      </PopoverTrigger>
      <PopoverContent align="start">
        <Text>Popover body</Text>
      </PopoverContent>
    </Popover>
  ),
  play: async () => {
    const chip = await screen.findByRole('button', { name: 'Chapter 3' })
    await userEvent.click(chip)
    const body = await screen.findByText('Popover body')
    await waitFor(() =>
      expect(body.getBoundingClientRect().top).toBeGreaterThan(chip.getBoundingClientRect().bottom),
    )
    await expect(chip).toHaveAttribute('aria-expanded', 'true')
  },
}
