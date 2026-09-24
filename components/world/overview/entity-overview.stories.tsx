import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { EARTH_GREGORIAN } from '@/lib/calendar'
import type { CharacterState, Entity } from '@/lib/db'

import { EntityOverview, type OverviewVariant } from './entity-overview'

const DAY = 86_400
const WAIT = { timeout: 3000 }
const LONG =
  'A courier turned fugitive whose route ran through every drowned quarter of Veil’s Hollow, carrying an amulet that should not exist and a grudge that outlived its reasons.'

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
  visual: {
    physique: 'tall, lean',
    face: 'weathered, a scar across the left cheek',
    hair: 'raven-black',
  },
  // The second trait alone is wider than the 440 px peek: its chip must wrap inside itself.
  traits: [
    'stubborn',
    'former soldier who deserted the Salt-Ash garrison the night the seawall fell to the Syndicate',
    'expert tracker',
    'distrusts authority',
  ],
  drives: ['avenge his father', 'keep Mira safe'],
  current_location_id: 'loc_market',
  equipped_items: ['item_blade'],
  inventory: ['item_amulet', 'item_key'],
  stackables: { gold: 200, silver: 30, rations: 7 },
  faction_id: 'fac_watch',
  lastSeenAt: { entryId: 'e_47', locationId: 'loc_market', worldTime: 1000 },
  ...over,
})

const HOLLOW = makeEntity({
  id: 'loc_hollow',
  kind: 'location',
  name: 'Veil’s Hollow',
  state: { parent_location_id: null },
})
// Wider than the 440 px peek on its own: the link must wrap inside its own box.
const MARKET = makeEntity({
  id: 'loc_market',
  kind: 'location',
  name: 'The Drowned Market of the Nine Leaking Canvases beneath the Salt-Ash Seawall',
  description: 'Stalls under leaking canvas.',
  state: { parent_location_id: 'loc_hollow', condition: 'fire-scarred' },
  tags: ['market'],
})
const KAEL = makeEntity({
  id: 'char_kael',
  kind: 'character',
  name: 'Kaelthorne Windrider of the Salt-Ash Coastline',
  description: LONG,
  injectionMode: 'always',
  state: characterState(),
  tags: ['protagonist', 'courier', 'chapter-2-introduced'],
})
// With Kael's, wider than one 440 px line: the market's character links must wrap onto new lines.
const MIRA = makeEntity({
  id: 'char_mira',
  kind: 'character',
  name: 'Mirabelle Ashgrove, Keeper of the Tidewater Ledgers',
  state: characterState({ faction_id: null }),
})
const WATCH = makeEntity({
  id: 'fac_watch',
  kind: 'faction',
  name: 'The City Watch',
  state: { standing: 'wary allies', agenda: ['keep the peace', 'curb the Syndicate'] },
})
const KEY = makeEntity({
  id: 'item_key',
  kind: 'item',
  name: 'Old key',
  state: { at_location_id: 'loc_market', condition: 'rusted' },
})
const SPARSE = makeEntity({
  id: 'char_sage',
  kind: 'character',
  name: 'The Ashen Sage',
  status: 'retired',
  retiredReason: 'killed by Vorne',
  state: characterState({
    visual: {},
    traits: [],
    drives: [],
    current_location_id: null,
    faction_id: null,
    equipped_items: [],
    inventory: [],
    stackables: undefined,
    lastSeenAt: null,
  }),
})
const ENTITIES = [HOLLOW, MARKET, KAEL, MIRA, WATCH, KEY, SPARSE]
const ROAMER = makeEntity({
  id: 'char_roamer',
  kind: 'character',
  name: 'Tamsin',
  state: characterState({ current_location_id: null }),
})

type HarnessProps = {
  entity: Entity
  variant: OverviewVariant
  width: number
  onRegionPress: (tab: string) => void
  onOpenEntity: (id: string) => void
}

