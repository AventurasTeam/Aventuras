import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import type { EntitySaveResult } from '@/lib/actions'
import { EARTH_GREGORIAN } from '@/lib/calendar'
import type { CharacterState, Entity, EntityKind } from '@/lib/db'
import type { EntryIndex, EntryRef } from '@/lib/entry-refs'
import type { EntitySaveInput, RelationshipLink } from '@/lib/world'

import type { EntityInvolvement } from '../world-route-data'
import { EntityDetailPane } from './entity-detail-pane'
import type { EntityPaneData } from './entity-pane-props'

const WAIT = { timeout: 3000 }
const DAY = 86_400
const BLOCKED_REASON = 'Generation is in flight. Cancel to edit.'
const PARENT_CYCLE_TEXT = 'That parent would make this location part of itself.'

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

const characterState = (over: Partial<CharacterState> = {}): CharacterState => ({
  visual: { physique: 'lean', hair: 'dark' },
  traits: ['resourceful', 'wary'],
  drives: ['understand the amulet'],
  current_location_id: 'loc_market',
  equipped_items: ['item_blade'],
  inventory: ['item_amulet', 'item_key'],
  stackables: { gold: 200, silver: 30, rations: 7 },
  faction_id: 'fac_watch',
  lastSeenAt: { entryId: 'e_47', locationId: 'loc_market', worldTime: 1000 },
  ...over,
})
// Nowhere in particular, carrying nothing: a derivation that over-matches shows an extra name.
const bystander = (over: Partial<CharacterState> = {}): CharacterState =>
  characterState({
    current_location_id: null,
    equipped_items: [],
    inventory: [],
    stackables: undefined,
    faction_id: null,
    ...over,
  })

const KAEL = makeEntity({
  id: 'char_kael',
  kind: 'character',
  name: 'Kael',
  description: 'A courier turned fugitive.',
  injectionMode: 'always',
  tags: ['protagonist'],
  state: characterState(),
})
const MIRA = makeEntity({
  id: 'char_mira',
  kind: 'character',
  name: 'Mira',
  state: bystander({ current_location_id: 'loc_hollow' }),
})
const VORNE = makeEntity({
  id: 'char_vorne',
  kind: 'character',
  name: 'Vorne',
  state: bystander(),
})
const SAGE = makeEntity({
  id: 'char_sage',
  kind: 'character',
  name: 'The Ashen Sage',
  status: 'staged',
  state: bystander({ lastSeenAt: null }),
})
const RETIRED = makeEntity({
  id: 'char_brannoc',
  kind: 'character',
  name: 'Brannoc',
  status: 'retired',
  retiredReason: 'killed by Vorne',
  state: bystander(),
})
const HOLLOW = makeEntity({
  id: 'loc_hollow',
  kind: 'location',
  name: 'Veil’s Hollow',
  state: { parent_location_id: null },
})
const MARKET = makeEntity({
  id: 'loc_market',
  kind: 'location',
  name: 'The Drowned Market',
  state: { parent_location_id: 'loc_hollow', condition: 'fire-scarred' },
})
const BLADE = makeEntity({
  id: 'item_blade',
  kind: 'item',
  name: 'Courier’s Blade',
  state: { at_location_id: null },
})
const AMULET = makeEntity({
  id: 'item_amulet',
  kind: 'item',
  name: 'The Veilstone Amulet',
  state: { at_location_id: null },
})
const KEY = makeEntity({
  id: 'item_key',
  kind: 'item',
  name: 'Old key',
  state: { at_location_id: 'loc_market' },
})
const WATCH = makeEntity({
  id: 'fac_watch',
  kind: 'faction',
  name: 'The City Watch',
  state: { standing: 'wary allies', agenda: ['keep the peace'] },
})
const ENTITIES = [KAEL, MIRA, VORNE, SAGE, RETIRED, HOLLOW, MARKET, BLADE, AMULET, KEY, WATCH]

