import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { expect, fireEvent, fn, screen, spyOn, userEvent, waitFor, within } from 'storybook/test'

import { HistoryLoaderProvider } from '@/components/history/history-loader'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import type { EntitySaveResult } from '@/lib/actions'
import { EARTH_GREGORIAN } from '@/lib/calendar'
import type { CharacterState, Entity, EntityKind } from '@/lib/db'
import type { EntryIndex, EntryRef } from '@/lib/entry-refs'
import type { HistoryChunk } from '@/lib/history'
import { t } from '@/lib/i18n'
import { toastStore, type ToastItem } from '@/lib/toast'
import type { EntitySaveInput, RelationshipLink } from '@/lib/world'

import type { EntityInvolvement } from '../world-route-data'
import { EntityDetailPane } from './entity-detail-pane'
import type { EntityPaneData } from './entity-pane-props'

const WAIT = { timeout: 3000 }
const DAY = 86_400
const BLOCKED_REASON = 'Generation is in flight. Cancel to edit.'
const PARENT_CYCLE_TEXT = 'That parent would make this location part of itself.'
const PARENT_CHAIN_BROKEN_TEXT =
  "That parent's own chain of parents loops back or runs too deep. Fix that chain first."

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
  { id: 'hinv_2', happeningId: 'hap_fire_2', title: 'The market fire', role: null },
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
  /** A keyword the harness's button appends to the stored row, as the periodic classifier would. */
  storeKeyword?: string
  /** An ok character Save writes its pairs to the store before resolving, as the delta layer does. */
  commitLinks?: boolean
  /** Save stays pending until the harness's `Finish save` button. */
  holdSave?: boolean
  onSave: (input: EntitySaveInput) => void
  onSaved: (id: string) => void
  onRejected: (reason: string) => void
  onOpenEntity: (id: string) => void
  onOpenHappening: (id: string) => void
  onSetLead: (id: string) => void
  onDelete: (row: Entity) => void
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
  storeKeyword,
  commitLinks = false,
  holdSave = false,
  onSave,
  onSaved,
  onRejected,
  onOpenEntity,
  onOpenHappening,
  onSetLead,
  onDelete,
}: HarnessProps) {
  const [row, setRow] = useState(initialRow)
  const [blocked, setBlocked] = useState(initialBlocked)
  const [links, setLinks] = useState(initialLinks)
  const [finishSave, setFinishSave] = useState<(() => void) | null>(null)
  const [createSeq, setCreateSeq] = useState(0)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') setBlocked((prev) => !prev)
      // A `[+] Blank` of the same kind: the route clears the row and bumps the create seq.
      if (e.key === 'F4') {
        setRow(null)
        setCreateSeq((n) => n + 1)
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])
  const data = useMemo<EntityPaneData>(
    () => ({
      branchId: 'br_1',
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
      if (holdSave) await new Promise<void>((resolve) => setFinishSave(() => resolve))
      const result = saveResult ?? { status: 'ok', id: row?.id ?? `${kind}_new` }
      if (commitLinks && result.status === 'ok' && input.kind === 'character') {
        setLinks(
          input.draft.relationships.map((r) => ({
            rowId: input.relationships.find((l) => l.otherId === r.otherId)?.rowId ?? r.cardKey,
            otherId: r.otherId,
            selfToOther: r.selfToOther.trim() || null,
            otherToSelf: r.otherToSelf.trim() || null,
          })),
        )
      }
      return result
    },
    [onSave, holdSave, saveResult, row, kind, commitLinks],
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
          createSeq={row == null ? createSeq : undefined}
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
          onDelete={onDelete}
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
      {storeKeyword != null ? (
        <Button
          variant="secondary"
          size="sm"
          onPress={() =>
            setRow((prev) =>
              prev == null ? prev : { ...prev, keywords: [...prev.keywords, storeKeyword] },
            )
          }
        >
          <Text>Classifier appends a keyword</Text>
        </Button>
      ) : null}
      {holdSave ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={finishSave == null}
          onPress={() => {
            finishSave?.()
            setFinishSave(null)
          }}
        >
          <Text>Finish save</Text>
        </Button>
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
    onDelete: fn(),
  },
  // No real db loader or React Query in Storybook; History stories supply their own provider.
  decorators: [
    (Story) => (
      <HistoryLoaderProvider value={async () => ({ rows: [], nextCursor: null, names: {} })}>
        <Story />
      </HistoryLoaderProvider>
    ),
  ],
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
  play: async ({ args }) => {
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
    await userEvent.click(screen.getByRole('button', { name: 'Open Veil’s Hollow' }))
    await expect(args.onOpenEntity).toHaveBeenCalledWith('loc_hollow')
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

const editMiraView = async (name: 'Your view' | 'Their view', text: string) => {
  const view = within(screen.getByTestId('relationship-0')).getByRole('textbox', { name })
  await userEvent.clear(view)
  await userEvent.type(view, text)
}
const pressSave = async () =>
  userEvent.click(
    within(await screen.findByTestId('save-bar', {}, WAIT)).getByRole('button', { name: /^Save/ }),
  )

/** data-model.md → Character-to-character relationships: a retired partner is badged. */
export const RelationshipPartnerStatusBadged: Story = {
  args: { links: [MIRA_LINK, { ...VORNE_LINK, rowId: 'rel_3', otherId: 'char_brannoc' }] },
  play: async () => {
    await userEvent.click(await screen.findByRole('tab', { name: /^Connections/ }, WAIT))
    const retired = await screen.findByTestId('relationship-1', {}, WAIT)
    await expect(within(retired).getByText('retired')).toBeVisible()
    await expect(
      within(retired).getByRole('button', { name: 'Brannoc, retired' }),
    ).toBeInTheDocument()
    await expect(
      within(screen.getByTestId('relationship-0')).getByRole('button', { name: 'Mira' }),
    ).toBeInTheDocument()
    await expect(
      within(screen.getByTestId('relationship-0')).queryByText('active'),
    ).not.toBeInTheDocument()
  },
}

/** A Save that leaves Relationships clean hands the base back to the store it wrote. */
export const RelationshipsBaseFollowsStoreAfterSave: Story = {
  args: { links: [MIRA_LINK], commitLinks: true },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('tab', { name: /^Connections/ }, WAIT))
    await userEvent.click(await screen.findByRole('button', { name: /^Mira/ }, WAIT))
    await screen.findByTestId('relationship-0', {}, WAIT)
    await editMiraView('Your view', 'sworn ally')
    await pressSave()
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument(), WAIT)
    await editMiraView('Their view', 'wary')
    await pressSave()
    await waitFor(() => expect(args.onSave).toHaveBeenCalledTimes(2), WAIT)
    const stored = { ...MIRA_LINK, selfToOther: 'sworn ally' }
    await expect(args.onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ relationshipsBase: [stored], relationships: [stored] }),
    )
  },
}