function Harness({ entity, variant, width, onRegionPress, onOpenEntity }: HarnessProps) {
  return (
    <View style={{ width, maxWidth: '100%' }} className="border border-border p-4">
      <EntityOverview
        entity={entity}
        entities={ENTITIES}
        worldTime={1000 + 2 * DAY}
        calendar={EARTH_GREGORIAN}
        variant={variant}
        onRegionPress={onRegionPress}
        onOpenEntity={onOpenEntity}
      />
    </View>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'World/EntityOverview',
  component: Harness,
  parameters: { layout: 'padded' },
  args: { entity: KAEL, variant: 'panel', width: 860, onRegionPress: fn(), onOpenEntity: fn() },
}
export default meta
type Story = StoryObj<typeof Harness>

function rect(testId: string): DOMRect {
  return screen.getByTestId(testId).getBoundingClientRect()
}

async function expectCompactPortrait() {
  const portrait = rect('overview-portrait')
  await expect(portrait.width).toBe(96)
  await expect(portrait.top).toBeGreaterThanOrEqual(rect('overview-description').bottom)
}

/** RN-Web drops `accessibilityHint`, so a button's name is its aria-label or its text. */
function buttonNames(): string[] {
  const root = screen.getByTestId('entity-overview')
  return Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"]')).map(
    (el) => el.getAttribute('aria-label') ?? el.textContent ?? '',
  )
}

// Pressable stops propagation, so a call count can't see a link nested in a button; the DOM can.
async function expectNoLinkInsideAButton() {
  const links = within(screen.getByTestId('entity-overview')).getAllByRole('link')
  for (const link of links)
    await expect(link.parentElement?.closest('button, [role="button"]') ?? null).toBeNull()
}

const CHARACTER_REGIONS = [
  'overview-status',
  'overview-description',
  'overview-visual',
  'overview-traits',
  'overview-drives',
  'overview-in',
  'overview-with',
  'overview-carrying',
  'overview-tags',
  'overview-portrait',
]

export const CharacterPanel: Story = {
  play: async () => {
    for (const id of CHARACTER_REGIONS)
      await expect(await screen.findByTestId(id, {}, WAIT)).toBeVisible()
    const chip = screen.getByText('Always injected')
    await expect(chip).toBeVisible()
    await expect(getComputedStyle(chip).textTransform).toBe('uppercase')
    await expect(screen.getByText('last seen 2 days ago', { exact: false })).toBeVisible()
    await expect(screen.getByText('+1')).toBeVisible()
    await expect(screen.getByRole('button', { name: 'In, Edit in Connections' })).toBeVisible()
    const portrait = rect('overview-portrait')
    await expect(portrait.width).toBe(220)
    await expect(portrait.left).toBeGreaterThanOrEqual(rect('overview-description').right)
  },
}

/** The slice's region-routing criterion: regions land their edit tabs, names open entities. */
export const CharacterRegionRouting: Story = {
  play: async ({ args }) => {
    await userEvent.click(await screen.findByTestId('overview-visual', {}, WAIT))
    await expect(args.onRegionPress).toHaveBeenLastCalledWith('identity')
    await userEvent.click(screen.getByTestId('overview-carrying'))
    await expect(args.onRegionPress).toHaveBeenLastCalledWith('carrying')
    await userEvent.click(screen.getByTestId('overview-in-label'))
    await expect(args.onRegionPress).toHaveBeenLastCalledWith('connections')
    await userEvent.click(screen.getByTestId('overview-status'))
    await expect(args.onRegionPress).toHaveBeenLastCalledWith('settings')
    await userEvent.click(screen.getByRole('link', { name: MARKET.name }))
    await expect(args.onOpenEntity).toHaveBeenCalledWith('loc_market')
    await expect(args.onRegionPress).toHaveBeenCalledTimes(4)
    await expectNoLinkInsideAButton()
  },
}