const MIRA_LINK: RelationshipLink = {
  rowId: 'rel_1',
  otherId: 'char_mira',
  selfToOther: 'ally',
  otherToSelf: 'ally',
}
const VORNE_LINK: RelationshipLink = {
  rowId: 'rel_2',
  otherId: 'char_vorne',
  selfToOther: null,
  otherToSelf: 'rival',
}
const KAEL_LINKS: RelationshipLink[] = [MIRA_LINK, VORNE_LINK]
const NO_LINKS: RelationshipLink[] = []
const KAEL_INVOLVEMENTS: EntityInvolvement[] = [
  { id: 'hinv_1', happeningId: 'hap_fire', title: 'The market fire', role: 'witness' },
]
const NO_INVOLVEMENTS: EntityInvolvement[] = []
const ENTRY_INDEX: EntryIndex = new Map(
  [47].map((position): [string, EntryRef] => [
    `e_${position}`,
    { id: `e_${position}`, position, kind: 'ai_reply', chapterId: null, excerpt: 'Entry 47' },
  ]),
)

type HarnessProps = {
  kind: EntityKind
  row: Entity | null
  blocked?: boolean
  leadId?: string | null
  saveResult?: EntitySaveResult
  /** The row's stored links; Kael's by default. */
  links?: RelationshipLink[]
  /** A pair the harness's button writes to the store, as the periodic classifier would. */
  storeLink?: RelationshipLink
  onSave: (input: EntitySaveInput) => void
  onSaved: (id: string) => void
  onRejected: (reason: string) => void
  onOpenEntity: (id: string) => void
  onOpenHappening: (id: string) => void
  onSetLead: (id: string) => void
}