/** An edit typed while Save runs stays dirty, based on what that Save wrote. */
export const RelationshipsBaseAfterMidSaveEdit: Story = {
  args: { links: [MIRA_LINK], commitLinks: true, holdSave: true },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('tab', { name: /^Connections/ }, WAIT))
    await userEvent.click(await screen.findByRole('button', { name: /^Mira/ }, WAIT))
    await screen.findByTestId('relationship-0', {}, WAIT)
    await editMiraView('Your view', 'sworn ally')
    await pressSave()
    await waitFor(() => expect(args.onSave).toHaveBeenCalledTimes(1), WAIT)
    await editMiraView('Their view', 'wary')
    await userEvent.click(screen.getByRole('button', { name: 'Finish save' }))
    await waitFor(
      () => expect(within(saveBar()).getByRole('button', { name: /^Save/ })).toBeEnabled(),
      WAIT,
    )
    await expect(saveBar()).toHaveTextContent('Relationships')
    await pressSave()
    await waitFor(() => expect(args.onSave).toHaveBeenCalledTimes(2), WAIT)
    await expect(args.onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        relationshipsBase: [
          expect.objectContaining({
            otherId: 'char_mira',
            selfToOther: 'sworn ally',
            otherToSelf: 'ally',
          }),
        ],
        relationships: [{ ...MIRA_LINK, selfToOther: 'sworn ally' }],
        draft: expect.objectContaining({
          relationships: [
            expect.objectContaining({ selfToOther: 'sworn ally', otherToSelf: 'wary' }),
          ],
        }),
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Finish save' }))
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
      keywordsBase: [],
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

const entityHistoryLoader = fn(
  async (): Promise<HistoryChunk> => ({ rows: [], nextCursor: null, names: {} }),
)

/** `[+] Blank` from a character open on History lands the new draft on Identity. */
export const BlankFromHistoryLandsOnIdentity: Story = {
  args: { kind: 'character' },
  decorators: [
    (Story) => (
      <HistoryLoaderProvider value={entityHistoryLoader}>
        <Story />
      </HistoryLoaderProvider>
    ),
  ],
  play: async () => {
    await userEvent.click(await waitFor(() => tab(/^History/), WAIT))
    await expect(await screen.findByText('No history yet', {}, WAIT)).toBeVisible()
    await userEvent.keyboard('{F4}')
    await waitFor(() => expect(tab(/^Identity/)).toHaveAttribute('aria-selected', 'true'), WAIT)
  },
}

/** A create's History tab targets the saved row's id, not stale create-mode state. */
export const CreateThenHistoryTargetsTheSavedRow: Story = {
  args: { kind: 'location', row: null },
  decorators: [
    (Story) => (
      <HistoryLoaderProvider value={entityHistoryLoader}>
        <Story />
      </HistoryLoaderProvider>
    ),
  ],
  play: async ({ args }) => {
    await userEvent.click(tab(/^History/))
    await expect(
      await screen.findByText('History starts at the first save', {}, WAIT),
    ).toBeVisible()

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
    await waitFor(() => expect(args.onSaved).toHaveBeenCalledWith('location_new'), WAIT)

    await expect(await screen.findByText('No history yet', {}, WAIT)).toBeVisible()
    await waitFor(
      () =>
        expect(entityHistoryLoader).toHaveBeenCalledWith(
          expect.objectContaining({
            branchId: 'br_1',
            targetTable: 'entities',
            targetId: 'location_new',
          }),
          expect.any(Function),
        ),
      WAIT,
    )
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

const expectGateReason = (control: HTMLElement) =>
  expect(control.closest('[title]')).toHaveAttribute('title', BLOCKED_REASON)

/** Every control disables with the principle-owned tooltip while a turn is in flight. */
export const EveryControlBlocked: Story = {
  args: { blocked: true },
  play: async () => {
    const name = within(await screen.findByTestId('world-detail-name', {}, WAIT))
    await expect(name.getByText('Kael')).toBeVisible()
    await expect(name.queryByRole('button')).toBeNull()
    await expectGateReason(name.getByText('Kael'))
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
    await expectGateReason(status)
    const injection = screen.getByRole('radiogroup', { name: 'Injection' })
    const modes = within(injection).getAllByRole('radio')
    await expect(modes).toHaveLength(3)
    for (const option of modes) await expect(option).toHaveAttribute('aria-disabled', 'true')
    await expectGateReason(injection)
    for (const label of ['Keywords', 'Priority', 'Tags']) {
      const field = screen.getByRole('textbox', { name: label })
      await expect(field).toHaveAttribute('readonly')
      await expectGateReason(field)
    }
    await userEvent.click(tab(/^Carrying/))
    const addQuantity = await screen.findByRole('button', { name: 'Add quantity' }, WAIT)
    await expect(addQuantity).toBeDisabled()
    await expectGateReason(addQuantity)
    for (const label of ['Add equipped item', 'Add carried item']) {
      const picker = screen.getByRole('button', { name: label })
      await expect(picker).toBeDisabled()
      await expectGateReason(picker)
    }
    const gold = within(screen.getByTestId('stackable-0'))
    await expect(gold.getByRole('textbox', { name: 'Quantity' })).toHaveValue('gold')
    await expect(gold.getByRole('textbox', { name: 'Quantity' })).toHaveAttribute('readonly')
    const count = gold.getByRole('textbox', { name: 'Count' })
    await expect(count).toHaveAttribute('readonly')
    await expectGateReason(count)
    await userEvent.click(tab(/^Connections/))
    const location = await screen.findByRole('button', { name: /^Current location/ }, WAIT)
    await expect(location).toBeDisabled()
    await expect(location.closest('[title]')).toHaveAttribute('title', BLOCKED_REASON)
    await expect(screen.getByRole('button', { name: 'Open The Drowned Market' })).toBeEnabled()
    // A disabled ListRow drops its button role (list-row.stories.tsx → DisabledDoesNotFire).
    await expect(screen.getByText('Add relationship')).toBeVisible()
    await expect(screen.queryByRole('button', { name: 'Add relationship' })).not.toBeInTheDocument()
    await expectGateReason(screen.getByText('Add relationship'))
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

/** CHECK (kind IS NOT NULL OR inverse_kind IS NOT NULL): Save waits for one view on the card. */
export const RelationshipWithoutAViewBlocksSave: Story = {
  args: { row: MIRA },
  play: async () => {
    await userEvent.click(await screen.findByRole('tab', { name: /^Connections/ }, WAIT))
    await userEvent.click(await screen.findByRole('button', { name: 'Add relationship' }, WAIT))
    const card = within(await screen.findByTestId('relationship-0', {}, WAIT))
    await userEvent.click(await card.findByRole('button', { name: 'Character' }, WAIT))
    await userEvent.click(await screen.findByRole('option', { name: /Vorne/ }, WAIT))
    const issue = 'Connections: Fill in at least one view.'
    const save = () => within(saveBar()).getByRole('button', { name: /^Save/ })
    await waitFor(() => expect(save()).toBeDisabled(), WAIT)
    await expect(save().closest('[title]')).toHaveAttribute('title', issue)
    await expect(within(saveBar()).getByRole('button', { name: issue })).toBeVisible()
    await userEvent.type(card.getByRole('textbox', { name: 'Their view' }), 'rival')
    await waitFor(() => expect(save()).toBeEnabled(), WAIT)
  },
}

async function expectParentRefusal(onRejected: HarnessProps['onRejected'], text: string) {
  await userEvent.click(await screen.findByRole('tab', { name: /^Connections/ }, WAIT))
  await userEvent.click(await screen.findByRole('button', { name: 'Part of' }, WAIT))
  await userEvent.click(await screen.findByRole('option', { name: /The Drowned Market/ }, WAIT))
  const bar = await screen.findByTestId('save-bar', {}, WAIT)
  await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))
  await expect(await screen.findByText(text, {}, WAIT)).toBeVisible()
  await expect(within(saveBar()).getByRole('button', { name: /^Save/ })).toBeDisabled()
  await expect(onRejected).toHaveBeenCalledWith(text)
}

/** The handler's parent-cycle refusal surfaces as a field error on Connections. */
export const ParentCycleFieldError: Story = {
  args: {
    kind: 'location',
    row: HOLLOW,
    saveResult: { status: 'rejected', reason: 'parent-cycle', code: 'parent-cycle' },
  },
  play: async ({ args }) => {
    await expectParentRefusal(args.onRejected, PARENT_CYCLE_TEXT)
  },
}

/** A keyword the classifier appends while the list is dirty doesn't become the Save's base. */
export const KeywordsBaseFrozenWhileDirty: Story = {
  args: {
    kind: 'location',
    row: { ...HOLLOW, keywords: ['the hollow'] },
    storeKeyword: 'the dell',
  },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('tab', { name: /^Settings/ }, WAIT))
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Keywords' }, WAIT),
      'veil{Enter}',
    )
    await waitFor(() => expect(saveBar()).toHaveTextContent('Keywords'), WAIT)
    await userEvent.click(screen.getByRole('button', { name: 'Classifier appends a keyword' }))
    await userEvent.click(within(saveBar()).getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(args.onSave).toHaveBeenCalledTimes(1), WAIT)
    await expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        keywordsBase: ['the hollow'],
        draft: expect.objectContaining({ keywords: ['the hollow', 'veil'] }),
      }),
    )
  },
}

