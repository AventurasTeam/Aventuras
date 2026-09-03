import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, screen } from 'storybook/test'

import { themes } from '@/lib/themes'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog'
import { Button } from './button'
import { Text } from './text'

const meta: Meta<typeof AlertDialog> = {
  title: 'Primitives/AlertDialog',
  component: AlertDialog,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof AlertDialog>

export const Basic: Story = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="secondary">
          <Text>Open dialog</Text>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Continue?</AlertDialogTitle>
          <AlertDialogDescription>
            This action will proceed. You can cancel out at any point.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">
              <Text>Cancel</Text>
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant="primary">
              <Text>Continue</Text>
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
}

// Rollback shape — destructive CTA + bulleted impact list.
export const RollbackShape: Story = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="secondary">
          <Text>Trigger rollback</Text>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete from entry 47?</AlertDialogTitle>
          <AlertDialogDescription>Permanent — rolls back to entry 46.</AlertDialogDescription>
        </AlertDialogHeader>
        <View className="gap-1">
          <Text size="sm">• 12 entries</Text>
          <Text size="sm">• 4 classifications</Text>
          <Text size="sm">• 23 world-state changes</Text>
        </View>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">
              <Text>Cancel</Text>
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant="destructive">
              <Text>Delete entries</Text>
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
}

// Calendar swap-warning shape — three structured sub-warning blocks
// between header and footer. Verifies rich content composes cleanly.
export const SwapWarningShape: Story = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="secondary">
          <Text>Switch calendar</Text>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Switch calendar to Stardate?</AlertDialogTitle>
          <AlertDialogDescription>
            Three changes will apply on switch. Review each.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <View className="gap-3">
          <View className="gap-1 rounded-md border border-warning bg-bg-raised p-3">
            <Text size="sm" className="font-medium">
              Origin tuple — Stardate&apos;s tier set differs.
            </Text>
            <Text size="xs" variant="muted">
              You&apos;ll need to re-pick the story-start moment.
            </Text>
          </View>
          <View className="gap-1 rounded-md border border-warning bg-bg-raised p-3">
            <Text size="sm" className="font-medium">
              Era support mismatch.
            </Text>
            <Text size="xs" variant="muted">
              4 era flips on this branch reference an era Stardate doesn&apos;t define.
            </Text>
          </View>
          <View className="gap-1 rounded-md border border-info bg-bg-raised p-3">
            <Text size="sm" className="font-medium">
              Display format change.
            </Text>
            <Text size="xs" variant="muted">
              Existing: Year 1247, day 88 → Stardate 47634.4
            </Text>
          </View>
        </View>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">
              <Text>Cancel</Text>
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant="primary">
              <Text>Switch calendar</Text>
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="gap-4">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="rounded-md bg-bg-base p-4"
          style={{ width: 320 }}
        >
          <Text variant="muted" size="sm" className="mb-2">
            {t.name}
          </Text>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="secondary">
                <Text>Open</Text>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete branch?</AlertDialogTitle>
                <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel asChild>
                  <Button variant="secondary">
                    <Text>Cancel</Text>
                  </Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button variant="destructive">
                    <Text>Delete branch</Text>
                  </Button>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </View>
      ))}
    </View>
  ),
}

// Crash recovery is the shape that forced the cap: one sentence per orphaned
// pipeline run, with nothing bounding the count.
const RECOVERY_SENTENCES = Array.from(
  { length: 12 },
  (_, i) =>
    `An interrupted background memory update in Story ${i + 1} could not be undone. ` +
    'Memory updates for this story are paused so nothing is duplicated — your story ' +
    'content is intact, and restarting the app retries automatically.',
)

function scrollersBetween(from: HTMLElement, stop: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = []
  for (let el = from.parentElement; el != null && el !== stop; el = el.parentElement) {
    const overflowY = getComputedStyle(el).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') found.push(el)
  }
  return found
}

export const TallContent: Story = {
  render: () => (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Recovery incomplete</AlertDialogTitle>
          <AlertDialogDescription>{RECOVERY_SENTENCES.join(' ')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary">
              <Text>Cancel</Text>
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant="primary">
              <Text>Continue</Text>
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
  play: async () => {
    const panel = (await screen.findByText('Recovery incomplete')).closest(
      '[role="alertdialog"]',
    ) as HTMLElement
    const rect = panel.getBoundingClientRect()

    expect(rect.height).toBeLessThanOrEqual(window.innerHeight * 0.9 + 1)
    expect(rect.top).toBeGreaterThanOrEqual(0)
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight + 1)

    const body = screen.getByText(RECOVERY_SENTENCES.join(' '))
    const bodyScrollers = scrollersBetween(body, panel)
    expect(bodyScrollers).toHaveLength(1)
    const scroller = bodyScrollers[0]
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)

    // The actions row is the whole point of a consent gate, so it is partitioned
    // out of the scroll region rather than scrolled to.
    const actions = ['Cancel', 'Continue'].map((name) => screen.getByRole('button', { name }))
    for (const action of actions) {
      expect(scrollersBetween(action, panel)).toHaveLength(0)
      expect(scroller.contains(action)).toBe(false)
    }

    const before = actions.map((a) => a.getBoundingClientRect())
    for (const [i, action] of actions.entries()) {
      expect(before[i].bottom).toBeLessThanOrEqual(window.innerHeight + 1)
      const topMost = document.elementFromPoint(
        Math.floor(before[i].left + before[i].width / 2),
        Math.floor(before[i].top + before[i].height / 2),
      )
      expect(action.contains(topMost) || action === topMost).toBe(true)
    }

    scroller.scrollTop = scroller.scrollHeight
    for (const [i, action] of actions.entries()) {
      const after = action.getBoundingClientRect()
      expect(after.top).toBeCloseTo(before[i].top, 0)
      expect(after.bottom).toBeCloseTo(before[i].bottom, 0)
    }
  },
}