/** Route-shaped: create selects the saved row; capture-phase F2 flips `blocked` (run starting). */
function Harness({
  kind,
  row: initialRow,
  blocked: initialBlocked = false,
  leadId = 'char_kael',
  saveResult,
  links: initialLinks,
  storeLink,
  onSave,
  onSaved,
  onRejected,
  onOpenEntity,
  onOpenHappening,
  onSetLead,
}: HarnessProps) {
  const [row, setRow] = useState(initialRow)
  const [blocked, setBlocked] = useState(initialBlocked)
  const [links, setLinks] = useState(initialLinks)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') setBlocked((prev) => !prev)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])
  const data = useMemo<EntityPaneData>(
    () => ({
      entities: ENTITIES,
      relationships: links ?? (row?.id === 'char_kael' ? KAEL_LINKS : NO_LINKS),
      involvements: row?.id === 'char_kael' ? KAEL_INVOLVEMENTS : NO_INVOLVEMENTS,
      entryIndex: ENTRY_INDEX,
      worldTime: 1000 + 2 * DAY,
      calendar: EARTH_GREGORIAN,
      leadId,
    }),
    [row, links, leadId],
  )
  const save = useCallback(
    async (input: EntitySaveInput): Promise<EntitySaveResult> => {
      onSave(input)
      return saveResult ?? { status: 'ok', id: row?.id ?? `${kind}_new` }
    },
    [onSave, saveResult, row, kind],
  )
  const selectSaved = useCallback(
    (id: string) => {
      onSaved(id)
      if (row == null) setRow(makeEntity({ id, kind, name: 'Saved' }))
    },
    [onSaved, row, kind],
  )
  return (
    <View className="gap-2">
      <View style={{ width: 900, maxWidth: '100%', height: 760 }} className="border border-border">
        <EntityDetailPane
          kind={kind}
          row={row}
          data={data}
          blocked={blocked}
          blockedReason={BLOCKED_REASON}
          onSave={save}
          onSaved={selectSaved}
          onRejected={onRejected}
          onSession={() => {}}
          onOpenEntity={onOpenEntity}
          onOpenHappening={onOpenHappening}
          onSetLead={onSetLead}
        />
      </View>
      {storeLink != null ? (
        <View className="flex-row items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onPress={() => setLinks((prev) => [...(prev ?? NO_LINKS), storeLink])}
          >
            <Text>Classifier writes a pair</Text>
          </Button>
          <Text size="xs" variant="muted">
            {`store pairs: ${data.relationships.length}`}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'World/EntityDetailPane',
  component: Harness,
  parameters: { layout: 'padded' },
  args: {
    kind: 'character',
    row: KAEL,
    onSave: fn(),
    onSaved: fn(),
    onRejected: fn(),
    onOpenEntity: fn(),
    onOpenHappening: fn(),
    onSetLead: fn(),
  },
}
export default meta
type Story = StoryObj<typeof Harness>

const tab = (name: RegExp) => screen.getByRole('tab', { name })
const saveBar = () => screen.getByTestId('save-bar')

/** Every field on its canon tab (world.md → Tabs — per-kind composition). */
export const CharacterFieldRouting: Story = {
  play: async () => {
    const tabs = within(await screen.findByRole('tablist', {}, WAIT)).getAllByRole('tab')
    await expect(tabs.map((t) => t.textContent?.replace(/\s*\(\d+\)|\d+$/, ''))).toEqual([
      'Overview',
      'Identity',
      'Carrying',
      'Connections',
      'Settings',
      'Assets',
      'Involvements',
      'History',
    ])
    await userEvent.click(tab(/^Identity/))
    for (const label of [
      'Description',
      'Physique',
      'Face',
      'Hair',
      'Eyes',
      'Attire',
      'Distinguishing',
      'Voice',
    ])
      await expect(await screen.findByRole('textbox', { name: label }, WAIT)).toBeVisible()
    await expect(screen.getByRole('textbox', { name: 'Hair' })).toHaveValue('dark')
    await expect(screen.getByRole('textbox', { name: 'Traits' })).toBeVisible()
    await expect(screen.getByText('understand the amulet')).toBeVisible()
    await userEvent.click(tab(/^Settings/))
    // Three short options render Select's segment on desktop: a radiogroup, not a trigger.
    await expect(await screen.findByRole('radiogroup', { name: 'Status' }, WAIT)).toBeVisible()
    await expect(screen.getByRole('radiogroup', { name: 'Injection' })).toBeVisible()
    await expect(screen.getByRole('textbox', { name: 'Retired reason' })).toHaveAttribute(
      'readonly',
    )
    await expect(screen.getByRole('textbox', { name: 'Keywords' })).toBeVisible()
    await expect(screen.getByRole('textbox', { name: 'Priority' })).toBeVisible()
    await userEvent.click(tab(/^Carrying/))
    const stackables = within(await screen.findByTestId('stackables', {}, WAIT))
    const quantities = stackables.getAllByRole('textbox', { name: 'Quantity' })
    await expect(quantities).toHaveLength(3)
    for (const [i, key] of ['gold', 'silver', 'rations'].entries())
      await expect(quantities[i]).toHaveValue(key)
    const equipped = within(screen.getByTestId('equipped'))
    await expect(equipped.getByText('Courier’s Blade')).toBeVisible()
    await expect(equipped.queryByText('Old key')).toBeNull()
    await expect(equipped.getByRole('button', { name: 'Add equipped item' })).toBeVisible()
    const carried = within(screen.getByTestId('carried'))
    await expect(carried.getByText('The Veilstone Amulet')).toBeVisible()
    await expect(carried.getByText('Old key')).toBeVisible()
    await expect(carried.getByRole('button', { name: 'Add carried item' })).toBeVisible()
    await userEvent.click(tab(/^Connections/))
    await expect(
      await screen.findByRole('button', { name: 'Current location: The Drowned Market' }, WAIT),
    ).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Faction: The City Watch' })).toBeVisible()
    await expect(screen.getByText('your view: not recorded · they see you: rival')).toBeVisible()
    await expect(screen.getByTestId('connections-last-seen')).toHaveTextContent(
      'The Drowned Market · entry #47 · 2 days ago in-world',
    )
  },
}

/** Location: no Carrying tab; Identity has condition; Connections has the parent picker. */
export const LocationFieldRouting: Story = {
  args: { kind: 'location', row: MARKET },
  play: async () => {
    await expect(
      within(await screen.findByRole('tablist', {}, WAIT)).queryByRole('tab', {
        name: /^Carrying/,
      }),
    ).toBeNull()
    await userEvent.click(tab(/^Identity/))
    await expect(await screen.findByRole('textbox', { name: 'Condition' }, WAIT)).toHaveValue(
      'fire-scarred',
    )
    await userEvent.click(tab(/^Connections/))
    await expect(
      await screen.findByRole('button', { name: 'Part of: Veil’s Hollow' }, WAIT),
    ).toBeVisible()
    await expect(screen.getByRole('link', { name: 'Kael' })).toBeVisible()
    // Mira stands in Veil’s Hollow, the Blade lies nowhere: neither belongs to the market.
    await expect(screen.queryByRole('link', { name: 'Mira' })).toBeNull()
    await expect(screen.getByRole('link', { name: 'Old key' })).toBeVisible()
    await expect(screen.queryByRole('link', { name: 'Courier’s Blade' })).toBeNull()
  },
}

export const FactionFieldRouting: Story = {
  args: { kind: 'faction', row: WATCH },
  play: async () => {
    await userEvent.click(await screen.findByRole('tab', { name: /^Identity/ }, WAIT))
    await expect(await screen.findByRole('textbox', { name: 'Standing' }, WAIT)).toHaveValue(
      'wary allies',
    )
    await expect(screen.getByRole('textbox', { name: 'Agenda' })).toBeVisible()
    await expect(screen.getByText('keep the peace')).toBeVisible()
    await userEvent.click(tab(/^Connections/))
    await expect(await screen.findByRole('link', { name: 'Kael' }, WAIT)).toBeVisible()
    await expect(screen.queryByRole('link', { name: 'Mira' })).toBeNull()
  },
}

/** retired_reason is editable only while retired; switching status keeps its text. */
export const RetiredReasonConditional: Story = {
  args: { row: RETIRED },
  play: async () => {
    await expect(await screen.findByText('— killed by Vorne', {}, WAIT)).toBeVisible()
    await userEvent.click(tab(/^Settings/))
    const reason = await screen.findByRole('textbox', { name: 'Retired reason' }, WAIT)
    await expect(reason).not.toHaveAttribute('readonly')
    const status = screen.getByRole('radiogroup', { name: 'Status' })
    await userEvent.click(within(status).getByRole('radio', { name: 'Active' }))
    await waitFor(() => expect(reason).toHaveAttribute('readonly'), WAIT)
    await expect(reason).toHaveValue('killed by Vorne')
  },
}

export const InjectionChipVisibility: Story = {
  play: async () => {
    await expect(await screen.findByText('Always injected', {}, WAIT)).toBeVisible()
  },
}

export const InjectionChipHiddenForAuto: Story = {
  args: { row: MIRA },
  play: async () => {
    await expect(await screen.findByTestId('overview-status', {}, WAIT)).toHaveTextContent(
      /^active$/,
    )
    await expect(screen.queryByText('Always injected')).not.toBeInTheDocument()
  },
}

/** Three edits across two tabs reach one Save. */
export const SaveCarriesThreeFields: Story = {
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('tab', { name: /^Identity/ }, WAIT))
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Description' }, WAIT),
      ' Wanted.',
    )
    const hair = screen.getByRole('textbox', { name: 'Hair' })
    await userEvent.clear(hair)
    await userEvent.type(hair, 'dark, rain-soaked')
    await userEvent.click(tab(/^Settings/))
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Tags' }, WAIT),
      'fugitive{Enter}',
    )
    await waitFor(() => expect(saveBar()).toHaveTextContent('3 unsaved changes'), WAIT)
    await expect(saveBar()).toHaveTextContent('Description')
    await userEvent.click(within(saveBar()).getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(args.onSave).toHaveBeenCalledTimes(1), WAIT)
    await expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'character',
        draft: expect.objectContaining({
          description: 'A courier turned fugitive. Wanted.',
          visualHair: 'dark, rain-soaked',
          tags: ['protagonist', 'fugitive'],
        }),
      }),
    )
  },
}