/** A cap-hit refusal names the chain above the parent, still on the parent field. */
export const ParentChainBrokenFieldError: Story = {
  args: {
    kind: 'location',
    row: HOLLOW,
    saveResult: { status: 'rejected', reason: 'parent-chain-broken', code: 'parent-chain-broken' },
  },
  play: async ({ args }) => {
    await expectParentRefusal(args.onRejected, PARENT_CHAIN_BROKEN_TEXT)
  },
}

/** Set as lead (characters only), plus Export live and Delete enabled. */
export const OverflowMenuForAnActiveCharacter: Story = {
  args: { row: MIRA },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }, WAIT))
    const setLead = await screen.findByRole('menuitem', { name: 'Set as lead' }, WAIT)
    // The popover fades in; the role query can outrace opacity settling.
    await waitFor(() => expect(setLead).toBeVisible(), WAIT)
    await expect(
      screen.getByRole('menuitem', { name: 'Export entity as JSON' }),
    ).not.toHaveAttribute('aria-disabled', 'true')
    await expect(screen.getByRole('menuitem', { name: 'Delete entity' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await userEvent.click(setLead)
    await expect(args.onSetLead).toHaveBeenCalledWith('char_mira')
  },
}

/** A non-lead's Delete entity hands the row to the surface, which raises the confirm. */
export const DeleteHandsUpTheRow: Story = {
  args: { row: MIRA },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }, WAIT))
    const remove = await screen.findByRole('menuitem', { name: 'Delete entity' }, WAIT)
    await waitFor(() => expect(remove).toBeVisible(), WAIT)
    await userEvent.click(remove)
    await expect(args.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'char_mira' }))
  },
}

