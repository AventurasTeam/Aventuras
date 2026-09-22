import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import type { RowSessionHandle } from '@/hooks/use-row-save-session'
import type { PlotSaveResult } from '@/lib/actions'
import type { Entity, Happening } from '@/lib/db'
import type { EntryRef } from '@/lib/entry-refs'
import type { HappeningDraft, HappeningLinks } from '@/lib/plot'
import type { RecentlyClassified } from '@/lib/row-signals'

import { HappeningDetailPane } from './happening-detail-pane'

function happening(overrides: Partial<Happening> & Pick<Happening, 'id'>): Happening {
  return {
    branchId: 'br_1',
    title: '',
    description: null,
    category: null,
    icon: null,
    temporal: null,
    occurredAtEntryId: null,
    commonKnowledge: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

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

const AMBUSH = happening({
  id: 'hap_ambush',
  title: 'The alley ambush',
  description: 'Two of the Watch jump Kael behind the Night Market.',
  category: 'encounter',
  icon: 'swords',
  occurredAtEntryId: 'e_10',
})

const AMBUSH_LINKS: HappeningLinks = {
  involvements: [
    {
      id: 'hinv_kael',
      branchId: 'br_1',
      happeningId: AMBUSH.id,
      entityId: 'char_kael',
      role: 'target',
    },
  ],
  awareness: [
    {
      id: 'haw_mira',
      branchId: 'br_1',
      happeningId: AMBUSH.id,
      characterId: 'char_mira',
      learnedAtEntryId: 'e_11',
      decayResistance: 0.6,
      retrievalCount: 3,
      source: 'told',
    },
  ],
}

const BETRAYAL = happening({
  id: 'hap_betrayal',
  title: 'The old betrayal',
  description: 'The Watch sold out the river guild.',
  category: 'backstory',
  icon: 'mask',
  temporal: 'years past',
})

const NO_LINKS: HappeningLinks = { involvements: [], awareness: [] }

const ENTITIES: Entity[] = [
  entity('char_kael', 'character', 'Kael'),
  entity('char_mira', 'character', 'Mira'),
  entity('loc_market', 'location', 'Night Market'),
  entity('fac_watch', 'faction', 'The Watch'),
  entity('char_sage', 'character', 'The Ashen Sage'),
]

// Newest first, as `useEntryIndex` hands them over.
const ENTRIES: EntryRef[] = Array.from({ length: 60 }, (_, i) => {
  const position = 60 - i
  return {
    id: `e_${position}`,
    position,
    kind: 'ai_reply',
    chapterId: position <= 30 ? 'chap_1' : null,
    excerpt: `Entry ${position}`,
  }
})

const CATEGORIES = ['backstory', 'encounter', 'reveal']
const NEW_ID = 'hap_new'
const BLOCKED_REASON = 'Generation is in flight. Cancel to edit.'
const FAILED_TEXT = "Couldn't save your changes. They're still here — try again."
const IN_FLIGHT_TEXT = "Couldn't save while generation is in flight. Your changes are still here."
const ANCHOR_ERROR = 'Choose a narrative entry or an out-of-narrative time, not both.'
const DECAY_ERROR = 'Enter a value from 0 to 1.'
const CK_BODY =
  'Every character is aware of this happening; per-character awareness rows are skipped. Turn the toggle off on Overview to edit rows.'
// CI runs plays several times slower than local; every post-interaction wait uses this.
const WAIT = { timeout: 3000 }

const text = (value: string) => value.trim() || null

function savedRow(prev: Happening | null, id: string, draft: HappeningDraft): Happening {
  return {
    ...(prev ?? happening({ id })),
    id,
    title: draft.title.trim(),
    description: text(draft.description),
    category: text(draft.category),
    icon: draft.icon,
    temporal: text(draft.temporal),
    occurredAtEntryId: draft.occurredAtEntryId,
    commonKnowledge: draft.commonKnowledge ? 1 : 0,
  }
}

// What the stores hold after the group write: new link rows get ids, blanks become null.
function savedLinks(happeningId: string, draft: HappeningDraft): HappeningLinks {
  return {
    involvements: draft.involvements.map((d, i) => ({
      id: d.id ?? `hinv_new_${i}`,
      branchId: 'br_1',
      happeningId,
      entityId: d.entityId,
      role: text(d.role),
    })),
    awareness: draft.awareness.map((d, i) => ({
      id: d.id ?? `haw_new_${i}`,
      branchId: 'br_1',
      happeningId,
      characterId: d.characterId,
      learnedAtEntryId: d.learnedAtEntryId,
      decayResistance: d.decayResistance,
      retrievalCount: 0,
      source: text(d.source),
    })),
  }
}

type HarnessProps = {
  row: Happening | null
  links?: HappeningLinks
  blocked?: boolean
  recentlyClassified?: RecentlyClassified
  /** Every save resolves to this; by default `ok` with the row's id, or a new one on create. */
  saveResult?: PlotSaveResult
  /** `onSaved` throws after the row is selected, as a failing success toast would. */
  savedThrows?: boolean
  initialTab?: string
  onSave: (draft: HappeningDraft) => void
  onRejected: (reason: string) => void
  onOpenEntity: (entity: Entity) => void
  /** What a leave requested through the pane's session handle runs once released. */
  onLeave: () => void
}

/**
 * Mimics the route: an update's row/link patches land mid-save; a create's new row is selected
 * from `onSaved`. Capture-phase F2 flips `blocked` (mid-edit run); F3 requests a leave.
 */
function Harness({
  row: initialRow,
  links: initialLinks = NO_LINKS,
  blocked: initialBlocked = false,
  recentlyClassified,
  saveResult,
  savedThrows = false,
  initialTab,
  onSave,
  onRejected,
  onOpenEntity,
  onLeave,
}: HarnessProps) {
  const [row, setRow] = useState(initialRow)
  const [links, setLinks] = useState(initialLinks)
  const [blocked, setBlocked] = useState(initialBlocked)
  const created = useRef(new Map<string, HappeningDraft>())
  const session = useRef<RowSessionHandle | null>(null)
  const onSession = useCallback((handle: RowSessionHandle | null) => {
    session.current = handle
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') setBlocked((prev) => !prev)
      if (e.key === 'F3') session.current?.requestLeave(onLeave)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onLeave])

  const save = useCallback(
    async (draft: HappeningDraft): Promise<PlotSaveResult> => {
      onSave(draft)
      const result = saveResult ?? { status: 'ok', id: row?.id ?? NEW_ID }
      if (result.status !== 'ok') return result
      if (row == null) {
        created.current.set(result.id, draft)
      } else {
        setRow(savedRow(row, result.id, draft))
        setLinks(savedLinks(result.id, draft))
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      return result
    },
    [onSave, saveResult, row],
  )

  const onSaved = useCallback(
    (id: string) => {
      const draft = created.current.get(id)
      if (draft != null) {
        setRow(savedRow(null, id, draft))
        setLinks(savedLinks(id, draft))
      }
      if (savedThrows) throw new Error('toast failed')
    },
    [savedThrows],
  )

  return (
    // Width clears FormRow's 640px breakpoint so the two-column layout holds from frame 1 — no
    // control remounts under a play (lessons-learned/formrow-narrow-story-remount.md).
    <View
      testID="harness"
      style={{ width: 860, maxWidth: '100%', height: 760 }}
      className="border border-border"
    >
      <HappeningDetailPane
        row={row}
        links={links}
        entities={ENTITIES}
        entries={ENTRIES}
        categories={CATEGORIES}
        recentlyClassified={recentlyClassified}
        blocked={blocked}
        blockedReason={BLOCKED_REASON}
        initialTab={initialTab}
        onSave={save}
        onSaved={onSaved}
        onRejected={onRejected}
        onSession={onSession}
        onOpenEntity={onOpenEntity}
      />
    </View>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Compounds/Plot/HappeningDetailPane',
  component: Harness,
  parameters: { layout: 'padded' },
  args: {
    row: AMBUSH,
    links: AMBUSH_LINKS,
    onSave: fn(),
    onRejected: fn(),
    onOpenEntity: fn(),
    onLeave: fn(),
  },
}
export default meta
type Story = StoryObj<typeof Harness>

// Scoped to the harness: Storybook's hidden args table repeats field names.
const pane = () => within(screen.getByTestId('harness'))
const saveBar = () => screen.getByTestId('save-bar')
const saveButton = () => within(saveBar()).getByRole('button', { name: /^Save/ })
const tab = (name: string) => pane().getByRole('tab', { name: new RegExp(`^${name}`) })
const ckSwitch = () => pane().getByRole('switch', { name: 'Common knowledge' })
const temporal = () => pane().getByRole('textbox', { name: 'Out-of-narrative time' })
const description = () => pane().getByRole('textbox', { name: 'Description' })
// The ⊙ beside the toggle; its colour is the on/off state the list row mirrors.
const ckMarkerColor = () => {
  const marker = ckSwitch().querySelector('svg')
  if (marker == null) throw new Error('no ⊙ marker in the common-knowledge row')
  return getComputedStyle(marker).color
}

async function openTab(name: string) {
  await userEvent.click(await waitFor(() => tab(name), WAIT))
}

async function editDescription(value: string) {
  await userEvent.type(await pane().findByRole('textbox', { name: 'Description' }), value)
  return await screen.findByTestId('save-bar', {}, WAIT)
}

async function setCommonKnowledge(on: boolean) {
  await userEvent.click(await waitFor(() => ckSwitch(), WAIT))
  await waitFor(() => expect(ckSwitch()).toHaveAttribute('aria-checked', String(on)), WAIT)
}

/** The committed anchor and link counts; the head carries only the recently-classified badge. */
export const Anchored: Story = {
  args: { recentlyClassified: 'fresh' },
  play: async () => {
    expect(await pane().findByRole('button', { name: 'Edit The alley ambush' })).toBeVisible()
    expect(pane().getByText('Recently classified')).toBeVisible()
    expect(pane().getByRole('button', { name: 'Occurred at: entry #10' })).toHaveTextContent(
      'entry #10',
    )
    expect(temporal()).toHaveValue('')
    expect(ckSwitch()).toHaveAttribute('aria-checked', 'false')
    expect(pane().getByRole('tablist')).toBeInTheDocument()
    expect(tab('Involvements')).toHaveTextContent(/^Involvements\s*1$/)
    expect(tab('Awareness')).toHaveTextContent(/^Awareness\s*1$/)
    expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument()
  },
}

/**
 * Switching the anchor: a `temporal` typed beside an entry is refused on the field and at Save;
 * clearing the entry re-validates `temporal`, so Save comes back.
 */
export const TimeAnchorConflict: Story = {
  play: async ({ args }) => {
    await userEvent.type(
      await pane().findByRole('textbox', { name: 'Out-of-narrative time' }),
      'years past',
    )
    await waitFor(() => expect(pane().getByText(ANCHOR_ERROR)).toBeVisible(), WAIT)
    expect(temporal()).toHaveAttribute('aria-invalid', 'true')
    expect(saveButton()).toBeDisabled()
    expect(within(saveBar()).getByLabelText(ANCHOR_ERROR)).toBeInTheDocument()

    await userEvent.click(pane().getByRole('button', { name: 'Clear selection' }))
    await waitFor(() => expect(pane().queryByText(ANCHOR_ERROR)).not.toBeInTheDocument(), WAIT)
    await waitFor(() => expect(saveButton()).toBeEnabled(), WAIT)
    expect(pane().getByRole('button', { name: 'Occurred at' })).toHaveTextContent(
      'Pick the entry it happened at',
    )

    await userEvent.click(saveButton())
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument(), WAIT)
    expect(args.onSave).toHaveBeenCalledTimes(1)
    expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ occurredAtEntryId: null, temporal: 'years past' }),
    )
    expect(temporal()).toHaveValue('years past')
  },
}

