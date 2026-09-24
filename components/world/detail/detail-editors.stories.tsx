import { zodResolver } from '@hookform/resolvers/zod'
import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { View } from 'react-native'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import type { Entity } from '@/lib/db'
import { characterDraftFrom, characterDraftSchema, type CharacterDraft } from '@/lib/world'

import { itemPositionHint } from '../world-copy'
import { EntityRefList } from './entity-ref-list'
import { RelationshipsEditor } from './relationships-editor'
import { StackablesEditor } from './stackables-editor'

const WAIT = { timeout: 3000 }
const BLOCKED_REASON = 'Generation is in flight. Cancel to edit.'

// Stories fall under the lib public-API rule, so the unit fixtures' makeEntity is out of reach.
function makeEntity(overrides: Partial<Entity> & Pick<Entity, 'id' | 'kind' | 'name'>): Entity {
  return {
    branchId: 'br_1',
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
    ...overrides,
  }
}

const ENTITIES: Entity[] = [
  makeEntity({ id: 'char_kael', kind: 'character', name: 'Kael' }),
  makeEntity({ id: 'char_mira', kind: 'character', name: 'Mira' }),
  makeEntity({ id: 'char_jorin', kind: 'character', name: 'Jorin' }),
  makeEntity({ id: 'char_vorne', kind: 'character', name: 'Vorne' }),
  makeEntity({ id: 'loc_keep', kind: 'location', name: 'The River Keep' }),
  makeEntity({
    id: 'item_key',
    kind: 'item',
    name: 'Old key',
    state: { at_location_id: 'loc_keep' },
  }),
  makeEntity({
    id: 'item_blade',
    kind: 'item',
    name: 'Courier’s Blade',
    state: { at_location_id: null },
  }),
]

const THREE_STATES: CharacterDraft['relationships'] = [
  { cardKey: 'rel_mira', otherId: 'char_mira', selfToOther: 'ally', otherToSelf: 'ally' },
  { cardKey: 'rel_jorin', otherId: 'char_jorin', selfToOther: 'mentor', otherToSelf: '' },
  { cardKey: 'rel_vorne', otherId: 'char_vorne', selfToOther: '', otherToSelf: 'rival' },
]

type HarnessProps = {
  editor: 'relationships' | 'stackables' | 'carrying'
  relationships?: CharacterDraft['relationships']
  stackables?: CharacterDraft['stackables']
  blocked?: boolean
}

function Harness({ editor, relationships = [], stackables = [], blocked = false }: HarnessProps) {
  const form = useForm<CharacterDraft>({
    defaultValues: { ...characterDraftFrom(null, []), name: 'Kael', relationships, stackables },
    resolver: zodResolver(characterDraftSchema),
    mode: 'onChange',
  })
  const draft = useWatch({ control: form.control })
  const inventory = useWatch({ control: form.control, name: 'inventory' })
  const gate = { blocked, blockedReason: blocked ? BLOCKED_REASON : undefined }
  const [resets, setResets] = useState(0)
  return (
    <View style={{ width: 860, maxWidth: '100%' }} className="gap-4 p-4">
      {editor === 'relationships' ? (
        <RelationshipsEditor
          control={form.control}
          trigger={form.trigger}
          selfId="char_kael"
          entities={ENTITIES}
          {...gate}
        />
      ) : null}
      {editor === 'stackables' ? (
        <StackablesEditor control={form.control} trigger={form.trigger} {...gate} />
      ) : null}
      {editor === 'carrying' ? (
        <EntityRefList
          value={inventory}
          onChange={(next) => form.setValue('inventory', next, { shouldDirty: true })}
          entities={ENTITIES}
          excludeIds={[]}
          rowHint={(item) => itemPositionHint(item, ENTITIES, 'char_kael')}
          testID="carried"
          {...gate}
        />
      ) : null}
      {/* Reset is the save session's rebase; Discard returns to the committed values. */}
      <View className="flex-row gap-2">
        <Button
          variant="secondary"
          size="sm"
          onPress={() => {
            form.reset(form.getValues())
            setResets((n) => n + 1)
          }}
        >
          <Text>Reset</Text>
        </Button>
        <Button variant="secondary" size="sm" onPress={() => form.reset()}>
          <Text>Discard</Text>
        </Button>
        <Text testID="resets" size="xs" variant="muted">
          {`resets: ${resets}`}
        </Text>
      </View>
      <Text testID="draft" size="xs" variant="muted">
        {JSON.stringify({
          relationships: draft.relationships,
          stackables: draft.stackables,
          inventory: draft.inventory,
        })}
      </Text>
    </View>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'World/DetailEditors',
  component: Harness,
  parameters: { layout: 'padded' },
  args: { editor: 'relationships' },
}
export default meta
type Story = StoryObj<typeof Harness>

const draftText = () => screen.getByTestId('draft').textContent ?? ''

/** world.md → Relationships: the three perspective states, current character's view first. */
export const RelationshipStates: Story = {
  args: { relationships: THREE_STATES },
  play: async () => {
    await expect(await screen.findByText('ally · they see you: ally', {}, WAIT)).toBeVisible()
    await expect(screen.getByText('mentor · their view: not recorded')).toBeVisible()
    await expect(screen.getByText('your view: not recorded · they see you: rival')).toBeVisible()
  },
}

export const RelationshipsEmpty: Story = {
  play: async () => {
    await expect(await screen.findByText('No relationships recorded yet', {}, WAIT)).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Add relationship' })).toBeInTheDocument()
  },
}

/** A row tap expands the inline card; edits land in the draft; Delete removes the pair. */
export const RelationshipEditAndDelete: Story = {
  args: { relationships: THREE_STATES },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /^Mira/ }, WAIT))
    const card = within(screen.getByTestId('relationship-0'))
    const their = await card.findByRole('textbox', { name: 'Their view' }, WAIT)
    await userEvent.clear(their)
    await userEvent.type(their, 'wary of you')
    await waitFor(() => expect(draftText()).toContain('wary of you'), WAIT)
    await userEvent.click(card.getByRole('button', { name: 'Delete relationship with Mira' }))
    await waitFor(() => expect(draftText()).not.toContain('char_mira'), WAIT)
    await expect(screen.queryByRole('button', { name: /^Mira/ })).toBeNull()
  },
}