/** Export writes the committed row, not the unsaved draft, and a toast says so. */
export const ExportHandsTheCommittedRow: Story = {
  beforeEach: () => {
    toastStore.__reset()
  },
  play: async () => {
    let toasts: ToastItem[] = []
    const stop = toastStore.subscribe((next) => {
      toasts = next
    })
    let blob: Blob | null = null
    const downloads: string[] = []
    const url = spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      blob = b as Blob
      return 'blob:story'
    })
    const click = spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download)
    })
    try {
      await userEvent.click(await screen.findByRole('button', { name: 'Edit Kael' }, WAIT))
      await userEvent.keyboard(' (draft){Enter}')
      // The draft must differ from the committed row, or the name check below proves nothing.
      await waitFor(() => expect(saveBar()).toBeVisible(), WAIT)
      await userEvent.click(screen.getByRole('button', { name: 'More actions' }))
      const entry = await screen.findByRole('menuitem', { name: 'Export entity as JSON' }, WAIT)
      await waitFor(() => expect(entry).toBeVisible(), WAIT)
      await userEvent.click(entry)
      await waitFor(() => expect(downloads).toEqual(['character-kael.avts']), WAIT)
      const file = JSON.parse(await (blob as unknown as Blob).text()) as {
        format: string
        entity: Record<string, unknown>
      }
      await expect(file.format).toBe('aventuras-entity')
      await expect(file.entity).toEqual(
        expect.objectContaining({
          kind: 'character',
          name: 'Kael',
          description: 'A courier turned fugitive.',
          injectionMode: 'always',
          tags: ['protagonist'],
        }),
      )
      await waitFor(
        () =>
          expect(toasts.map((item) => [item.severity, item.message])).toEqual([
            ['info', t('common:avts.exportedSaved')],
          ]),
        WAIT,
      )
    } finally {
      stop()
      url.mockRestore()
      click.mockRestore()
    }
  },
}