/** The Relationships base freezes once dirty, so Save keeps a pair the classifier writes later. */
export const RelationshipsBaseFrozenWhileDirty: Story = {
  args: { links: [MIRA_LINK], storeLink: VORNE_LINK },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('tab', { name: /^Connections/ }, WAIT))
    await userEvent.click(await screen.findByRole('button', { name: /^Mira/ }, WAIT))
    const card = within(screen.getByTestId('relationship-0'))
    const yours = await card.findByRole('textbox', { name: 'Your view' }, WAIT)
    await userEvent.clear(yours)
    await userEvent.type(yours, 'sworn ally')
    await waitFor(() => expect(saveBar()).toHaveTextContent('Relationships'), WAIT)
    await userEvent.click(screen.getByRole('button', { name: 'Classifier writes a pair' }))
    await expect(await screen.findByText('store pairs: 2', {}, WAIT)).toBeInTheDocument()
    await userEvent.click(within(saveBar()).getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(args.onSave).toHaveBeenCalledTimes(1), WAIT)
    await expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'character',
        relationshipsBase: [MIRA_LINK],
        relationships: [MIRA_LINK, VORNE_LINK],
        draft: expect.objectContaining({
          relationships: [
            expect.objectContaining({ otherId: 'char_mira', selfToOther: 'sworn ally' }),
          ],
        }),
      }),
    )
  },
}