/** CHECK (kind IS NOT NULL OR inverse_kind IS NOT NULL): a card with no view is an issue. */
export const RelationshipAddNeedsAView: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Add relationship' }, WAIT))
    const card = within(await screen.findByTestId('relationship-0', {}, WAIT))
    await userEvent.click(await card.findByRole('button', { name: 'Character' }, WAIT))
    await userEvent.click(await screen.findByRole('option', { name: /Vorne/ }, WAIT))
    await expect(await card.findByText('Fill in at least one view.', {}, WAIT)).toBeVisible()
    await userEvent.type(card.getByRole('textbox', { name: 'Their view' }), 'rival')
    await waitFor(() => expect(card.queryByText('Fill in at least one view.')).toBeNull(), WAIT)
    await expect(draftText()).toContain('"otherId":"char_vorne"')
  },
}

export const RelationshipsBlocked: Story = {
  args: { relationships: THREE_STATES, blocked: true },
  play: async () => {
    // A disabled ListRow drops its button role (list-row.stories.tsx → DisabledDoesNotFire).
    await expect(await screen.findByText('Add relationship', {}, WAIT)).toBeVisible()
    await expect(screen.queryByRole('button', { name: 'Add relationship' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Mira/ }))
    const card = within(screen.getByTestId('relationship-0'))
    await expect(await card.findByRole('textbox', { name: 'Your view' }, WAIT)).toHaveAttribute(
      'readonly',
    )
    // A disabled IconAction is named by its gate reason (lessons-learned/disabled-iconaction-renames-itself.md).
    await expect(card.getByRole('button', { name: BLOCKED_REASON })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  },
}

/** react-hook-form regenerates every field id on reset; a committed and a new card keep their node. */
export const RelationshipCardsSurviveReset: Story = {
  args: { relationships: THREE_STATES },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /^Mira/ }, WAIT))
    const committed = screen.getByTestId('relationship-0')
    const committedView = await within(committed).findByRole(
      'textbox',
      { name: 'Their view' },
      WAIT,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add relationship' }))
    const added = await screen.findByTestId('relationship-3', {}, WAIT)
    const addedView = await within(added).findByRole('textbox', { name: 'Their view' }, WAIT)
    await userEvent.type(addedView, 'rival')
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await expect(await screen.findByText('resets: 1', {}, WAIT)).toBeInTheDocument()
    await expect(screen.getByTestId('relationship-0')).toBe(committed)
    await expect(screen.getByTestId('relationship-3')).toBe(added)
    await expect(within(committed).getByRole('textbox', { name: 'Their view' })).toBe(committedView)
    await expect(within(added).getByRole('textbox', { name: 'Their view' })).toBe(addedView)
  },
}

