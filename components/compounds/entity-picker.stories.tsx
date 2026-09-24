import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { Text } from '@/components/ui/text'
import type { Entity } from '@/lib/db'
import { t } from '@/lib/i18n'

import { EntityPicker } from './entity-picker'

function entity(
  id: string,
  kind: Entity['kind'],
  name: string,
  status: Entity['status'] = 'active',
): Entity {
  return {
    id,
    branchId: 'br_1',
    kind,
    name,
    description: null,
    status,
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

const STATUS_ENTITIES = [
  entity('char_staged', 'character', 'Staged Kid', 'staged'),
  entity('char_retired', 'character', 'Retired Vet', 'retired'),
  entity('char_active', 'character', 'Active Ace', 'active'),
]

// Zero-padded so name order matches index order.
const MANY_CHARACTERS = Array.from({ length: 60 }, (_, i) =>
  entity(`char_${i}`, 'character', `Character ${String(i).padStart(2, '0')}`),
)

const LONG_NAME = 'Kaelthorne Windrider of the Nine Hollow Vales and the Salt-Ash Coastline'
const LONG_NAME_ENTITIES = [entity('char_long', 'character', LONG_NAME)]

function Harness(props: {
  kinds: Entity['kind'][]
  excludeIds?: string[]
  disabled?: boolean
  entities?: Entity[]
  initialValue?: string | null
  rowHint?: (e: Entity) => string | undefined
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
        rowHint={props.rowHint}
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
    // The clear button stays mounted but must leave the accessibility tree
    // entirely while there's nothing to clear — not just visually hidden.
    await expect(screen.queryAllByRole('button', { name: t('picker.clear') })).toHaveLength(0)

    await userEvent.click(screen.getByTestId('picker'))
    await expect(await screen.findByRole('option', { name: /Night Market/ })).toBeVisible()
    await userEvent.click(screen.getByRole('option', { name: /Mira/ }))
    await waitFor(async () => {
      await expect(screen.getByTestId('picker')).toHaveTextContent('Mira')
    })
    // The trigger's accessible name folds the value in — a screen reader hears
    // more than just "Entity" once a value is set.
    await expect(screen.getByTestId('picker')).toHaveAccessibleName(
      t('picker.fieldLabel', { label: 'Entity', value: 'Mira' }),
    )
    await userEvent.click(screen.getByRole('button', { name: t('picker.clear') }))
    await expect(screen.getByTestId('picker')).toHaveTextContent('Pick an entity')
    await expect(screen.getByTestId('picker')).toHaveAccessibleName('Entity')
  },
}

export const CharactersOnlyExcluding: Story = {
  args: { kinds: ['character'], excludeIds: ['char_kael'] },
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    await expect(await screen.findByRole('option', { name: /Mira/ })).toBeVisible()
    await expect(screen.queryByRole('option', { name: /Kael/ })).not.toBeInTheDocument()
    await expect(screen.queryByRole('option', { name: /Night Market/ })).not.toBeInTheDocument()
  },
}

// `excludeIds` hides a row everywhere except when it's the field's own committed value —
// otherwise the value would look unrecoverable: present in the trigger, absent from the list.
export const ExcludedIdIsCurrentValueStaysListed: Story = {
  args: { kinds: ['character'], excludeIds: ['char_kael'], initialValue: 'char_kael' },
  play: async () => {
    await expect(screen.getByTestId('picker')).toHaveTextContent('Kael')
    await userEvent.click(screen.getByTestId('picker'))
    await expect(await screen.findByRole('option', { name: /Kael/ })).toBeVisible()
  },
}

export const SameNameDistinctIds: Story = {
  args: { kinds: ['character'], entities: SAME_NAME_ENTITIES },
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    const rows = await screen.findAllByRole('option', { name: /Kael/ })
    await expect(rows).toHaveLength(2)
    // collate/createdAt tie, then id order — the second listed row is `char_kael_b`.
    await userEvent.click(rows[1]!)
    await waitFor(async () => {
      await expect(screen.getByTestId('picker-value')).toHaveTextContent('char_kael_b')
    })
    await expect(screen.getByTestId('picker-value')).not.toHaveTextContent('char_kael_a')
  },
}