/** The story's lead can't be deleted: the entry is disabled and says why. */
export const LeadCannotBeDeleted: Story = {
  args: { row: KAEL },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }, WAIT))
    const remove = await screen.findByRole(
      'menuitem',
      {
        name: "Delete entity, The story's lead can't be deleted — set another character as lead first.",
      },
      WAIT,
    )
    await expect(remove).toHaveAttribute('aria-disabled', 'true')
    // RN-Web's Pressable blocks pointer-events when disabled; userEvent respects that, fireEvent
    // bypasses it — pins the onPress guard itself, not a CSS accident, as what blocks the entry.
    fireEvent.click(remove)
    await expect(args.onDelete).not.toHaveBeenCalled()
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
  play: async ({ args }) => {
    await expect(
      within(await screen.findByRole('tablist', {}, WAIT)).queryByRole('tab', {
        name: /^Carrying/,
      }),
    ).toBeNull()
    await userEvent.click(tab(/^Connections/))
    await expect(
      await screen.findByRole('button', { name: 'At location: The Drowned Market' }, WAIT),
    ).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Open The Drowned Market' }))
    await expect(args.onOpenEntity).toHaveBeenCalledWith('loc_market')
    await expect(screen.getByRole('link', { name: 'Kael' })).toBeVisible()
    await expect(screen.queryByRole('link', { name: 'Mira' })).toBeNull()
  },
}

