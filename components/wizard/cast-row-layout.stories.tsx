import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { cssInterop } from 'nativewind'
import { View } from 'react-native'
import { expect, screen, within } from 'storybook/test'

import { emptyCastDraft, type WizardCharacterDraft } from '@/lib/db'
import { wizardStore } from '@/lib/stores'

import { CharacterEditor } from './cast-editors'

// `react-native-css-interop` skips component registration when NODE_ENV is 'test', so every
// className is inert in vitest; registering View is the documented escape hatch, scoped here.
cssInterop(View, { className: 'style' })

const ROW: WizardCharacterDraft = {
  ...emptyCastDraft('character', 'char_layout'),
  name: 'Aria Stoneheart',
}

// Explicit pixel widths, never a className: the container has to be real even
// if a future harness change makes the registration above a no-op again.
function Harness({ width }: { width: number }) {
  return (
    <View
      style={{ width }}
      // @ts-expect-error — dataSet is RN-Web only; not in RN's View type.
      dataSet={{ probe: 'container' }}
    >
      <CharacterEditor row={ROW} invalid={false} cast={[ROW]} leadEntityId={null} />
    </View>
  )
}

const meta: Meta<typeof CharacterEditor> = {
  title: 'Compounds/Wizard/CastRowLayout',
  component: CharacterEditor,
  parameters: { layout: 'centered' },
  beforeEach: () => {
    wizardStore.reset()
    wizardStore.hydrate({ ...wizardStore.getWizard().state, cast: [ROW] })
  },
}

export default meta
type Story = StoryObj<typeof CharacterEditor>

function measure() {
  const container = document.querySelector('[data-probe="container"]') as HTMLElement
  const scope = within(container)
  const name = scope.getByLabelText('Name').getBoundingClientRect().width
  const status = scope.getByRole('radiogroup', { name: 'Status' }).getBoundingClientRect().width
  return { container: container.getBoundingClientRect().width, name, status }
}

/**
 * Regression for the `w-full` starvation: FormRow's root claimed 100 % of the
 * row and RN's `flexShrink: 0` kept it there, collapsing the flex-1 name field
 * to a one-character column (measured width 0 here).
 */
export const NameKeepsItsColumnBesideStatus: Story = {
  render: () => <Harness width={720} />,
  play: async () => {
    await screen.findByLabelText('Name')
    const { container, name, status } = measure()
    expect(container).toBe(720)
    // The status column sizes to its two segments; the name takes the rest.
    expect(status).toBeGreaterThan(60)
    expect(status).toBeLessThan(container / 2)
    expect(name).toBeGreaterThan(status)
    expect(name + status).toBeLessThanOrEqual(container)
  },
}

/** Narrow container: the name column shrinks but must never reach zero. */
export const NameSurvivesANarrowContainer: Story = {
  render: () => <Harness width={360} />,
  play: async () => {
    await screen.findByLabelText('Name')
    const { container, name, status } = measure()
    expect(container).toBe(360)
    expect(name).toBeGreaterThan(100)
    expect(name + status).toBeLessThanOrEqual(container)
  },
}

/**
 * Wide container: both fields stay stacked. Left to auto-derive, only the name
 * clears FormRow's 640 px threshold and carves out a 180 px label column, which
 * puts two label treatments side by side in one visual row — the carve-out is
 * what this measures.
 */
export const WideContainerKeepsBothFieldsStacked: Story = {
  render: () => <Harness width={1400} />,
  play: async () => {
    await screen.findByLabelText('Name')
    const { container, name, status } = measure()
    expect(container).toBe(1400)
    // Bound status independently: every term on the right below is derived from
    // the same measurement, so a collapsed status would satisfy it trivially.
    expect(status).toBeLessThan(container / 2)
    expect(name).toBeGreaterThan(container - status - 40)
  },
}