// The asChild Slot composes ref/handlers onto PickerField's top-level props — a broken
// composition shows as an unanchored popover, a dead trigger click, or stranded focus after a pick.
export const TriggerAnchoringFocusAndToggle: Story = {
  play: async () => {
    const trigger = screen.getByTestId('picker')
    await userEvent.click(trigger)
    // aria-haspopup/aria-expanded live in PickerField's `...rest` spread, not named props —
    // a dropped spread leaves every other assertion in this play green while these vanish.
    await waitFor(async () => {
      await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
      await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    })
    // Named: the substrate nests a second, unlabeled `role="dialog"` (the Radix
    // positioning wrapper) around SOL's own labeled one.
    const dialog = await screen.findByRole('dialog', { name: 'Entity' })
    const triggerRect = trigger.getBoundingClientRect()
    const dialogRect = dialog.getBoundingClientRect()
    await expect(dialogRect.top).toBeGreaterThanOrEqual(triggerRect.bottom)

    await userEvent.click(await screen.findByRole('option', { name: /Mira/ }))
    await waitFor(async () => {
      await expect(trigger).toHaveTextContent('Mira')
    })
    await waitFor(async () => {
      await expect(trigger).toHaveFocus()
    })

    await userEvent.click(trigger)
    await screen.findByRole('dialog', { name: 'Entity' })
    await userEvent.click(trigger)
    await waitFor(async () => {
      await expect(screen.queryByRole('dialog', { name: 'Entity' })).not.toBeInTheDocument()
    })
    await waitFor(async () => {
      await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    })
  },
}

export const SearchFilters: Story = {
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    await screen.findAllByRole('option')
    const search = screen.getByPlaceholderText(t('picker.entitySearch'))

    await userEvent.type(search, '  NIGHT')
    await waitFor(async () => {
      await expect(screen.getAllByRole('option')).toHaveLength(1)
    })
    await expect(screen.getByRole('option', { name: /Night Market/ })).toBeVisible()

    await userEvent.clear(search)
    await userEvent.type(search, 'zzz-no-such-entity')
    await waitFor(async () => {
      await expect(screen.getByText(t('picker.entityNoResults'))).toBeInTheDocument()
    })
  },
}

// The current value opens scrolled into view, not at the top of a long list.
export const OpensScrolledToValue: Story = {
  args: { kinds: ['character'], entities: MANY_CHARACTERS, initialValue: 'char_50' },
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    await waitFor(
      async () => {
        const listbox = screen.getByRole('listbox')
        const row = screen.getByRole('option', { name: /Character 50/ })
        const box = listbox.getBoundingClientRect()
        const rect = row.getBoundingClientRect()
        await expect(rect.top).toBeGreaterThanOrEqual(box.top)
        await expect(rect.bottom).toBeLessThanOrEqual(box.bottom)
      },
      { timeout: 5000 },
    )
  },
}

export const NoEntitiesAvailable: Story = {
  args: { kinds: ['character'], entities: [] },
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    await expect(await screen.findByText(t('picker.entityNone'))).toBeInTheDocument()
  },
}

export const LongNameStaysWithinField: Story = {
  args: { kinds: ['character'], entities: LONG_NAME_ENTITIES, initialValue: 'char_long' },
  play: async () => {
    const trigger = screen.getByTestId('picker')
    const triggerRect = trigger.getBoundingClientRect()
    const valueRect = screen.getByText(LONG_NAME).getBoundingClientRect()
    await expect(valueRect.right).toBeLessThanOrEqual(triggerRect.right)
  },
}