/** A stored icon key outside the catalog still shows, and stays pickable after picking another. */
export const UnknownIconKey: Story = {
  args: { row: { ...AMBUSH, icon: 'lantern' } },
  play: async () => {
    const icon = () => pane().getByRole('button', { name: 'Icon' })
    await waitFor(() => expect(icon()).toHaveTextContent('lantern'), WAIT)

    await userEvent.click(icon())
    await userEvent.click(await screen.findByRole('option', { name: /eye/ }, WAIT))
    await waitFor(() => expect(saveBar()).toHaveTextContent('Icon'), WAIT)

    await userEvent.click(icon())
    await userEvent.click(await screen.findByRole('option', { name: /lantern/ }, WAIT))
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument(), WAIT)
    expect(icon()).toHaveTextContent('lantern')
  },
}

/** Out of narrative; picking an entry flags the double anchor, clearing `temporal` resolves it. */
export const Temporal: Story = {
  args: { row: BETRAYAL, links: NO_LINKS },
  play: async () => {
    expect(await pane().findByRole('textbox', { name: 'Out-of-narrative time' })).toHaveValue(
      'years past',
    )
    expect(pane().getByRole('button', { name: 'Occurred at' })).toHaveTextContent(
      'Pick the entry it happened at',
    )
    expect(tab('Involvements')).toHaveTextContent(/^Involvements\s*0$/)

    await userEvent.click(pane().getByRole('button', { name: 'Occurred at' }))
    // The category Autocomplete is a combobox too; the overlay's search is the one with this hint.
    await userEvent.type(await screen.findByPlaceholderText('Search entries or #n…'), '#12')
    await userEvent.click(await screen.findByRole('option', { name: /entry #12/ }))
    await waitFor(() => expect(pane().getByText(ANCHOR_ERROR)).toBeVisible(), WAIT)
    expect(saveButton()).toBeDisabled()

    await userEvent.clear(temporal())
    await waitFor(() => expect(pane().queryByText(ANCHOR_ERROR)).not.toBeInTheDocument(), WAIT)
    await waitFor(() => expect(saveButton()).toBeEnabled(), WAIT)
  },
}

/**
 * Common knowledge on: the ⊙ beside the toggle lights, the Awareness count drops and its tab
 * shows the notice; off again, the rows are back and the draft is clean.
 */
export const CommonKnowledgeToggle: Story = {
  play: async () => {
    await waitFor(() => expect(ckSwitch()).toHaveAttribute('aria-checked', 'false'), WAIT)
    const offColor = ckMarkerColor()

    await setCommonKnowledge(true)
    expect(ckMarkerColor()).not.toBe(offColor)
    // The switch's label only: the head grows no common-knowledge badge of its own.
    expect(pane().getAllByText('Common knowledge')).toHaveLength(1)
    expect(tab('Awareness')).toHaveTextContent(/^Awareness$/)
    expect(saveBar()).toHaveTextContent('Common knowledge')

    await openTab('Awareness')
    expect(await pane().findByText(CK_BODY, {}, WAIT)).toBeVisible()
    expect(pane().queryByRole('button', { name: 'Add awareness' })).not.toBeInTheDocument()
    expect(pane().queryByTestId('awareness-0')).not.toBeInTheDocument()

    await openTab('Overview')
    await setCommonKnowledge(false)
    expect(ckMarkerColor()).toBe(offColor)
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument(), WAIT)
    expect(tab('Awareness')).toHaveTextContent(/^Awareness\s*1$/)

    await openTab('Awareness')
    expect(await pane().findByRole('button', { name: 'Add awareness' }, WAIT)).toBeVisible()
    expect(within(pane().getByTestId('awareness-0')).getByText('Mira')).toBeVisible()
  },
}

/**
 * A hidden invalid awareness row still blocks Save, and the bar says it is on Awareness; with
 * common knowledge off again the row shows its error until it is fixed.
 */
export const CommonKnowledgeHidesInvalidRow: Story = {
  play: async () => {
    await openTab('Awareness')
    const decay = within(await pane().findByTestId('awareness-0', {}, WAIT)).getByRole('textbox', {
      name: 'Decay resistance',
    })
    await userEvent.clear(decay)
    await userEvent.type(decay, '1.5')
    await waitFor(
      () => expect(within(pane().getByTestId('awareness-0')).getByText(DECAY_ERROR)).toBeVisible(),
      WAIT,
    )

    await openTab('Overview')
    await setCommonKnowledge(true)
    expect(saveButton()).toBeDisabled()
    expect(within(saveBar()).getByLabelText(`Awareness: ${DECAY_ERROR}`)).toBeInTheDocument()
    await openTab('Awareness')
    expect(await pane().findByText(CK_BODY, {}, WAIT)).toBeVisible()

    await openTab('Overview')
    await setCommonKnowledge(false)
    await openTab('Awareness')
    const row = await pane().findByTestId('awareness-0', {}, WAIT)
    expect(within(row).getByText(DECAY_ERROR)).toBeVisible()
    expect(saveButton()).toBeDisabled()

    const fixed = within(row).getByRole('textbox', { name: 'Decay resistance' })
    await userEvent.clear(fixed)
    await userEvent.type(fixed, '0.7')
    await waitFor(() => expect(within(row).queryByText(DECAY_ERROR)).not.toBeInTheDocument(), WAIT)
    await waitFor(() => expect(saveButton()).toBeEnabled(), WAIT)
  },
}

/** One Save carries the row's link edits; the patch lands mid-commit and the pane settles clean. */
export const SaveCommitsLinks: Story = {
  play: async ({ args }) => {
    await openTab('Involvements')
    const kael = await pane().findByTestId('involvement-0', {}, WAIT)
    const kaelRole = within(kael).getByRole('textbox', { name: 'Role' })
    await userEvent.clear(kaelRole)
    await userEvent.type(kaelRole, 'actor')

    await userEvent.click(pane().getByRole('button', { name: 'Add involvement' }))
    const added = await pane().findByTestId('involvement-1', {}, WAIT)
    await userEvent.click(within(added).getByRole('button', { name: /^Entity/ }))
    await userEvent.click(await screen.findByRole('option', { name: /Night Market/ }))
    await userEvent.type(within(added).getByRole('textbox', { name: 'Role' }), 'site')

    await openTab('Awareness')
    await userEvent.click(
      within(await pane().findByTestId('awareness-0', {}, WAIT)).getByRole('button', {
        name: 'Remove Mira',
      }),
    )
    await waitFor(() => expect(saveBar()).toHaveTextContent('2 unsaved changes'), WAIT)
    expect(saveBar()).toHaveTextContent('Involvements, Awareness')

    await userEvent.click(saveButton())
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument(), WAIT)
    expect(args.onSave).toHaveBeenCalledTimes(1)
    expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        involvements: [
          { id: 'hinv_kael', entityId: 'char_kael', role: 'actor' },
          { id: null, entityId: 'loc_market', role: 'site' },
        ],
        awareness: [],
      }),
    )
    expect(args.onRejected).not.toHaveBeenCalled()
    expect(pane().getByText('No awareness rows yet.')).toBeVisible()
    expect(tab('Awareness')).toHaveTextContent(/^Awareness\s*0$/)
    expect(tab('Involvements')).toHaveTextContent(/^Involvements\s*2$/)

    await openTab('Involvements')
    const market = await pane().findByTestId('involvement-1', {}, WAIT)
    expect(within(market).getByText('Night Market')).toBeVisible()
    expect(within(market).getByRole('textbox', { name: 'Role' })).toHaveValue('site')
    expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument()

    // The draft rebased on the stored rows: the next Save names the created row by its id.
    await userEvent.type(within(market).getByRole('textbox', { name: 'Role' }), ' stall')
    await userEvent.click(await waitFor(() => saveButton(), WAIT))
    await waitFor(() => expect(args.onSave).toHaveBeenCalledTimes(2), WAIT)
    expect(args.onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        involvements: [
          { id: 'hinv_kael', entityId: 'char_kael', role: 'actor' },
          { id: 'hinv_new_1', entityId: 'loc_market', role: 'site stall' },
        ],
      }),
    )
  },
}

