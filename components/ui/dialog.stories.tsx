import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { ScrollView, View } from 'react-native'
import { expect, screen } from 'storybook/test'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes'

const meta: Meta<typeof Dialog> = {
  title: 'Primitives/Dialog',
  component: Dialog,
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof Dialog>

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Text>Open dialog</Text>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm action</DialogTitle>
          <DialogDescription>Pick one of the options below.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary">
            <Text>Cancel</Text>
          </Button>
          <Button variant="primary">
            <Text>Confirm</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

export const WithFooterOnly: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Text>Open</Text>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Notice</DialogTitle>
        </DialogHeader>
        <Text variant="muted">
          Single-button footer; the corner × is the only other dismissal affordance.
        </Text>
        <DialogFooter>
          <Button variant="primary">
            <Text>Close</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">
                <Text>Open</Text>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm action</DialogTitle>
                <DialogDescription>Pick one of the options below.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="secondary">
                  <Text>Cancel</Text>
                </Button>
                <Button variant="primary">
                  <Text>Confirm</Text>
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </View>
      ))}
    </View>
  ),
}

// A centred dialog sits in a `position: fixed` overlay that never scrolls, so an
// uncapped panel grows out of the viewport in both directions and its actions
// become unreachable — no scrollbar anywhere to bring them back.
export const TallContent: Story = {
  render: () => (
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Long dialog</DialogTitle>
          <DialogDescription>More rows than fit on screen.</DialogDescription>
        </DialogHeader>
        {Array.from({ length: 60 }, (_, i) => (
          <Text key={i}>{`Row ${i + 1}`}</Text>
        ))}
        <DialogFooter>
          <Button variant="primary">
            <Text>Confirm</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  play: async () => {
    const panel = (await screen.findByText('Long dialog')).closest('[role="dialog"]') as HTMLElement
    const rect = panel.getBoundingClientRect()

    expect(rect.height).toBeLessThanOrEqual(window.innerHeight * 0.9 + 1)
    expect(rect.top).toBeGreaterThanOrEqual(0)
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight + 1)

    const confirm = screen.getByRole('button', { name: 'Confirm' })
    let scroller: HTMLElement | null = null
    for (let el = confirm.parentElement; el != null && el !== panel; el = el.parentElement) {
      const overflowY = getComputedStyle(el).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') {
        scroller = el
        break
      }
    }
    expect(scroller).not.toBeNull()
    expect(scroller!.scrollHeight).toBeGreaterThan(scroller!.clientHeight)

    // Reachability is the point, not the overflow value: scroll to the end and
    // require the actions to be both on screen and the topmost paint there.
    scroller!.scrollTop = scroller!.scrollHeight
    const box = confirm.getBoundingClientRect()
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight + 1)
    const topMost = document.elementFromPoint(
      Math.floor(box.left + box.width / 2),
      Math.floor(box.top + box.height / 2),
    )
    expect(confirm.contains(topMost) || confirm === topMost).toBe(true)

    // The × lives outside the scroll region, so scrolling to the end must not
    // carry it off the top of the panel.
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close.getBoundingClientRect().top - rect.top).toBeLessThan(64)
  },
}

// The shape the scene editor ships: the form owns a bounded scroll region and pins its
// own actions below it, so the primitive must add no scroller of its own — two nested
// scrollables fight for the gesture on Android — while the height cap still applies.
export const TallContentFormOwnedScroll: Story = {
  render: () => (
    <Dialog open>
      <DialogContent scrollable={false}>
        <DialogHeader>
          <DialogTitle>Form-owned scroll</DialogTitle>
        </DialogHeader>
        <ScrollView style={{ maxHeight: 240 }}>
          {Array.from({ length: 60 }, (_, i) => (
            <Text key={i}>{`Row ${i + 1}`}</Text>
          ))}
        </ScrollView>
        <DialogFooter>
          <Button variant="primary">
            <Text>Confirm</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  play: async () => {
    const panel = (await screen.findByText('Form-owned scroll')).closest(
      '[role="dialog"]',
    ) as HTMLElement
    const rect = panel.getBoundingClientRect()
    expect(rect.height).toBeLessThanOrEqual(window.innerHeight * 0.9 + 1)

    const confirm = screen.getByRole('button', { name: 'Confirm' })
    // Exactly one scroll region between the actions and the panel — the form's. A
    // second would mean the primitive re-added the one this prop opts out of.
    const scrollers: HTMLElement[] = []
    for (let el = confirm.parentElement; el != null && el !== panel; el = el.parentElement) {
      const overflowY = getComputedStyle(el).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') scrollers.push(el)
    }
    expect(scrollers).toHaveLength(0)

    // The actions sit outside the form's scroller, so they stay put and on top.
    const box = confirm.getBoundingClientRect()
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight + 1)
    const topMost = document.elementFromPoint(
      Math.floor(box.left + box.width / 2),
      Math.floor(box.top + box.height / 2),
    )
    expect(confirm.contains(topMost) || confirm === topMost).toBe(true)
  },
}
