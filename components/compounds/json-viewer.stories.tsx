import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'

import { JSONViewer } from './json-viewer'

// JSONViewer is controlled — open state lives outside it. Stories
// pair it with a Trigger button that toggles open. The button stays
// in-frame so the docs reader sees the affordance even before
// clicking it.
type Args = React.ComponentProps<typeof JSONViewer>

function JSONViewerHarness({
  initialOpen = false,
  ...args
}: Omit<Args, 'open' | 'onOpenChange'> & { initialOpen?: boolean }) {
  const [open, setOpen] = React.useState(initialOpen)
  return (
    <View className="items-start gap-3 p-6">
      <Button onPress={() => setOpen(true)}>
        <Text>View raw JSON</Text>
      </Button>
      <Text variant="muted" size="xs">
        {open ? 'Drawer open — press × / Esc / overlay to close.' : 'Drawer closed.'}
      </Text>
      <JSONViewer {...args} open={open} onOpenChange={setOpen} />
    </View>
  )
}

const meta: Meta<typeof JSONViewer> = {
  title: 'Compounds/JSONViewer',
  component: JSONViewer,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof JSONViewer>

const ENTITY_SHAPE = {
  id: 'ent_01HXYZ',
  kind: 'character',
  name: 'Aventuras',
  state: {
    description: 'Apprentice swordsmith haunted by an unfinished blade.',
    visual: { hair: 'Black, shoulder-length, often pinned back.' },
    traits: ['Patient', 'Anxious in crowds', 'Fluent in Old Yamato'],
  },
  awareness: { knowsAbout: ['ent_02ABC', 'ent_03DEF'] },
  classified_at: '2026-04-30T11:42:01Z',
}

const HAPPENING_SHAPE = {
  id: 'hap_03QWE',
  thread_id: 'thr_01ASD',
  summary: 'Mira tests the new blade in the courtyard.',
  involvements: [
    { entity_id: 'ent_01HXYZ', role: 'actor' },
    { entity_id: 'ent_02ABC', role: 'observer' },
  ],
  awareness_summary: { discovered: [], reinforced: ['ent_02ABC'] },
}

/**
 * Standard entity row — the canonical shape (id, kind, state,
 * awareness, timestamps merged).
 */
export const EntityShape: Story = {
  render: () => <JSONViewerHarness name="Mira (character)" data={ENTITY_SHAPE} initialOpen />,
}

/**
 * Happening shape — the spec calls out "happening row + involvements
 * + awareness summary" as the merged shape. Same drawer.
 */
export const HappeningShape: Story = {
  render: () => (
    <JSONViewerHarness name="hap_03QWE — courtyard test" data={HAPPENING_SHAPE} initialOpen />
  ),
}

/**
 * Empty object — `{}`. Drawer still renders chrome cleanly.
 */
export const EmptyObject: Story = {
  render: () => <JSONViewerHarness name="empty.json" data={{}} initialOpen />,
}

/**
 * Long row name — truncates with ellipsis at the drawer's width
 * rather than wrapping or pushing the action buttons off-row.
 */
export const LongName: Story = {
  render: () => (
    <JSONViewerHarness
      name="A character with a comically long name that exceeds the drawer width comfortably"
      data={ENTITY_SHAPE}
      initialOpen
    />
  ),
}

/**
 * Large blob — exercises the body's vertical scrolling. Header +
 * footer stay pinned; body scrolls.
 */
export const LargeBlob: Story = {
  render: () => {
    const data = {
      story_id: 'stry_01',
      seed: 'A long-running serial about a quiet swordsmith.',
      entries: Array.from({ length: 60 }, (_, i) => ({
        id: `ent_${String(i).padStart(3, '0')}`,
        ts: `2026-04-${String((i % 28) + 1).padStart(2, '0')}T08:00:00Z`,
        text: `Entry ${i + 1} — short narration line for scroll testing.`,
      })),
    }
    return <JSONViewerHarness name="story export" data={data} initialOpen />
  },
}

/**
 * Closed by default — exercises the trigger affordance and the
 * mount/unmount lifecycle (drawer not rendered while closed).
 */
export const ClosedByDefault: Story = {
  render: () => <JSONViewerHarness name="Mira (character)" data={ENTITY_SHAPE} />,
}

export const TriggerOpensDrawer: Story = {
  render: () => <JSONViewerHarness name="Mira (character)" data={ENTITY_SHAPE} />,
  play: async () => {
    const trigger = screen.getByRole('button', { name: 'View raw JSON' })
    await userEvent.click(trigger)
    // The close × is only present while the drawer is mounted —
    // a more specific assertion than `getByText(/Raw JSON/)`,
    // which matches both the sr-only DialogTitle and the visible
    // split-text header.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close raw JSON viewer' })).toBeInTheDocument(),
    )
  },
}

export const CloseButtonDismisses: Story = {
  render: () => <JSONViewerHarness name="Mira (character)" data={ENTITY_SHAPE} initialOpen />,
  play: async () => {
    const close = screen.getByRole('button', { name: 'Close raw JSON viewer' })
    await userEvent.click(close)
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Close raw JSON viewer' }),
      ).not.toBeInTheDocument(),
    )
  },
}

export const RendersFormattedJSON: Story = {
  render: () => <JSONViewerHarness name="snippet" data={{ alpha: 1, beta: 'two' }} initialOpen />,
}

export const CopyButtonInvokesClipboard: Story = {
  render: () => <JSONViewerHarness name="snippet" data={{ alpha: 1, beta: 'two' }} initialOpen />,
  play: async () => {
    // Stash and stub the clipboard so the test asserts behavior
    // without depending on the test runner's permissions API.
    const originalWrite = navigator.clipboard?.writeText
    const writeText = fn((_text: string) => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const copy = screen.getByRole('button', { name: /Copy/ })
    await userEvent.click(copy)
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const written = writeText.mock.calls[0]?.[0] ?? ''
    expect(written).toContain('"alpha": 1')
    expect(written).toContain('"beta": "two"')

    if (originalWrite) {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: originalWrite },
        configurable: true,
      })
    }
  },
}