/** Connections' pickers carry the jump to their entity; the Overview names don't link. */
export const ConnectionsPickersOpenTheirEntity: Story = {
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('tab', { name: /^Connections/ }, WAIT))
    await userEvent.click(
      await screen.findByRole('button', { name: 'Open The Drowned Market' }, WAIT),
    )
    await expect(args.onOpenEntity).toHaveBeenLastCalledWith('loc_market')
    const open = screen.getByRole('button', { name: 'Open The City Watch' })
    await userEvent.click(open)
    await expect(args.onOpenEntity).toHaveBeenLastCalledWith('fac_watch')
    // 20px between the ↗ and the × keeps their 44px phone touch zones apart.
    const field = screen.getByRole('button', { name: 'Faction: The City Watch' }).parentElement!
    const clear = within(field).getByRole('button', { name: 'Clear selection' })
    await expect(
      clear.getBoundingClientRect().left - open.getBoundingClientRect().right,
    ).toBeGreaterThanOrEqual(20)
  },
}

/** An empty picker keeps the ↗'s slot but hides it. */
export const ConnectionsEmptyPickerHidesOpen: Story = {
  args: { row: makeEntity({ id: 'char_new', kind: 'character', name: 'Nobody', state: null }) },
  play: async () => {
    await userEvent.click(await screen.findByRole('tab', { name: /^Connections/ }, WAIT))
    await expect(
      await screen.findByRole('button', { name: 'Current location' }, WAIT),
    ).toBeVisible()
    await expect(screen.queryByRole('button', { name: /^Open / })).toBeNull()
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
    // Same-titled rows are named apart by role.
    await userEvent.click(screen.getByRole('button', { name: 'The market fire, witness' }))
    await expect(args.onOpenHappening).toHaveBeenCalledWith('hap_fire')
    await userEvent.click(screen.getByRole('button', { name: 'The market fire, no role recorded' }))
    await expect(args.onOpenHappening).toHaveBeenLastCalledWith('hap_fire_2')
    await userEvent.click(tab(/^Assets/))
    await expect(
      await screen.findByText('Assets land with the asset gallery pass', {}, WAIT),
    ).toBeVisible()
  },
}

// The pane matrix (sparse / retired / staged per kind); populated is each kind's FieldRouting story.
const NOT_DESCRIBED = '— not yet described —'

async function expectEmptyRegion(testId: string, placeholder = NOT_DESCRIBED) {
  const region = await screen.findByTestId(testId, {}, WAIT)
  await expect(within(region).getByText(placeholder)).toBeVisible()
}

async function expectStatusPill(status: 'staged' | 'retired') {
  const pill = await screen.findByTestId('overview-status', {}, WAIT)
  await expect(within(pill).getByText(status)).toBeVisible()
}