/** `[+] Blank` on Locations: opens on Identity, no menu until saved, Save creates. */
export const CreateLocation: Story = {
  args: { kind: 'location', row: null },
  play: async ({ args }) => {
    await expect(await screen.findByRole('tab', { name: /^Identity/ }, WAIT)).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(screen.getByRole('button', { name: 'More actions' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Unnamed' }))
    await userEvent.type(
      await screen.findByPlaceholderText('Unnamed', {}, WAIT),
      'The Salt Wells{Enter}',
    )
    await userEvent.click(
      within(await screen.findByTestId('save-bar', {}, WAIT)).getByRole('button', {
        name: /^Save/,
      }),
    )
    await waitFor(() => expect(args.onSave).toHaveBeenCalledTimes(1), WAIT)
    // The whole create draft — schema defaults plus the name — so a create can't carry stray state.
    await expect(args.onSave).toHaveBeenCalledWith({
      kind: 'location',
      draft: {
        name: 'The Salt Wells',
        description: '',
        status: 'active',
        retiredReason: '',
        injectionMode: 'auto',
        keywords: [],
        tags: [],
        priority: 0,
        parentLocationId: null,
        condition: '',
      },
    })
    await waitFor(() => expect(args.onSaved).toHaveBeenCalledWith('location_new'), WAIT)
    await expect(await screen.findByRole('button', { name: 'More actions' }, WAIT)).toBeEnabled()
  },
}

/** The create form respects isUserEditBlocked. */
export const CreateBlocked: Story = {
  args: { kind: 'location', row: null, blocked: true },
  play: async () => {
    await expect(await screen.findByRole('textbox', { name: 'Description' }, WAIT)).toHaveAttribute(
      'readonly',
    )
    await expect(screen.getByRole('textbox', { name: 'Condition' })).toHaveAttribute('readonly')
    await expect(screen.queryByRole('button', { name: 'Unnamed' })).not.toBeInTheDocument()
    await userEvent.click(tab(/^Connections/))
    await expect(await screen.findByRole('button', { name: 'Part of' }, WAIT)).toBeDisabled()
  },
}

/** Every control disables with the principle-owned tooltip while a turn is in flight. */
export const EveryControlBlocked: Story = {
  args: { blocked: true },
  play: async () => {
    await userEvent.click(await screen.findByRole('tab', { name: /^Identity/ }, WAIT))
    await expect(await screen.findByRole('textbox', { name: 'Description' }, WAIT)).toHaveAttribute(
      'readonly',
    )
    await expect(screen.getByRole('textbox', { name: 'Hair' })).toHaveAttribute('readonly')
    await userEvent.click(tab(/^Settings/))
    const status = await screen.findByRole('radiogroup', { name: 'Status' }, WAIT)
    const statuses = within(status).getAllByRole('radio')
    await expect(statuses).toHaveLength(3)
    for (const option of statuses) await expect(option).toHaveAttribute('aria-disabled', 'true')
    await expect(status.closest('[title]')).toHaveAttribute('title', BLOCKED_REASON)
    await userEvent.click(tab(/^Carrying/))
    await expect(await screen.findByRole('button', { name: 'Add quantity' }, WAIT)).toBeDisabled()
    await userEvent.click(tab(/^Connections/))
    const location = await screen.findByRole('button', { name: /^Current location/ }, WAIT)
    await expect(location).toBeDisabled()
    await expect(location.closest('[title]')).toHaveAttribute('title', BLOCKED_REASON)
    // A disabled ListRow drops its button role (list-row.stories.tsx → DisabledDoesNotFire).
    await expect(screen.getByText('Add relationship')).toBeVisible()
    await expect(screen.queryByRole('button', { name: 'Add relationship' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await expect(
      await screen.findByRole('menuitem', { name: /Set as lead/ }, WAIT),
    ).toHaveAttribute('aria-disabled', 'true')
  },
}

/** A run starting mid-edit disables Save with the gate's reason; Discard stays live. */
export const BlockedWhileDirty: Story = {
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('tab', { name: /^Identity/ }, WAIT))
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Description' }, WAIT),
      ' Wanted.',
    )
    const bar = await screen.findByTestId('save-bar', {}, WAIT)
    await userEvent.keyboard('{F2}')
    await waitFor(
      () => expect(within(bar).getByRole('button', { name: /^Save/ })).toBeDisabled(),
      WAIT,
    )
    await expect(within(bar).getByRole('button', { name: BLOCKED_REASON })).toBeVisible()
    // The shortcut skips the disabled button, so the bar's own gate is what refuses it.
    await userEvent.keyboard('{Control>}s{/Control}')
    await userEvent.click(within(bar).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument(), WAIT)
    await expect(args.onSave).not.toHaveBeenCalled()
  },
}

/** The handler's parent-cycle refusal surfaces as a field error on Connections. */
export const ParentCycleFieldError: Story = {
  args: {
    kind: 'location',
    row: HOLLOW,
    saveResult: { status: 'rejected', reason: 'parent-cycle', code: 'parent-cycle' },
  },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('tab', { name: /^Connections/ }, WAIT))
    await userEvent.click(await screen.findByRole('button', { name: 'Part of' }, WAIT))
    await userEvent.click(await screen.findByRole('option', { name: /The Drowned Market/ }, WAIT))
    const bar = await screen.findByTestId('save-bar', {}, WAIT)
    await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))
    await expect(await screen.findByText(PARENT_CYCLE_TEXT, {}, WAIT)).toBeVisible()
    await expect(within(saveBar()).getByRole('button', { name: /^Save/ })).toBeDisabled()
    await expect(args.onRejected).toHaveBeenCalledWith(PARENT_CYCLE_TEXT)
  },
}

