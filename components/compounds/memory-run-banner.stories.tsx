import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { t } from '@/lib/i18n'

import { MemoryRunBannerView } from './memory-run-banner'

const meta: Meta<typeof MemoryRunBannerView> = {
  title: 'Compounds/MemoryRunBanner',
  component: MemoryRunBannerView,
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof MemoryRunBannerView>

export const Updating: Story = {
  args: { label: t('chrome.memoryBanner.updating'), onCancel: fn() },
  play: async ({ args }) => {
    expect(screen.getByText(t('chrome.memoryBanner.updating'))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t('cancel') }))
    await waitFor(() => expect(args.onCancel).toHaveBeenCalledTimes(1))
  },
}

export const UpdatingBeforeTurn: Story = {
  args: { label: t('chrome.memoryBanner.updatingBeforeTurn'), onCancel: fn() },
  play: async () => {
    expect(screen.getByText(t('chrome.memoryBanner.updatingBeforeTurn'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('cancel') })).toBeInTheDocument()
  },
}

// The longer label wraps at 320 px instead of pushing Cancel off the bar.
export const PhoneUpdatingBeforeTurn: Story = {
  args: { label: t('chrome.memoryBanner.updatingBeforeTurn'), onCancel: fn() },
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ args }) => {
    const cancel = screen.getByRole('button', { name: t('cancel') })
    await waitFor(() =>
      expect(cancel.getBoundingClientRect().right).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      ),
    )
    expect(screen.getByText(t('chrome.memoryBanner.updatingBeforeTurn'))).toBeVisible()
    await userEvent.click(cancel)
    await waitFor(() => expect(args.onCancel).toHaveBeenCalledTimes(1))
  },
}

export const LiveRegionCoversOnlyTheLabel: Story = {
  args: { label: t('chrome.memoryBanner.updating'), onCancel: fn() },
  play: async () => {
    const region = await screen.findByRole('status')
    // role="status" implies aria-atomic, so a region spanning the bar would re-announce Cancel too.
    expect(region).toHaveTextContent(t('chrome.memoryBanner.updating'))
    expect(within(region).queryAllByRole('button')).toEqual([])
    const banner = screen.getByTestId('memory-run-banner')
    expect(region).not.toBe(banner)
    expect(region.contains(within(banner).getByRole('button', { name: t('cancel') }))).toBe(false)
  },
}