/** Retired shows its reason on the pill, and Settings opens the reason for edit. */
async function expectRetired(reason: string) {
  await expectStatusPill('retired')
  await expect(within(screen.getByTestId('overview-status')).getByText(`— ${reason}`)).toBeVisible()
  await userEvent.click(tab(/^Settings/))
  const field = await screen.findByRole('textbox', { name: 'Retired reason' }, WAIT)
  await expect(field).toHaveValue(reason)
  await expect(field).not.toHaveAttribute('readonly')
}

export const Staged: Story = {
  args: { row: SAGE },
  play: async () => {
    await expectStatusPill('staged')
  },
}

export const Sparse: Story = {
  args: { row: makeEntity({ id: 'char_new', kind: 'character', name: 'Nobody', state: null }) },
  play: async () => {
    await expectEmptyRegion('overview-visual')
    await expectEmptyRegion('overview-traits')
    await expectEmptyRegion('overview-carrying')
  },
}

export const LocationSparse: Story = {
  args: {
    kind: 'location',
    row: makeEntity({ id: 'loc_new', kind: 'location', name: 'Unmapped cove' }),
  },
  play: async () => {
    await expectEmptyRegion('overview-part-of')
    await expectEmptyRegion('overview-condition')
    await expectEmptyRegion('overview-characters-here', 'None')
  },
}

export const LocationRetired: Story = {
  args: {
    kind: 'location',
    row: makeEntity({
      id: 'loc_lighthouse',
      kind: 'location',
      name: 'The Old Lighthouse',
      status: 'retired',
      retiredReason: 'swallowed by the tide',
      state: { parent_location_id: null },
    }),
  },
  play: async () => {
    await expectRetired('swallowed by the tide')
  },
}

export const LocationStaged: Story = {
  args: {
    kind: 'location',
    row: makeEntity({
      id: 'loc_vault',
      kind: 'location',
      name: 'The Sealed Vault',
      status: 'staged',
      state: { parent_location_id: null },
    }),
  },
  play: async () => {
    await expectStatusPill('staged')
  },
}

export const ItemSparse: Story = {
  args: { kind: 'item', row: makeEntity({ id: 'item_new', kind: 'item', name: 'Unmarked crate' }) },
  play: async () => {
    await expectEmptyRegion('overview-condition')
    await expectEmptyRegion('overview-position')
    await expect(screen.queryByTestId('overview-held-by')).toBeNull()
  },
}

export const ItemRetired: Story = {
  args: {
    kind: 'item',
    row: makeEntity({
      id: 'item_lantern',
      kind: 'item',
      name: 'Cracked lantern',
      status: 'retired',
      retiredReason: 'shattered in the fire',
      state: { at_location_id: null },
    }),
  },
  play: async () => {
    await expectRetired('shattered in the fire')
  },
}

export const ItemStaged: Story = {
  args: {
    kind: 'item',
    row: makeEntity({
      id: 'item_chart',
      kind: 'item',
      name: 'Sea chart',
      status: 'staged',
      state: { at_location_id: null },
    }),
  },
  play: async () => {
    await expectStatusPill('staged')
  },
}

export const FactionSparse: Story = {
  args: {
    kind: 'faction',
    row: makeEntity({ id: 'fac_new', kind: 'faction', name: 'Unnamed guild' }),
  },
  play: async () => {
    await expectEmptyRegion('overview-standing')
    await expectEmptyRegion('overview-agenda')
    await expectEmptyRegion('overview-members', 'None')
  },
}

export const FactionRetired: Story = {
  args: {
    kind: 'faction',
    row: makeEntity({
      id: 'fac_syndicate',
      kind: 'faction',
      name: 'The Tide Syndicate',
      status: 'retired',
      retiredReason: 'disbanded after the raid',
    }),
  },
  play: async () => {
    await expectRetired('disbanded after the raid')
  },
}

export const FactionStaged: Story = {
  args: {
    kind: 'faction',
    row: makeEntity({
      id: 'fac_order',
      kind: 'faction',
      name: 'The Lantern Order',
      status: 'staged',
    }),
  },
  play: async () => {
    await expectStatusPill('staged')
  },
}
