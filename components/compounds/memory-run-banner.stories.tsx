import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { t } from '@/lib/i18n'

import { MemoryRunBannerView, type MemoryRunBannerViewProps } from './memory-run-banner'
import { closeBannerLabel } from './use-memory-run-banner'

const meta: Meta<typeof MemoryRunBannerView> = {
  title: 'Compounds/MemoryRunBanner',
  component: MemoryRunBannerView,
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof MemoryRunBannerView>

function runArgs(args: MemoryRunBannerViewProps) {
  if (args.kind !== 'run') throw new Error('a run banner story')
  return args
}

function closedArgs(args: MemoryRunBannerViewProps) {
  if (args.kind !== 'closed') throw new Error('a done banner story')
  return args
}

export const Updating: Story = {
  args: { kind: 'run', label: t('chrome.memoryBanner.updating'), onCancel: fn() },
  play: async ({ args }) => {
    expect(screen.getByText(t('chrome.memoryBanner.updating'))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t('cancel') }))
    await waitFor(() => expect(runArgs(args).onCancel).toHaveBeenCalledTimes(1))
  },
}

export const UpdatingBeforeTurn: Story = {
  args: { kind: 'run', label: t('chrome.memoryBanner.updatingBeforeTurn'), onCancel: fn() },
  play: async () => {
    expect(screen.getByText(t('chrome.memoryBanner.updatingBeforeTurn'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('cancel') })).toBeInTheDocument()
  },
}

// The longer label wraps at 320 px instead of pushing Cancel off the bar.
export const PhoneUpdatingBeforeTurn: Story = {
  args: { kind: 'run', label: t('chrome.memoryBanner.updatingBeforeTurn'), onCancel: fn() },
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
    await waitFor(() => expect(runArgs(args).onCancel).toHaveBeenCalledTimes(1))
  },
}

export const LiveRegionCoversOnlyTheLabel: Story = {
  args: { kind: 'run', label: t('chrome.memoryBanner.updating'), onCancel: fn() },
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

// A close Send owes: the label says before your turn, whatever step the close is on.
export const ClosingBeforeTurn: Story = {
  args: {
    kind: 'run',
    label: closeBannerLabel({
      beforeTurn: true,
      currentPhase: 'agent',
      closeProgress: { task: 'identity', part: 1, index: 3, total: 7 },
    }),
    onCancel: fn(),
  },
  play: async ({ args }) => {
    expect(screen.getByText('Before your turn: 3 of 7 — Identity…')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t('cancel') }))
    await waitFor(() => expect(runArgs(args).onCancel).toHaveBeenCalledTimes(1))
  },
}

export const ClosingTask: Story = {
  args: {
    kind: 'run',
    label: closeBannerLabel({
      beforeTurn: false,
      currentPhase: 'agent',
      closeProgress: { task: 'identity', part: 1, index: 3, total: 7 },
    }),
    onCancel: fn(),
  },
  play: async () => {
    expect(
      screen.getByText(
        t('chrome.memoryBanner.closingTask', {
          index: 3,
          total: 7,
          task: t('chrome.memoryBanner.closeTask.identity'),
        }),
      ),
    ).toBeInTheDocument()
  },
}

// A three-part chapter's count label wraps at 320 px instead of pushing Cancel off the bar.
export const PhoneClosingTask: Story = {
  args: {
    kind: 'run',
    label: closeBannerLabel({
      beforeTurn: false,
      currentPhase: 'agent',
      closeProgress: { task: 'lifecycle', part: 3, index: 16, total: 17 },
    }),
    onCancel: fn(),
  },
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ args }) => {
    const cancel = screen.getByRole('button', { name: t('cancel') })
    await waitFor(() =>
      expect(cancel.getBoundingClientRect().right).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      ),
    )
    expect(screen.getByText(args.label)).toBeVisible()
  },
}

/** A close that committed: its title, Review and an icon-only dismiss; no Cancel. */
export const ClosedInfo: Story = {
  args: {
    kind: 'closed',
    tone: 'info',
    label: 'Chapter closed: The Keep Leans Closer',
    onReview: fn(),
    onDismiss: fn(),
  },
  play: async ({ args }) => {
    const done = closedArgs(args)
    const banner = screen.getByTestId('memory-run-banner')
    expect(banner).toHaveClass('border-info')
    expect(within(banner).getAllByTestId('memory-run-banner-info-icon')[0]).toBeVisible()
    expect(within(banner).queryAllByTestId('memory-run-banner-warning-icon')).toEqual([])
    const region = within(banner).getByRole('status')
    expect(region).toHaveTextContent('Chapter closed: The Keep Leans Closer')
    expect(within(region).queryAllByRole('button')).toEqual([])
    expect(within(banner).queryByRole('button', { name: 'Cancel' })).toBeNull()

    await userEvent.click(within(banner).getByRole('button', { name: 'Review' }))
    await waitFor(() => expect(done.onReview).toHaveBeenCalledTimes(1))
    await userEvent.click(within(banner).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(done.onDismiss).toHaveBeenCalledTimes(1))
    expect(done.onReview).toHaveBeenCalledTimes(1)
  },
}

/** Tasks stopped early: the warning tone, the same two actions. */
export const ClosedWarning: Story = {
  args: {
    kind: 'closed',
    tone: 'warning',
    label: 'Chapter closed, but 2 tasks stopped early',
    onReview: fn(),
    onDismiss: fn(),
  },
  play: async () => {
    const banner = screen.getByTestId('memory-run-banner')
    expect(banner).toHaveClass('border-warning')
    expect(banner).not.toHaveClass('border-info')
    expect(within(banner).getAllByTestId('memory-run-banner-warning-icon')[0]).toBeVisible()
    expect(within(banner).queryAllByTestId('memory-run-banner-info-icon')).toEqual([])
    expect(within(banner).getByRole('status')).toHaveTextContent(
      'Chapter closed, but 2 tasks stopped early',
    )
    expect(within(banner).getByRole('button', { name: 'Review' })).toBeVisible()
    expect(within(banner).getByRole('button', { name: 'Dismiss' })).toBeVisible()
  },
}

// The warning label wraps at 320 px instead of pushing Review and × off the bar.
export const PhoneClosedWarning: Story = {
  args: {
    kind: 'closed',
    tone: 'warning',
    label: 'Chapter closed, but 2 tasks stopped early',
    onReview: fn(),
    onDismiss: fn(),
  },
  globals: { viewport: { value: 'mobile1' } },
  play: async () => {
    const dismiss = screen.getByRole('button', { name: 'Dismiss' })
    await waitFor(() =>
      expect(dismiss.getBoundingClientRect().right).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      ),
    )
    expect(screen.getByRole('button', { name: 'Review' })).toBeVisible()
    expect(screen.getByText('Chapter closed, but 2 tasks stopped early')).toBeVisible()
  },
}