export const DanglingValueShowsMissingEntity: Story = {
  args: { kinds: ['character'], initialValue: 'char_ghost' },
  play: async () => {
    const trigger = screen.getByTestId('picker')
    await expect(trigger).toHaveTextContent(t('picker.entityMissing'))
    const clearButton = screen.getByRole('button', { name: t('picker.clear') })
    await expect(clearButton).toBeEnabled()
    await userEvent.click(clearButton)
    await waitFor(async () => {
      await expect(trigger).toHaveTextContent('Pick an entity')
    })
    // The × stays mounted (hidden, not unmounted) precisely so this keeps working —
    // an unmount-on-clear would strand focus on document.body.
    await waitFor(async () => {
      await expect(trigger).toHaveFocus()
    })
  },
}

export const NonActiveStatusTags: Story = {
  args: { kinds: ['character'], entities: STATUS_ENTITIES },
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    await screen.findAllByRole('option')
    const staged = screen.getByRole('option', { name: /Staged Kid/ })
    const retired = screen.getByRole('option', { name: /Retired Vet/ })
    const active = screen.getByRole('option', { name: /Active Ace/ })
    await expect(within(staged).getByText(t('world:status.staged'))).toBeInTheDocument()
    await expect(within(retired).getByText(t('world:status.retired'))).toBeInTheDocument()
    await expect(within(active).queryByText(t('world:status.active'))).not.toBeInTheDocument()

    // data-model.md → Lifecycle on retirement: the trigger badges a non-active
    // selection too, not just the row it was picked from.
    await userEvent.click(staged)
    const trigger = screen.getByTestId('picker')
    await waitFor(async () => {
      await expect(within(trigger).getByText(t('world:status.staged'))).toBeInTheDocument()
    })
  },
}

export const RowHint: Story = {
  args: {
    kinds: ['character', 'location', 'item', 'faction'],
    rowHint: (e: Entity) => (e.kind === 'location' ? `at the edge of ${e.name}` : undefined),
  },
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    const option = await screen.findByRole('option', { name: /Night Market/ })
    await expect(within(option).getByText('at the edge of Night Market')).toBeVisible()
    await expect(
      within(screen.getByRole('option', { name: /Mira/ })).queryByText(/at the edge/),
    ).toBeNull()
  },
}

export const Disabled: Story = {
  args: { kinds: ['character'], disabled: true },
  play: async () => {
    const trigger = screen.getByTestId('picker')
    await expect(trigger).toBeDisabled()
    await expect(screen.getByTitle('Generation is in flight. Cancel to edit.')).toBeInTheDocument()
    await userEvent.click(trigger, { pointerEventsCheck: 0 })
    await expect(screen.queryByRole('dialog', { name: 'Entity' })).not.toBeInTheDocument()
  },
}

// F2 flips `disabled` via a capture-phase document listener, not a button click — Radix's
// outside-click dismissal would also close the popover, masking whether the disabled effect ran.
function DisableToggleHarness() {
  const [disabled, setDisabled] = useState(false)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') setDisabled((prev) => !prev)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])
  return (
    <View style={{ width: 360 }} className="p-4">
      <EntityPicker
        value={null}
        onChange={() => undefined}
        entities={ENTITIES}
        kinds={['character']}
        label="Entity"
        placeholder="Pick an entity"
        disabled={disabled}
        disabledReason={disabled ? 'Generation is in flight. Cancel to edit.' : undefined}
        testID="picker"
      />
    </View>
  )
}

export const ClosesWhenDisabled: Story = {
  render: () => <DisableToggleHarness />,
  play: async () => {
    await userEvent.click(screen.getByTestId('picker'))
    await screen.findByRole('dialog', { name: 'Entity' })

    await userEvent.keyboard('{F2}')
    await waitFor(async () => {
      await expect(screen.queryByRole('dialog', { name: 'Entity' })).not.toBeInTheDocument()
    })

    await userEvent.keyboard('{F2}')
    await userEvent.click(screen.getByTestId('picker'))
    await expect(await screen.findByRole('dialog', { name: 'Entity' })).toBeVisible()
  },
}