/** `[+] Blank`: no row yet, so no menu; saving selects the new row, links included, mid-commit. */
export const Create: Story = {
  args: { row: null, links: NO_LINKS },
  play: async ({ args }) => {
    expect(await pane().findByRole('button', { name: 'More actions' })).toBeDisabled()
    await userEvent.click(pane().getByRole('button', { name: 'Untitled' }))
    await userEvent.type(
      await pane().findByPlaceholderText('Untitled'),
      'Smoke over the docks{Enter}',
    )

    await openTab('Involvements')
    await userEvent.click(await pane().findByRole('button', { name: 'Add involvement' }, WAIT))
    const added = await pane().findByTestId('involvement-0', {}, WAIT)
    await userEvent.click(within(added).getByRole('button', { name: /^Entity/ }))
    await userEvent.click(await screen.findByRole('option', { name: /Kael/ }))
    await userEvent.type(within(added).getByRole('textbox', { name: 'Role' }), 'actor')
    await waitFor(() => expect(saveBar()).toHaveTextContent('2 unsaved changes'), WAIT)

    await userEvent.click(saveButton())
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument(), WAIT)
    expect(args.onSave).toHaveBeenCalledTimes(1)
    expect(args.onSave).toHaveBeenCalledWith({
      title: 'Smoke over the docks',
      description: '',
      category: '',
      icon: null,
      commonKnowledge: false,
      occurredAtEntryId: null,
      temporal: '',
      involvements: [{ id: null, entityId: 'char_kael', role: 'actor' }],
      awareness: [],
    })
    expect(args.onRejected).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(FAILED_TEXT)).not.toBeInTheDocument()
    expect(pane().getByRole('button', { name: 'Edit Smoke over the docks' })).toBeVisible()
    const saved = pane().getByTestId('involvement-0')
    expect(within(saved).getByText('Kael')).toBeVisible()
    expect(within(saved).getByRole('textbox', { name: 'Role' })).toHaveValue('actor')
    expect(tab('Involvements')).toHaveTextContent(/^Involvements\s*1$/)
    expect(pane().getByRole('button', { name: 'More actions' })).toBeEnabled()
  },
}