/** Set as lead (characters only), plus Export and Delete disabled with reasons. */
export const OverflowMenuForAnActiveCharacter: Story = {
  args: { row: MIRA },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }, WAIT))
    const setLead = await screen.findByRole('menuitem', { name: 'Set as lead' }, WAIT)
    // The popover fades in; the role query can outrace opacity settling.
    await waitFor(() => expect(setLead).toBeVisible(), WAIT)
    await expect(
      screen.getByRole('menuitem', { name: 'Export entity as JSON, Lands in Slice 4.6' }),
    ).toHaveAttribute('aria-disabled', 'true')
    await expect(
      screen.getByRole('menuitem', { name: 'Delete entity, Lands in Slice 4.2b' }),
    ).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(setLead)
    await expect(args.onSetLead).toHaveBeenCalledWith('char_mira')
  },
}

export const OverflowMenuLeadAndStaged: Story = {
  args: { row: SAGE },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }, WAIT))
    await expect(
      await screen.findByRole(
        'menuitem',
        { name: /Set as lead.*Only an active character can be the lead/ },
        WAIT,
      ),
    ).toHaveAttribute('aria-disabled', 'true')
  },
}

export const OverflowMenuCurrentLead: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }, WAIT))
    await expect(
      await screen.findByRole('menuitem', { name: /Set as lead.*Already the lead/ }, WAIT),
    ).toHaveAttribute('aria-disabled', 'true')
  },
}

