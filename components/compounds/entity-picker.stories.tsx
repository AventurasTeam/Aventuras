import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import { Text } from '@/components/ui/text'
import type { Entity } from '@/lib/db'

import { EntityPicker } from './entity-picker'

function entity(id: string, kind: Entity['kind'], name: string): Entity {
  return {
    id,
    branchId: 'br_1',
    kind,
    name,
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: 0,
    state: null,
    tags: [],
    keywords: [],
    priority: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

const ENTITIES = [
  entity('char_kael', 'character', 'Kael'),
  entity('char_mira', 'character', 'Mira'),
  entity('loc_market', 'location', 'Night Market'),
  entity('fac_watch', 'faction', 'The Watch'),
]

// Two rows sharing a display name with distinct ids — proves `onChange` commits
// `row.data.id`, not `row.data.name` (a name-keyed value would collide).
const SAME_NAME_ENTITIES = [
  entity('char_kael_a', 'character', 'Kael'),
  entity('char_kael_b', 'character', 'Kael'),
]

function Harness(props: {
  kinds: Entity['kind'][]
  excludeIds?: string[]
  disabled?: boolean
  entities?: Entity[]
  initialValue?: string | null
}) {
  const [value, setValue] = useState<string | null>(props.initialValue ?? null)
  return (
    <View style={{ width: 360 }} className="gap-2 p-4">
      <EntityPicker
        value={value}
        onChange={setValue}
        entities={props.entities ?? ENTITIES}
        kinds={props.kinds}
        excludeIds={props.excludeIds}
        label="Entity"
        placeholder="Pick an entity"
        disabled={props.disabled}
        disabledReason={props.disabled ? 'Generation is in flight. Cancel to edit.' : undefined}
        testID="picker"
      />
      <Text testID="picker-value" size="xs" variant="muted">
        value: {value ?? 'null'}
      </Text>
    </View>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Compounds/EntityPicker',
  component: Harness,
  parameters: { layout: 'padded' },
  args: { kinds: ['character', 'location', 'item', 'faction'] },
}
export default meta
type Story = StoryObj<typeof Harness>

export const AllKinds: Story = {
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    await expect(screen.getByRole('option', { name: /Night Market/ })).toBeVisible()
    await userEvent.click(screen.getByRole('option', { name: /Mira/ }))
    await waitFor(async () => {
      await expect(screen.getByTestId('picker')).toHaveTextContent('Mira')
    })
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    await expect(screen.getByTestId('picker')).toHaveTextContent('Pick an entity')
  },
}

export const CharactersOnlyExcluding: Story = {
  args: { kinds: ['character'], excludeIds: ['char_kael'] },
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    await expect(screen.getByRole('option', { name: /Mira/ })).toBeVisible()
    await expect(screen.queryByRole('option', { name: /Kael/ })).not.toBeInTheDocument()
    await expect(screen.queryByRole('option', { name: /Night Market/ })).not.toBeInTheDocument()
  },
}

// `excludeIds` hides a row everywhere except when it's the field's own committed
// value — otherwise setting the field, then reopening the overlay, would make the
// current value look unrecoverable (present in the trigger, absent from the list).
export const ExcludedIdIsCurrentValueStaysListed: Story = {
  args: { kinds: ['character'], excludeIds: ['char_kael'], initialValue: 'char_kael' },
  play: async () => {
    await expect(screen.getByTestId('picker')).toHaveTextContent('Kael')
    await userEvent.click(screen.getByTestId('picker'))
    await expect(screen.getByRole('option', { name: /Kael/ })).toBeVisible()
  },
}

export const SameNameDistinctIds: Story = {
  args: { kinds: ['character'], entities: SAME_NAME_ENTITIES },
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    const rows = screen.getAllByRole('option', { name: /Kael/ })
    await expect(rows).toHaveLength(2)
    // Sort is stable — the second listed row is `char_kael_b`.
    await userEvent.click(rows[1]!)
    await waitFor(async () => {
      await expect(screen.getByTestId('picker-value')).toHaveTextContent('char_kael_b')
    })
    await expect(screen.getByTestId('picker-value')).not.toHaveTextContent('char_kael_a')
  },
}

export const Disabled: Story = {
  args: { kinds: ['character'], disabled: true },
  play: async () => {
    await expect(screen.getByTitle('Generation is in flight. Cancel to edit.')).toBeInTheDocument()
  },
}