/** no-harmless-id-leaks: a deleted card's key is pruned, so Discard brings it back collapsed. */
export const RelationshipDeleteThenDiscardReturnsCollapsed: Story = {
  args: { relationships: THREE_STATES },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /^Mira/ }, WAIT))
    const card = within(screen.getByTestId('relationship-0'))
    await card.findByRole('textbox', { name: 'Their view' }, WAIT)
    await userEvent.click(card.getByRole('button', { name: 'Delete relationship with Mira' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Mira/ })).toBeNull(), WAIT)
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await screen.findByRole('button', { name: /^Mira/ }, WAIT)
    // The row and its card body render in one pass: once Mira is back, expansion is decided.
    await expect(
      within(screen.getByTestId('relationship-0')).queryByRole('textbox', { name: 'Their view' }),
    ).toBeNull()
  },
}

export const StackablesDuplicateKey: Story = {
  args: { editor: 'stackables', stackables: [{ key: 'Gold', count: 5 }] },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Add quantity' }, WAIT))
    const row = within(await screen.findByTestId('stackable-1', {}, WAIT))
    await userEvent.type(row.getByRole('textbox', { name: 'Quantity' }), 'gold ')
    await expect(await row.findByText('This quantity is already listed.', {}, WAIT)).toBeVisible()
    await userEvent.click(row.getByRole('button', { name: 'Remove gold' }))
    await waitFor(
      () => expect(screen.queryByText('This quantity is already listed.')).toBeNull(),
      WAIT,
    )
  },
}

const DUPLICATE = 'This quantity is already listed.'

async function addDuplicateGold() {
  await userEvent.click(await screen.findByRole('button', { name: 'Add quantity' }, WAIT))
  const second = within(await screen.findByTestId('stackable-1', {}, WAIT))
  await userEvent.type(second.getByRole('textbox', { name: 'Quantity' }), 'gold')
  await expect(await second.findByText(DUPLICATE, {}, WAIT)).toBeVisible()
  return second
}

/** The key's `deps`: renaming the first row clears the second row's duplicate. */
export const StackablesRenameClearsOtherRowsDuplicate: Story = {
  args: { editor: 'stackables', stackables: [{ key: 'Gold', count: 5 }] },
  play: async () => {
    const second = await addDuplicateGold()
    const firstKey = within(screen.getByTestId('stackable-0')).getByRole('textbox', {
      name: 'Quantity',
    })
    await userEvent.clear(firstKey)
    await userEvent.type(firstKey, 'Silver')
    await waitFor(() => expect(firstKey).toHaveValue('Silver'), WAIT)
    await waitFor(() => expect(second.queryByText(DUPLICATE)).toBeNull(), WAIT)
  },
}

/** The post-remove revalidation: the survivor that shifts into row 0 carries no stale duplicate. */
export const StackablesRemoveRevalidatesSurvivor: Story = {
  args: { editor: 'stackables', stackables: [{ key: 'Gold', count: 5 }] },
  play: async () => {
    await addDuplicateGold()
    await userEvent.click(
      within(screen.getByTestId('stackable-0')).getByRole('button', { name: 'Remove Gold' }),
    )
    await waitFor(() => expect(screen.queryByTestId('stackable-1')).toBeNull(), WAIT)
    const survivor = within(screen.getByTestId('stackable-0'))
    await expect(survivor.getByRole('textbox', { name: 'Quantity' })).toHaveValue('gold')
    await waitFor(() => expect(survivor.queryByText(DUPLICATE)).toBeNull(), WAIT)
  },
}

/** Decision: contradictory positions are shown, not fixed — the picker says where each item is. */
export const CarryingPickerShowsWhereabouts: Story = {
  args: { editor: 'carrying' },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Link an item' }, WAIT))
    const option = await screen.findByRole('option', { name: /Old key/ }, WAIT)
    await expect(within(option).getByText('at The River Keep')).toBeVisible()
    await userEvent.click(option)
    await waitFor(() => expect(draftText()).toContain('item_key'), WAIT)
    await userEvent.click(screen.getByRole('button', { name: 'Remove Old key' }))
    await waitFor(() => expect(draftText()).not.toContain('item_key'), WAIT)
  },
}