export const OverflowMenuHasNoLeadForALocation: Story = {
  args: { kind: 'location', row: MARKET },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }, WAIT))
    const viewJson = await screen.findByRole('menuitem', { name: 'View raw JSON' }, WAIT)
    // Asserted while the menu is open, or the absence would hold trivially.
    await expect(screen.queryByRole('menuitem', { name: /Set as lead/ })).toBeNull()
    await userEvent.click(viewJson)
    const json = await screen.findByText(/"parent_location_id"/, {}, WAIT)
    await waitFor(() => expect(json).toBeVisible(), WAIT)
  },
}

/** tabs.md → overflow rule: phone hands the 8-tab list to the Select, counts carried through. */
export const PhoneSelectTabs: Story = {
  globals: { viewport: { value: 'mobile1' } },
  play: async () => {
    await waitFor(() => expect(screen.queryByRole('tablist')).toBeNull(), WAIT)
    await userEvent.click(await screen.findByRole('button', { name: 'Section' }, WAIT))
    const carrying = await screen.findByRole('option', { name: 'Carrying (6)' }, WAIT)
    await waitFor(() => expect(carrying).toBeVisible(), WAIT)
    await userEvent.click(carrying)
    await expect(await screen.findByRole('button', { name: 'Add quantity' }, WAIT)).toBeVisible()
  },
}

/** Item: an at-location picker and the derived Held by list (both shown when they disagree). */
export const ItemFieldRouting: Story = {
  args: { kind: 'item', row: KEY },
  play: async () => {
    await expect(
      within(await screen.findByRole('tablist', {}, WAIT)).queryByRole('tab', {
        name: /^Carrying/,
      }),
    ).toBeNull()
    await userEvent.click(tab(/^Connections/))
    await expect(
      await screen.findByRole('button', { name: 'At location: The Drowned Market' }, WAIT),
    ).toBeVisible()
    await expect(screen.getByRole('link', { name: 'Kael' })).toBeVisible()
    await expect(screen.queryByRole('link', { name: 'Mira' })).toBeNull()
  },
}

/** world.md → Overview: a region routes to the tab that edits it. */
export const OverviewRegionOpensItsTab: Story = {
  play: async () => {
    await userEvent.click(await screen.findByTestId('overview-visual', {}, WAIT))
    await waitFor(() => expect(tab(/^Identity/)).toHaveAttribute('aria-selected', 'true'), WAIT)
    await expect(await screen.findByRole('textbox', { name: 'Physique' }, WAIT)).toHaveValue('lean')
  },
}

/** Involvements rows are read-only and open their happening in Plot; Assets is a placeholder. */
export const InvolvementsAndPlaceholders: Story = {
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('tab', { name: /^Involvements/ }, WAIT))
    await expect(await screen.findByText('witness', {}, WAIT)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'The market fire' }))
    await expect(args.onOpenHappening).toHaveBeenCalledWith('hap_fire')
    await userEvent.click(tab(/^Assets/))
    await expect(
      await screen.findByText('Assets land with the asset gallery pass', {}, WAIT),
    ).toBeVisible()
  },
}

export const Staged: Story = { args: { row: SAGE } }
export const Sparse: Story = {
  args: { row: makeEntity({ id: 'char_new', kind: 'character', name: 'Nobody', state: null }) },
}