/** Blocked from the start: no field on any tab can be edited; navigation stays live. */
export const Blocked: Story = {
  args: { blocked: true },
  play: async () => {
    expect(await pane().findByText('The alley ambush')).toBeVisible()
    expect(pane().queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument()
    expect(description()).toHaveAttribute('readonly')
    const category = pane().getByPlaceholderText('e.g. mystery, goal, conflict')
    expect(category).toHaveAttribute('readonly')
    expect(category).toHaveValue('encounter')
    expect(pane().getByRole('button', { name: 'Icon' })).toBeDisabled()
    expect(ckSwitch()).toHaveAttribute('aria-disabled', 'true')
    expect(pane().getByRole('button', { name: /^Occurred at/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(pane().getByRole('button', { name: 'Clear selection' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(temporal()).toHaveAttribute('readonly')
    await userEvent.type(description(), 'x')
    expect(description()).toHaveValue(AMBUSH.description)
    expect(pane().getByRole('button', { name: 'More actions' })).toBeEnabled()

    await openTab('Involvements')
    const involvement = await pane().findByTestId('involvement-0', {}, WAIT)
    expect(within(involvement).getByRole('button', { name: /^Entity/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(within(involvement).getByRole('textbox', { name: 'Role' })).toHaveAttribute('readonly')
    // A disabled IconAction takes its reason as its name
    // (lessons-learned/disabled-iconaction-renames-itself.md).
    expect(within(involvement).getByRole('button', { name: BLOCKED_REASON })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(pane().getByRole('button', { name: 'Add involvement' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(
      within(involvement).getByRole('button', { name: 'Open Kael in World' }),
    ).not.toHaveAttribute('aria-disabled', 'true')

    await openTab('Awareness')
    const awareness = await pane().findByTestId('awareness-0', {}, WAIT)
    for (const name of [/^Character/, /^Learned at/, /^Low/, /^Medium/, /^High/]) {
      expect(within(awareness).getByRole('button', { name })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
    }
    expect(within(awareness).getByRole('button', { name: 'Clear selection' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    for (const name of ['Decay resistance', 'Source']) {
      expect(within(awareness).getByRole('textbox', { name })).toHaveAttribute('readonly')
    }
    expect(within(awareness).getByRole('button', { name: BLOCKED_REASON })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(pane().getByRole('button', { name: 'Add awareness' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument()
  },
}

/** A run starting mid-edit disables Save with the gate's reason; Discard stays live. */
export const BlockedWhileDirty: Story = {
  play: async ({ args }) => {
    const bar = await editDescription(' At dusk.')
    expect(within(bar).getByRole('button', { name: /^Save/ })).toBeEnabled()

    await userEvent.keyboard('{F2}')
    await waitFor(
      () => expect(within(bar).getByLabelText(BLOCKED_REASON)).toBeInTheDocument(),
      WAIT,
    )
    expect(within(bar).getByRole('button', { name: /^Save/ })).toBeDisabled()
    expect(description()).toHaveAttribute('readonly')

    await userEvent.click(within(bar).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument(), WAIT)
    expect(description()).toHaveValue(AMBUSH.description)
    expect(args.onSave).not.toHaveBeenCalled()
  },
}

/** A refusal shows translated text, never the action's developer reason, and is reported. */
export const SaveRejected: Story = {
  args: {
    saveResult: { status: 'rejected', reason: 'generation in flight', code: 'in-flight' },
  },
  play: async ({ args }) => {
    const bar = await editDescription(' At dusk.')
    await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(args.onRejected).toHaveBeenCalledWith(IN_FLIGHT_TEXT), WAIT)
    await waitFor(
      () => expect(within(saveBar()).getByLabelText(IN_FLIGHT_TEXT)).toBeVisible(),
      WAIT,
    )
    expect(screen.queryByLabelText('generation in flight')).not.toBeInTheDocument()
    expect(saveBar()).toHaveTextContent('Description')
  },
}

/** A throwing `onSaved` after the write landed is not a failed save: no error, the bar clears. */
export const SavedHandlerThrows: Story = {
  args: { savedThrows: true },
  play: async ({ args }) => {
    const bar = await editDescription(' At dusk.')
    await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument(), WAIT)
    expect(args.onSave).toHaveBeenCalledTimes(1)
    expect(args.onRejected).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(FAILED_TEXT)).not.toBeInTheDocument()
    expect(description()).toHaveValue(`${AMBUSH.description} At dusk.`)
  },
}

/**
 * A leave requested through the session handle waits on the dialog; the gate disables its Save
 * with the gate's reason, and Discard releases the leave.
 */
export const LeaveGuard: Story = {
  play: async ({ args }) => {
    await editDescription(' At dusk.')
    await userEvent.keyboard('{F3}')
    const dialog = await screen.findByRole('alertdialog', { name: 'Unsaved changes' }, WAIT)
    expect(args.onLeave).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled()

    await userEvent.keyboard('{F2}')
    await waitFor(
      () => expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled(),
      WAIT,
    )
    expect(within(dialog).getByText(BLOCKED_REASON)).toBeVisible()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(args.onLeave).toHaveBeenCalledTimes(1), WAIT)
    await waitFor(() => expect(screen.queryByTestId('save-bar')).not.toBeInTheDocument(), WAIT)
    expect(description()).toHaveValue(AMBUSH.description)
  },
}

/** Raw JSON: the row with its committed involvements and an awareness summary inline. */
export const Menu: Story = {
  play: async () => {
    await userEvent.click(await pane().findByRole('button', { name: 'More actions' }))
    const viewJson = await screen.findByRole('menuitem', { name: 'View raw JSON' })
    await waitFor(() => expect(viewJson).toBeVisible(), WAIT)
    expect(
      screen.getByRole('menuitem', { name: 'Export happening as JSON, Lands in Slice 4.6' }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByRole('menuitem', { name: 'Delete happening, Lands in Slice 4.2b' }),
    ).toHaveAttribute('aria-disabled', 'true')

    await userEvent.click(viewJson)
    expect(await screen.findByRole('button', { name: 'Close raw JSON viewer' }, WAIT)).toBeVisible()
    const json: unknown = JSON.parse(screen.getByText(/"involvements"/).textContent ?? '')
    const [kael] = AMBUSH_LINKS.involvements
    const [mira] = AMBUSH_LINKS.awareness
    expect(json).toEqual({
      ...AMBUSH,
      involvements: [{ id: kael.id, entityId: kael.entityId, role: kael.role }],
      awareness: [
        {
          id: mira.id,
          characterId: mira.characterId,
          learnedAtEntryId: mira.learnedAtEntryId,
          decayResistance: mira.decayResistance,
          retrievalCount: mira.retrievalCount,
          source: mira.source,
        },
      ],
    })
  },
}

/** A deep link's `tab` opens that tab; an unknown one falls back to Overview. */
export const DeepLinkTab: Story = {
  args: { initialTab: 'awareness' },
  play: async () => {
    expect(await pane().findByRole('tab', { name: /^Awareness/, selected: true })).toBeVisible()
    expect(within(pane().getByTestId('awareness-0')).getByText('Mira')).toBeVisible()
  },
}

export const UnknownInitialTab: Story = {
  args: { initialTab: 'connections' },
  play: async () => {
    expect(await pane().findByRole('tab', { name: 'Overview', selected: true })).toBeVisible()
    expect(description()).toBeVisible()
  },
}

async function pickSectionFromSelect() {
  const section = await waitFor(() => pane().getByRole('button', { name: 'Section' }), WAIT)
  expect(pane().queryByRole('tablist')).not.toBeInTheDocument()
  expect(section).toHaveTextContent('Overview')
  await userEvent.click(section)
  await userEvent.click(await screen.findByRole('option', { name: /Awareness 1/ }, WAIT))
  await waitFor(
    () => expect(within(pane().getByTestId('awareness-0')).getByText('Mira')).toBeVisible(),
    WAIT,
  )
  expect(pane().getByRole('button', { name: 'Section' })).toHaveTextContent('Awareness 1')
}

/** Tablet: four tabs overflow the strip (> 3), so the tab list goes to a Select dropdown. */
export const Tablet: Story = {
  globals: { viewport: { value: 'tablet' } },
  play: pickSectionFromSelect,
}

/** Phone: four tabs are past the segment cutoff too — a Select dropdown, not a segment. */
export const Phone: Story = {
  globals: { viewport: { value: 'mobile1' } },
  play: pickSectionFromSelect,
}