export const LocationRegionRouting: Story = {
  args: { entity: MARKET },
  play: async ({ args }) => {
    await expect(await screen.findByText('Characters here (2)', {}, WAIT)).toBeVisible()
    await userEvent.click(screen.getByTestId('overview-condition'))
    await expect(args.onRegionPress).toHaveBeenLastCalledWith('identity')
    await userEvent.click(screen.getByTestId('overview-part-of-label'))
    await expect(args.onRegionPress).toHaveBeenLastCalledWith('connections')
    await userEvent.click(screen.getByRole('link', { name: 'Veil’s Hollow' }))
    await expect(args.onOpenEntity).toHaveBeenCalledWith('loc_hollow')
    await userEvent.click(
      within(screen.getByTestId('overview-items-here')).getByRole('link', { name: 'Old key' }),
    )
    await expect(args.onOpenEntity).toHaveBeenLastCalledWith('item_key')
    await expectNoLinkInsideAButton()
  },
}

/** Held by Kael and at the market: both facts show (decision — show, don't cascade). */
export const ItemHeldAndPlaced: Story = {
  args: { entity: KEY },
  play: async ({ args }) => {
    await expect(await screen.findByTestId('overview-held-by', {}, WAIT)).toBeVisible()
    await expect(screen.getByTestId('overview-position')).toBeVisible()
    await userEvent.click(screen.getByTestId('overview-position-label'))
    await expect(args.onRegionPress).toHaveBeenLastCalledWith('connections')
  },
}

export const FactionRegionRouting: Story = {
  args: { entity: WATCH },
  play: async ({ args }) => {
    await expect(await screen.findByText('Members (1)', {}, WAIT)).toBeVisible()
    await userEvent.click(screen.getByTestId('overview-agenda'))
    await expect(args.onRegionPress).toHaveBeenLastCalledWith('identity')
    await userEvent.click(screen.getByTestId('overview-members-label'))
    await expect(args.onRegionPress).toHaveBeenLastCalledWith('connections')
  },
}

/** Empty regions show the placeholder with an add link; retired shows its reason inline. */
export const SparseRetired: Story = {
  args: { entity: SPARSE },
  play: async () => {
    await expect(await screen.findByText('— killed by Vorne', {}, WAIT)).toBeVisible()
    await expect(screen.getAllByText('— not yet described —')).toHaveLength(8)
    await expect(screen.queryByText('Always injected')).not.toBeInTheDocument()
    const names = buttonNames()
    await expect(names.length).toBeGreaterThan(0)
    await expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([])
  },
}

/** No current location: the In region still carries "last seen" from `lastSeenAt`. */
export const LastSeenWithoutLocation: Story = {
  args: { entity: ROAMER },
  play: async () => {
    const region = await screen.findByTestId('overview-in', {}, WAIT)
    await expect(within(region).getByText('— not yet described —')).toBeVisible()
    await expect(within(region).getByText('last seen 2 days ago')).toBeVisible()
  },
}

/** The phone tier reflows the panel variant: the portrait drops below the prose at md. */
export const PhoneReflow: Story = {
  globals: { viewport: { value: 'mobile1' } },
  play: async () => {
    await screen.findByTestId('entity-overview', {}, WAIT)
    // useTier follows the viewport asynchronously (lessons-learned/storybook-viewport-usetier-async.md).
    await waitFor(() => expectCompactPortrait(), WAIT)
    // touch.md → Touch-target floor.
    await expect(rect('overview-in-label').height).toBeGreaterThanOrEqual(44)
  },
}

/** The 4.5b projection at 440 px: every region renders and nothing overflows horizontally. */
export const PeekAt440: Story = {
  args: { variant: 'peek', width: 440 },
  play: async () => {
    for (const id of CHARACTER_REGIONS)
      await expect(await screen.findByTestId(id, {}, WAIT)).toBeVisible()
    const root = screen.getByTestId('entity-overview')
    await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth)
    await expectCompactPortrait()
  },
}

export const LocationPeekAt440: Story = {
  args: { entity: MARKET, variant: 'peek', width: 440 },
  play: async () => {
    const root = await screen.findByTestId('entity-overview', {}, WAIT)
    await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth)
  },
}
