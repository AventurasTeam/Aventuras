import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent } from 'storybook/test'

import { t } from '@/lib/i18n'

import { BrowseChip } from './browse-chip'

const PHONE = { viewport: { value: 'mobile1' } }

// null: no tint layer. '1' fresh, '0.5' fading.
function tintOpacity(): string | null {
  const layer = screen.queryByTestId('browse-chip-tint')
  return layer == null ? null : getComputedStyle(layer).opacity
}

const meta: Meta<typeof BrowseChip> = {
  title: 'Compounds/Reader/BrowseChip',
  component: BrowseChip,
  parameters: { layout: 'centered' },
  args: { tint: undefined, onPress: fn() },
}

export default meta
type Story = StoryObj<typeof BrowseChip>

export const Fresh: Story = {
  globals: PHONE,
  args: { tint: 'fresh' },
  play: async ({ args }) => {
    const chip = await screen.findByRole('button', { name: t('reader:rail.browse') })
    await expect(chip).toHaveAttribute('aria-haspopup', 'dialog')
    await expect(chip).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(chip)
    await expect(args.onPress).toHaveBeenCalledTimes(1)
    await expect(tintOpacity()).toBe('1')
  },
}

export const Fading: Story = {
  globals: PHONE,
  args: { tint: 'fading' },
  play: async () => {
    await expect(await screen.findByTestId('browse-chip')).toBeVisible()
    await expect(tintOpacity()).toBe('0.5')
  },
}

export const Untinted: Story = {
  globals: PHONE,
  play: async () => {
    await expect(await screen.findByTestId('browse-chip')).toBeVisible()
    await expect(tintOpacity()).toBeNull()
  },
}
