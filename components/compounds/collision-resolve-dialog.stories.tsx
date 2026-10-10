import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes'

import { CollisionResolveDialog } from './collision-resolve-dialog'
import type { EntitySummary, Resolution } from './collision-resolve-diff'

function baseEntity(overrides: Partial<EntitySummary> = {}): EntitySummary {
  return {
    id: 'ent_kael_1',
    kind: 'character',
    createdAt: '2026-05-01T00:00:00Z',
    name: 'Kael',
    description: 'A wandering swordsman drifting between cities.',
    status: 'active',
    retiredReason: undefined,
    injectionMode: 'auto',
    priority: 20,
    tags: ['hero', 'sword'],
    keywords: ['the wanderer', 'the swordsman'],
    state: { hp: 100, mp: 30 },
    relationCounts: {
      awarenessRows: 12,
      involvements: 4,
      relationships: 2,
      joiningRelationship: false,
      inverseRefs: 2,
      embeddings: 1,
      translationRows: 3,
      unheldItems: 1,
      overlap: {
        awareness: 0,
        involvements: 0,
        relationships: 0,
        holdersLosingItem: 0,
        canonicalRefs: 0,
      },
    },
    ...overrides,
  }
}

const entityA = baseEntity()
const entityB = baseEntity({
  id: 'ent_kael_2',
  createdAt: new Date().toISOString(),
  description: 'A city guardsman posted at the eastern gate.',
  status: 'staged',
  tags: ['guard', 'sword'],
  // 'The Swordsman' is A's 'the swordsman' recased: one keyword, in A's spelling.
  keywords: ['the gate guard', 'The Swordsman'],
  state: { hp: 90, post: 'east-gate' },
  relationCounts: {
    awarenessRows: 1,
    involvements: 0,
    relationships: 0,
    joiningRelationship: false,
    inverseRefs: 0,
    embeddings: 1,
    translationRows: 0,
    unheldItems: 0,
    overlap: {
      awareness: 0,
      involvements: 0,
      relationships: 0,
      holdersLosingItem: 0,
      canonicalRefs: 0,
    },
  },
})

const LONG_A =
  'A wandering swordsman drifting between cities, marked by old scars on his off-hand and the habit of speaking only when spoken to. Known to keep the company of stray dogs at every inn he passes through.'
const LONG_B =
  'A city guardsman posted at the eastern gate, terse and slow to anger; identified by the inverted phoenix sigil on his pauldron and the half-moon scar across his right eyebrow that the captain claims is from a tavern brawl, though Kael never confirms.'

const GATE_REASON = 'Generation is in flight. Cancel to edit.'

// Clamped prose renders an aria-hidden copy to measure its full height.
const visibleText = (text: string) => screen.getByText(text, { ignore: '[aria-hidden="true"]' })
const lineClamp = (node: HTMLElement) =>
  getComputedStyle(node).getPropertyValue('-webkit-line-clamp')

const KEYWORD_CHIPS = 'Keywords (click to remove from merge)'
const TAG_CHIPS = 'Tags (click to remove from merge)'
const chipNames = (group: string) =>
  within(screen.getByRole('group', { name: group }))
    .getAllByRole('button')
    .map((chip) => chip.textContent)
// The inline × is a decorative glyph (the whole chip toggles), so it has no role to query by.
const removeGlyph = (chip: HTMLElement) => chip.querySelector('svg')

const resolveOk = async (r: Resolution) => {
  console.log('[story] resolved:', r)
}
// Captures what the dialog actually submits: the union channels are derived in
// the view, so nothing else observes whether they reach the resolution at all.
let lastResolution: Resolution | null = null
const resolveCapturing = async (r: Resolution) => {
  lastResolution = r
}
const resolveLoading = () => new Promise<void>(() => {})
// Settled by the play itself, so the dialog closes and releases the body scroll lock.
let settleResolve: (() => void) | null = null
const resolveDeferred = () =>
  new Promise<void>((resolve) => {
    settleResolve = resolve
  })
const resolveError = () => Promise.reject(new Error('Write failed (story stub)'))

function ControlledDialog({
  initialOpen = true,
  entityA: a,
  entityB: b,
  onResolve,
  blockedReason,
  isNameTaken,
}: {
  initialOpen?: boolean
  entityA: EntitySummary
  entityB: EntitySummary
  onResolve: (r: Resolution) => Promise<void>
  blockedReason?: string
  isNameTaken?: (name: string) => boolean
}) {
  const [open, setOpen] = useState(initialOpen)
  return (
    <View>
      <Button variant="secondary" onPress={() => setOpen(true)}>
        <Text>Open</Text>
      </Button>
      <CollisionResolveDialog
        open={open}
        onOpenChange={setOpen}
        entityA={a}
        entityB={b}
        onResolve={onResolve}
        blockedReason={blockedReason}
        isNameTaken={isNameTaken}
      />
    </View>
  )
}

const meta: Meta<typeof CollisionResolveDialog> = {
  title: 'Compounds/CollisionResolveDialog',
  component: CollisionResolveDialog,
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof CollisionResolveDialog>

export const Default: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveOk} />,
}

export const MergeNoScalarDivergence: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity({ tags: ['hero'] })}
      entityB={baseEntity({ id: 'ent_kael_2', tags: ['guard'] })}
      onResolve={resolveOk}
    />
  ),
}

export const MergeOnlyTagsDiffer: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity({ tags: ['hero', 'sword'] })}
      entityB={baseEntity({ id: 'ent_kael_2', tags: ['sword', 'guard'] })}
      onResolve={resolveOk}
    />
  ),
}

export const MergeStateDivergent: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity({ state: { hp: 100 } })}
      entityB={baseEntity({ id: 'ent_kael_2', state: { hp: 80 } })}
      onResolve={resolveOk}
    />
  ),
}

export const MergeNoDivergence: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity()}
      entityB={baseEntity({ id: 'ent_kael_2' })}
      onResolve={resolveOk}
    />
  ),
}

export const MergeLongDescriptions: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity({ description: LONG_A })}
      entityB={baseEntity({ id: 'ent_kael_2', description: LONG_B })}
      onResolve={resolveOk}
    />
  ),
  play: async () => {
    const heading = await screen.findByText(/^Moves on merge/)
    for (const prose of [LONG_A, LONG_B]) {
      const text = screen.getByText(prose)
      const card = text.closest<HTMLElement>('[role="radio"]')
      expect(card).not.toBeNull()
      // Columns wrap prose freely: the card grows with its text instead of spilling over.
      expect(text.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        card!.getBoundingClientRect().bottom,
      )
      expect(card!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        heading.getBoundingClientRect().top,
      )
    }
  },
}

export const MergePriorityOnly: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity()}
      entityB={baseEntity({ id: 'ent_kael_2', priority: 5 })}
      onResolve={resolveOk}
    />
  ),
  play: async () => {
    const row = await screen.findByRole('radiogroup', { name: 'Priority' })
    for (const label of ['Name', 'Description', 'Status', 'Retired reason', 'Injection mode'])
      expect(screen.queryByRole('radiogroup', { name: label })).toBeNull()
    expect(within(row).getByRole('radio', { name: /^Older · .+: 20$/ })).toBeInTheDocument()
    expect(within(row).getByRole('radio', { name: /^Newer · .+: 5$/ })).toBeInTheDocument()
  },
}

export const PhoneLongDescriptions: Story = {
  globals: { viewport: { value: 'mobile1' } },
  render: () => (
    <ControlledDialog
      entityA={baseEntity({ description: LONG_A })}
      entityB={baseEntity({ id: 'ent_kael_2', description: LONG_B })}
      onResolve={resolveOk}
    />
  ),
  play: async () => {
    // useTier reads RN-Web's Dimensions, which updates a tick after the viewport global lands.
    await waitFor(() => expect(lineClamp(visibleText(LONG_A))).toBe('3'))
    const older = screen.getByRole('radio', { name: /^Older · / })
    const newer = screen.getByRole('radio', { name: /^Newer · / })
    expect(older).toHaveAttribute('aria-checked', 'true')
    expect(
      within(screen.getByRole('radiogroup', { name: 'Description' })).getAllByRole('radio'),
    ).toHaveLength(2)

    // Radio mode stacks the picker's options at full width; segment mode clips a wrapped label.
    const [pickA, pickB] = screen.getAllByRole('radio', { name: /^Kael · / })
    expect(pickB.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      pickA.getBoundingClientRect().bottom,
    )
    const pickAText = within(pickA).getByText(/^Kael · Older · /)
    expect(pickAText.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      pickA.getBoundingClientRect().bottom,
    )

    // Stacked choices carry their own captions, so the column header row is absent.
    expect(screen.queryByText(/^Older · .+ · Canonical$/)).toBeNull()

    // A is the picked side, so tapping B's prose is the only tap that could wrongly pick.
    // The tap target mounts only once both heights are measured, after the clamp shows.
    await userEvent.click(await screen.findByRole('button', { name: LONG_B }))

    await waitFor(() => expect(lineClamp(visibleText(LONG_B))).toBe('none'))
    expect(lineClamp(visibleText(LONG_A))).toBe('3')
    expect(older).toHaveAttribute('aria-checked', 'true')
    expect(newer).toHaveAttribute('aria-checked', 'false')

    await userEvent.click(newer)
    await waitFor(() => expect(newer).toHaveAttribute('aria-checked', 'true'))
  },
}

export const PhoneExpandsOnlyClampedProse: Story = {
  globals: { viewport: { value: 'mobile1' } },
  render: () => (
    <ControlledDialog
      entityA={baseEntity({ description: 'A thief.' })}
      entityB={baseEntity({ id: 'ent_kael_2', description: LONG_B })}
      onResolve={resolveOk}
    />
  ),
  play: async () => {
    const long = await screen.findByRole('button', { name: LONG_B })
    expect(long).toHaveAttribute('aria-expanded', 'false')
    // Layout events land in render order, so the long one's tap target means the short one,
    // rendered before it, has been measured too.
    expect(visibleText('A thief.').compareDocumentPosition(long)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(screen.queryByRole('button', { name: 'A thief.' })).toBeNull()
  },
}

export const PhoneRadioKeyboard: Story = {
  globals: { viewport: { value: 'mobile1' } },
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveOk} />,
  play: async () => {
    await waitFor(() => expect(lineClamp(visibleText(entityA.description!))).toBe('3'))
    const status = within(screen.getByRole('radiogroup', { name: 'Status' }))
    // Each radio names its side and its value, so it reads on its own.
    const older = status.getByRole('radio', { name: /^Older · .+: active$/ })
    const newer = status.getByRole('radio', { name: 'Newer · just now: staged' })

    newer.focus()
    await userEvent.keyboard(' ')
    await waitFor(() => expect(newer).toHaveAttribute('aria-checked', 'true'))
    expect(older).toHaveAttribute('aria-checked', 'false')

    await userEvent.keyboard('{ArrowUp}')
    await waitFor(() => expect(older).toHaveAttribute('aria-checked', 'true'))
    expect(older).toHaveFocus()
    expect(newer).toHaveAttribute('aria-checked', 'false')
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(newer).toHaveAttribute('aria-checked', 'true'))
    expect(newer).toHaveFocus()

    // One tab stop per group, on its checked radio; the group itself isn't one.
    expect(newer).toHaveAttribute('tabindex', '0')
    expect(older).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('radiogroup', { name: 'Status' })).toHaveAttribute('tabindex', '-1')
  },
}

export const MergeOverlapFootnote: Story = {
  render: () => (
    <ControlledDialog
      entityA={{
        ...entityA,
        relationCounts: { ...entityA.relationCounts, joiningRelationship: true },
      }}
      entityB={{
        ...entityB,
        // A case variant, so a footnote naming the wrong row is visible.
        name: 'KAEL',
        relationCounts: {
          ...entityB.relationCounts,
          joiningRelationship: true,
          overlap: {
            awareness: 2,
            involvements: 1,
            relationships: 3,
            holdersLosingItem: 0,
            canonicalRefs: 0,
          },
        },
      }}
      onResolve={resolveOk}
    />
  ),
  play: async () => {
    // The column header marks the canonical with a suffix; the picker marks it by selection only.
    expect(await screen.findByText(/^Older · .+ · Canonical$/)).toBeInTheDocument()
    expect(screen.getByText(/^Newer · [^·]+$/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^Kael · Older · [^·]+$/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('radio', { name: /^KAEL · Newer · [^·]+$/ })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(screen.getByText('Moves on merge (KAEL → Kael)')).toBeInTheDocument()

    expect(
      await screen.findByText(
        'Kael already has 2 of these awareness rows: it keeps its own, and the duplicates are dropped.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '1 of these involvements is a duplicate (Kael already takes part in its happening, or it repeats one) and is dropped.',
      ),
    ).toBeInTheDocument()

    expect(
      screen.getByText(
        "Kael already relates to 3 of these characters: it keeps its own views and takes the duplicate's only where its own is blank.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('The relationship between the two is dropped.')).toBeInTheDocument()

    // With B canonical the summary shows A's counts, and A overlaps nothing.
    await userEvent.click(screen.getByRole('radio', { name: /^KAEL · / }))
    await waitFor(() => expect(screen.queryByText(/already has/)).toBeNull())
    expect(screen.queryByText(/already takes part/)).toBeNull()
    expect(screen.queryByText(/already relates/)).toBeNull()
    // The joining relationship is dropped whichever side survives.
    expect(screen.getByText('The relationship between the two is dropped.')).toBeInTheDocument()
    expect(screen.getByText('Moves on merge (Kael → KAEL)')).toBeInTheDocument()
    expect(screen.getByText(/^Newer · .+ · Canonical$/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^KAEL · Newer · [^·]+$/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  },
}

type Counts = EntitySummary['relationCounts']

// Every count distinct on both sides, so a line with the wrong count, or the wrong side's, fails.
const OLDER_COUNTS: Counts = {
  awarenessRows: 11,
  involvements: 12,
  relationships: 13,
  joiningRelationship: false,
  inverseRefs: 14,
  embeddings: 1,
  translationRows: 15,
  unheldItems: 16,
  overlap: {
    awareness: 2,
    involvements: 3,
    relationships: 4,
    holdersLosingItem: 5,
    canonicalRefs: 1,
  },
}
const NEWER_COUNTS: Counts = {
  awarenessRows: 21,
  involvements: 22,
  relationships: 23,
  joiningRelationship: false,
  inverseRefs: 24,
  embeddings: 0,
  translationRows: 25,
  unheldItems: 26,
  overlap: {
    awareness: 6,
    involvements: 7,
    relationships: 8,
    holdersLosingItem: 9,
    canonicalRefs: 0,
  },
}

export const MergeSummaryCounts: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity({
        id: 'ent_harbor_1',
        kind: 'location',
        name: 'Harbor',
        relationCounts: OLDER_COUNTS,
      })}
      entityB={baseEntity({
        id: 'ent_harbor_2',
        kind: 'location',
        // A case variant, so a footnote naming the wrong row is visible.
        name: 'HARBOR',
        createdAt: new Date().toISOString(),
        relationCounts: NEWER_COUNTS,
      })}
      onResolve={resolveOk}
    />
  ),
  play: async () => {
    const shows = async (lines: string[]) => {
      for (const line of lines) expect(await screen.findByText(line)).toBeInTheDocument()
    }

    // The older row survives by default, so the summary shows what the newer one brings.
    await shows([
      'Moves on merge (HARBOR → Harbor)',
      'Awareness rows: 21',
      'Involvements: 22',
      'Relationships: 23',
      'Inverse refs: 24',
      'Embeddings: 0',
      'Items left unheld: 26',
      'Translation rows dropped: 25',
      'Harbor already has 6 of these awareness rows: it keeps its own, and the duplicates are dropped.',
      '7 of these involvements are duplicates (Harbor already takes part in their happening, or they repeat one) and are dropped.',
      "Harbor already relates to 8 of these characters: it keeps its own views and takes the duplicate's only where its own is blank.",
      '9 holders lose this item: Harbor is already held or placed.',
    ])
    expect(screen.queryByText(/sits under this location/)).toBeNull()

    await userEvent.click(screen.getByRole('radio', { name: /^HARBOR · Newer · / }))
    await shows([
      'Moves on merge (Harbor → HARBOR)',
      'Awareness rows: 11',
      'Involvements: 12',
      'Relationships: 13',
      'Inverse refs: 14',
      'Embeddings: 1',
      'Items left unheld: 16',
      'Translation rows dropped: 15',
      'HARBOR already has 2 of these awareness rows: it keeps its own, and the duplicates are dropped.',
      '3 of these involvements are duplicates (HARBOR already takes part in their happening, or they repeat one) and are dropped.',
      "HARBOR already relates to 4 of these characters: it keeps its own views and takes the duplicate's only where its own is blank.",
      '5 holders lose this item: HARBOR is already held or placed.',
      "HARBOR sits under this location: the merge clears that parent, since a place can't contain itself.",
    ])
  },
}

export const MergeHoldersFootnote: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity({ id: 'ent_lamp_1', kind: 'item', name: 'Lantern' })}
      entityB={baseEntity({
        id: 'ent_lamp_2',
        kind: 'item',
        name: 'Lantern',
        createdAt: new Date().toISOString(),
        relationCounts: {
          ...entityB.relationCounts,
          overlap: {
            awareness: 0,
            involvements: 0,
            relationships: 0,
            holdersLosingItem: 2,
            canonicalRefs: 0,
          },
        },
      })}
      onResolve={resolveOk}
    />
  ),
  play: async () => {
    expect(
      await screen.findByText('2 holders lose this item: Lantern is already held or placed.'),
    ).toBeInTheDocument()
    // With the newer item canonical the shown side is the older, whose holders keep theirs.
    await userEvent.click(screen.getAllByRole('radio', { name: /^Lantern · / })[1])
    await waitFor(() => expect(screen.queryByText(/holders? lose/)).toBeNull())
  },
}

export const MergeCanonicalFlip: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveOk} />,
}

// Namesakes created within one relative-time bucket: only the side tells them apart.
const SAME_BUCKET = new Date().toISOString()

export const MergeNamesTheSide: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity({ createdAt: SAME_BUCKET })}
      entityB={baseEntity({ id: 'ent_kael_2', createdAt: SAME_BUCKET, priority: 5 })}
      onResolve={resolveOk}
    />
  ),
  play: async () => {
    // The option text stays put on a flip; only the selection moves.
    const older = await screen.findByRole('radio', { name: 'Kael · Older · just now' })
    const newer = screen.getByRole('radio', { name: 'Kael · Newer · just now' })
    expect(older).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'Merge into the older Kael' })).toBeInTheDocument()

    await userEvent.click(newer)
    await waitFor(() => expect(newer).toHaveAttribute('aria-checked', 'true'))
    expect(older).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: 'Kael · Newer · just now' })).toBe(newer)
    expect(screen.getByRole('radio', { name: 'Kael · Older · just now' })).toBe(older)
    expect(screen.getByRole('button', { name: 'Merge into the newer Kael' })).toBeInTheDocument()
  },
}

export const MergeInFlightStaysOpen: Story = {
  render: () => (
    <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveDeferred} />
  ),
  play: async () => {
    settleResolve = null
    await userEvent.click(await screen.findByRole('button', { name: /^Merge into / }))
    await waitFor(() => expect(settleResolve).not.toBeNull())

    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // The choices are inert while the write is in flight, their contents too: a disabled
    // Pressable alone is box-none on web, which leaves its children clickable.
    const status = within(screen.getByRole('radiogroup', { name: 'Status' }))
    for (const value of ['active', 'staged'])
      expect(status.getByText(value)).toHaveStyle({ pointerEvents: 'none' })

    // The driver assigns it after the reset above, which narrowing can't see.
    const settle = settleResolve as (() => void) | null
    settle?.()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  },
}

export const MergeLoading: Story = {
  // Visual-only: `handleOpenChange` gates close while submitting, so the never-resolving driver
  // leaves body scroll locked between tests; vitest.config.ts excludes the `no-vitest` tag.
  tags: ['no-vitest'],
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveLoading} />,
  play: async () => {
    // Open the dialog, then submit so the never-resolving driver locks
    // the dialog into its submitting state at story load. Without
    // these clicks the loading lock isn't visible.
    await userEvent.click(await screen.findByRole('button', { name: 'Open' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Merge into / }))
  },
}

export const MergeKeywordUnion: Story = {
  render: () => (
    <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveCapturing} />
  ),
  play: async () => {
    lastResolution = null
    // ControlledDialog opens by default; the Open button sits behind the overlay.
    await userEvent.click(await screen.findByRole('button', { name: 'the wanderer' }))
    // Write order: the canonical's own as stored, then the other's additions; case variants fold.
    expect(chipNames(KEYWORD_CHIPS)).toEqual(['the wanderer', 'the swordsman', 'the gate guard'])
    expect(chipNames(TAG_CHIPS)).toEqual(['hero', 'sword', 'guard'])
    await userEvent.click(screen.getByRole('button', { name: /^Merge into / }))

    await waitFor(() => expect(lastResolution).not.toBeNull())
    expect(lastResolution).toEqual({
      mode: 'merge',
      canonicalId: entityA.id,
      fromOther: [],
      deselectedTags: [],
      deselectedKeywords: ['the wanderer'],
    })
  },
}

// world.md → Merge: a partial pair's merge offers the name it doesn't keep as a keyword, even when
// the two keyword lists match, and the chip follows the name choice.
export const MergeAddsTheNameItDoesNotKeep: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity({ keywords: ['the wanderer'] })}
      entityB={baseEntity({
        id: 'ent_kael_2',
        name: 'Kael Stormborn',
        keywords: ['The Wanderer'],
      })}
      onResolve={resolveCapturing}
    />
  ),
  play: async () => {
    lastResolution = null
    await screen.findByRole('group', { name: KEYWORD_CHIPS })
    expect(chipNames(KEYWORD_CHIPS)).toEqual(['the wanderer', 'Kael Stormborn'])

    const name = screen.getByRole('radiogroup', { name: 'Name' })
    await userEvent.click(within(name).getByRole('radio', { name: /^Newer · / }))
    await waitFor(() => expect(chipNames(KEYWORD_CHIPS)).toEqual(['the wanderer', 'Kael']))

    await userEvent.click(screen.getByRole('button', { name: 'Kael' }))
    await userEvent.click(screen.getByRole('button', { name: /^Merge into / }))

    await waitFor(() => expect(lastResolution).not.toBeNull())
    expect(lastResolution).toEqual({
      mode: 'merge',
      canonicalId: entityA.id,
      fromOther: ['name'],
      deselectedTags: [],
      deselectedKeywords: ['kael'],
    })
  },
}

export const MergeChipRemoveGlyph: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveOk} />,
  play: async () => {
    const chip = () => screen.getByRole('button', { name: 'hero' })
    await screen.findByRole('group', { name: TAG_CHIPS })
    expect(chip()).toHaveAttribute('aria-pressed', 'true')
    expect(removeGlyph(chip())).not.toBeNull()

    await userEvent.click(chip())
    await waitFor(() => expect(chip()).toHaveAttribute('aria-pressed', 'false'))
    expect(removeGlyph(chip())).toBeNull()

    await userEvent.click(chip())
    await waitFor(() => expect(chip()).toHaveAttribute('aria-pressed', 'true'))
    expect(removeGlyph(chip())).not.toBeNull()
  },
}

export const MergeFieldsFromOther: Story = {
  render: () => (
    <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveCapturing} />
  ),
  play: async () => {
    lastResolution = null
    const description = await screen.findByRole('radiogroup', { name: 'Description' })
    await userEvent.click(within(description).getByRole('radio', { name: /^Newer · / }))
    // A canonical pick takes every field from the new canonical again.
    await userEvent.click(screen.getAllByRole('radio', { name: /^Kael · / })[1])
    const status = screen.getByRole('radiogroup', { name: 'Status' })
    await userEvent.click(within(status).getByRole('radio', { name: /^Older · .+: active$/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Merge into / }))

    await waitFor(() => expect(lastResolution).not.toBeNull())
    // toMatchObject compares arrays whole, so a stale 'description' fails it too.
    expect(lastResolution).toMatchObject({
      mode: 'merge',
      canonicalId: entityB.id,
      fromOther: ['status'],
    })
  },
}

export const MergeChipsFollowCanonicalOrder: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity({ tags: ['sword', 'hero'] })}
      entityB={baseEntity({ id: 'ent_kael_2', tags: ['sword', 'guard', 'alpha'] })}
      onResolve={resolveCapturing}
    />
  ),
  play: async () => {
    lastResolution = null
    await screen.findByRole('group', { name: TAG_CHIPS })
    expect(chipNames(TAG_CHIPS)).toEqual(['sword', 'hero', 'alpha', 'guard'])
    await userEvent.click(screen.getByRole('button', { name: 'guard' }))
    await userEvent.click(screen.getByRole('button', { name: 'hero' }))

    await userEvent.click(screen.getAllByRole('radio', { name: /^Kael · / })[1])
    await waitFor(() => expect(chipNames(TAG_CHIPS)).toEqual(['sword', 'guard', 'alpha', 'hero']))
    expect(screen.getByRole('button', { name: 'guard' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'hero' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(screen.getByRole('button', { name: /^Merge into / }))

    await waitFor(() => expect(lastResolution).not.toBeNull())
    expect(lastResolution).toEqual({
      mode: 'merge',
      canonicalId: 'ent_kael_2',
      fromOther: [],
      deselectedTags: ['guard', 'hero'],
      deselectedKeywords: [],
    })
  },
}

export const MergeKeywordsInCanonicalSpelling: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity({ keywords: ['the swordsman', 'the wanderer'] })}
      entityB={baseEntity({ id: 'ent_kael_2', keywords: ['The Swordsman', 'the gate guard'] })}
      onResolve={resolveOk}
    />
  ),
  play: async () => {
    await userEvent.click((await screen.findAllByRole('radio', { name: /^Kael · / }))[1])
    // The shared keyword shows, and is written, as the canonical spells it.
    await waitFor(() =>
      expect(chipNames(KEYWORD_CHIPS)).toEqual(['The Swordsman', 'the gate guard', 'the wanderer']),
    )
  },
}

export const MergeKeywordDeselectSurvivesFlip: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity({ keywords: ['The Swordsman', 'the wanderer'] })}
      entityB={baseEntity({ id: 'ent_kael_2', keywords: ['THE SWORDSMAN', 'the gate guard'] })}
      onResolve={resolveCapturing}
    />
  ),
  play: async () => {
    lastResolution = null
    await userEvent.click(await screen.findByRole('button', { name: 'The Swordsman' }))
    await userEvent.click(screen.getAllByRole('radio', { name: /^Kael · / })[1])
    // B spells it in capitals, so a raw-spelling compare would not see the deselect.
    expect(await screen.findByRole('button', { name: 'THE SWORDSMAN' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await userEvent.click(await screen.findByRole('button', { name: /^Merge into / }))

    await waitFor(() => expect(lastResolution).not.toBeNull())
    expect(lastResolution).toMatchObject({ deselectedKeywords: ['the swordsman'] })
  },
}

// A no-gate classifier write can make a field differ while the dialog is open.
let divergeNow: (() => void) | null = null
function DivergesWhileOpen() {
  const [b, setB] = useState(baseEntity({ id: 'ent_kael_2' }))
  useEffect(() => {
    divergeNow = () => setB(baseEntity({ id: 'ent_kael_2', priority: 5 }))
    return () => {
      divergeNow = null
    }
  }, [])
  return <ControlledDialog entityA={baseEntity()} entityB={b} onResolve={resolveOk} />
}

export const MergeFieldDivergesWhileOpen: Story = {
  render: () => <DivergesWhileOpen />,
  play: async () => {
    await screen.findByRole('button', { name: /^Merge into / })
    expect(screen.queryByRole('radiogroup', { name: 'Priority' })).toBeNull()
    divergeNow?.()

    const row = await screen.findByRole('radiogroup', { name: 'Priority' })
    const older = within(row).getByRole('radio', { name: /: 20$/ })
    const newer = within(row).getByRole('radio', { name: /: 5$/ })
    expect(older).toHaveAttribute('aria-checked', 'true')
    expect(newer).toHaveAttribute('aria-checked', 'false')

    await userEvent.click(screen.getAllByRole('radio', { name: /^Kael · / })[1])
    await waitFor(() => expect(newer).toHaveAttribute('aria-checked', 'true'))
    expect(older).toHaveAttribute('aria-checked', 'false')
  },
}

let convergeNow: (() => void) | null = null
function ConvergesWhileOpen() {
  const [b, setB] = useState(
    baseEntity({
      id: 'ent_kael_2',
      priority: 5,
      tags: ['sword', 'guard'],
      keywords: ['the swordsman', 'the gate guard'],
    }),
  )
  useEffect(() => {
    convergeNow = () => setB(baseEntity({ id: 'ent_kael_2' }))
    return () => {
      convergeNow = null
    }
  }, [])
  return <ControlledDialog entityA={baseEntity()} entityB={b} onResolve={resolveCapturing} />
}

export const MergeConvergesWhileOpen: Story = {
  render: () => <ConvergesWhileOpen />,
  play: async () => {
    lastResolution = null
    const row = await screen.findByRole('radiogroup', { name: 'Priority' })
    await userEvent.click(within(row).getByRole('radio', { name: /: 5$/ }))
    // Terms both rows keep after converging: a stale deselect would drop them from the canonical.
    await userEvent.click(screen.getByRole('button', { name: 'sword' }))
    await userEvent.click(screen.getByRole('button', { name: 'the swordsman' }))
    convergeNow?.()
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Priority' })).toBeNull())
    expect(screen.queryByRole('group', { name: TAG_CHIPS })).toBeNull()
    expect(screen.queryByRole('group', { name: KEYWORD_CHIPS })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Merge into / }))

    // None of the choices shows any more, so none is sent.
    await waitFor(() => expect(lastResolution).not.toBeNull())
    expect(lastResolution).toEqual({
      mode: 'merge',
      canonicalId: 'ent_kael_1',
      fromOther: [],
      deselectedTags: [],
      deselectedKeywords: [],
    })
  },
}

// Enough tags on each side to push the merge body past the dialog's height cap.
const manyTags = (prefix: string) => Array.from({ length: 40 }, (_, i) => `${prefix}-${i}`)

export const MergeErrorStaysInView: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity({ tags: manyTags('a') })}
      entityB={baseEntity({ id: 'ent_kael_2', tags: manyTags('b') })}
      onResolve={resolveError}
    />
  ),
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /^Merge into / }))
    const refusal = await screen.findByText('Write failed (story stub)')
    const box = refusal.getBoundingClientRect()
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight)
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    expect(hit != null && refusal.contains(hit)).toBe(true)
  },
}

export const MergeError: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveError} />,
  play: async () => {
    const refusal = 'Write failed (story stub)'
    const merge = async () => {
      await userEvent.click(screen.getByRole('button', { name: /^Merge into / }))
      expect(await screen.findByText(refusal)).toBeInTheDocument()
      // A refusal leaves the dialog open on the choices it refused.
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    }
    const cleared = () => waitFor(() => expect(screen.queryByText(refusal)).toBeNull())

    await screen.findByRole('button', { name: /^Merge into / })
    // A changed choice answers the refusal, whichever choice it is.
    await merge()
    await userEvent.click(screen.getAllByRole('radio', { name: /^Kael · / })[1])
    await cleared()
    await merge()
    const status = screen.getByRole('radiogroup', { name: 'Status' })
    await userEvent.click(within(status).getByRole('radio', { name: /^Older · / }))
    await cleared()
    await merge()
    await userEvent.click(screen.getByRole('button', { name: 'guard' }))
    await cleared()
    await merge()
    await userEvent.click(screen.getByRole('button', { name: 'the wanderer' }))
    await cleared()

    await merge()
    await userEvent.click(screen.getByRole('radio', { name: 'Rename one' }))
    await cleared()
  },
}

export const RenameMode: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveOk} />,
}

export const RenameValidation: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveOk} />,
  play: async () => {
    await userEvent.click(await screen.findByRole('radio', { name: 'Rename one' }))
    const save = () => screen.getByRole('button', { name: 'Save renames' })
    const prompt = 'Change at least one name to clear the collision.'
    expect(save()).toBeDisabled()
    expect(screen.getByText(prompt)).toBeInTheDocument()
    // Nothing edited yet: the disabled reason says what the help line says.
    expect(save().closest('[title]')).toHaveAttribute('title', prompt)

    const inputs = await screen.findAllByRole('textbox')
    // A trailing space trims back to the current name: still the plain prompt.
    await userEvent.type(inputs[1], ' ')
    expect(save()).toBeDisabled()
    expect(screen.getByText(prompt)).toBeInTheDocument()

    await userEvent.clear(inputs[1])
    await userEvent.type(inputs[1], 'KAEL')

    expect(await screen.findByText(/still match/)).toBeInTheDocument()
    expect(save()).toBeDisabled()
    expect(save().closest('[title]')).toHaveAttribute(
      'title',
      expect.stringContaining('still match'),
    )

    // One name inside the other still matches.
    await userEvent.type(inputs[1], ' the Guard')
    expect(screen.getByText(/still match/)).toBeInTheDocument()
    expect(save()).toBeDisabled()

    await userEvent.clear(inputs[1])
    await userEvent.type(inputs[1], 'Jorin')

    await waitFor(() => expect(save()).not.toBeDisabled())
    expect(screen.getByText(prompt)).toBeInTheDocument()
  },
}

// world.md → Rename: keywords don't count, so a pair that matches through one passes once a name changes.
export const RenameKeywordPair: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity({ id: 'ent_marta', name: 'Marta', keywords: ['the innkeeper'] })}
      entityB={baseEntity({
        id: 'ent_keeper',
        name: 'The Innkeeper',
        createdAt: new Date().toISOString(),
        keywords: [],
      })}
      onResolve={resolveOk}
    />
  ),
  play: async () => {
    await userEvent.click(await screen.findByRole('radio', { name: 'Rename one' }))
    const save = () => screen.getByRole('button', { name: 'Save renames' })
    const prompt = 'Change at least one name to clear the collision.'
    expect(save()).toBeDisabled()
    expect(screen.getByText(prompt)).toBeInTheDocument()

    const inputs = await screen.findAllByRole('textbox')
    await userEvent.type(inputs[0], ' Vell')

    await waitFor(() => expect(save()).not.toBeDisabled())
    expect(screen.getByText(prompt)).toBeInTheDocument()
  },
}

// world.md → Rename: a name a third row has earns a hint under that field, and never blocks.
export const RenameWarnsOfATakenName: Story = {
  render: () => (
    <ControlledDialog
      entityA={entityA}
      entityB={entityB}
      onResolve={resolveOk}
      isNameTaken={(name) => name.toLowerCase() === 'jorin'}
    />
  ),
  play: async () => {
    await userEvent.click(await screen.findByRole('radio', { name: 'Rename one' }))
    const inputs = await screen.findAllByRole('textbox')
    expect(screen.queryByText('Another row already has that name.')).toBeNull()
    await userEvent.clear(inputs[1])
    await userEvent.type(inputs[1], 'Jorin')
    expect(await screen.findByText('Another row already has that name.')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save renames' })).not.toBeDisabled(),
    )
    await userEvent.type(inputs[1], ' the Elder')
    await waitFor(() => expect(screen.queryByText('Another row already has that name.')).toBeNull())
  },
}

export const RenameSubmitsTrimmedChanges: Story = {
  render: () => (
    <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveCapturing} />
  ),
  play: async () => {
    lastResolution = null
    await userEvent.click(await screen.findByRole('radio', { name: 'Rename one' }))
    const inputs = await screen.findAllByRole('textbox')
    // A gains only a trailing space, which trims back to its current name.
    await userEvent.type(inputs[0], ' ')
    await userEvent.clear(inputs[1])
    await userEvent.type(inputs[1], ' Jorin  ')
    await userEvent.click(screen.getByRole('button', { name: 'Save renames' }))

    await waitFor(() => expect(lastResolution).not.toBeNull())
    expect(lastResolution).toEqual({
      mode: 'rename',
      renames: [{ id: 'ent_kael_2', newName: 'Jorin' }],
    })
  },
}

export const Blocked: Story = {
  render: () => (
    <ControlledDialog
      entityA={entityA}
      entityB={entityB}
      onResolve={resolveOk}
      blockedReason={GATE_REASON}
    />
  ),
  play: async () => {
    expect(await screen.findByRole('button', { name: /^Merge into / })).toBeDisabled()
    expect(screen.getByText(GATE_REASON)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Merge into / }).closest('[title]')).toHaveAttribute(
      'title',
      GATE_REASON,
    )
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeDisabled()

    await userEvent.click(screen.getByRole('radio', { name: 'Rename one' }))
    const inputs = await screen.findAllByRole('textbox')
    // A rename that would otherwise save.
    await userEvent.clear(inputs[1])
    await userEvent.type(inputs[1], 'Jorin')
    expect(screen.getByRole('button', { name: 'Save renames' })).toBeDisabled()
    expect(screen.getByText(GATE_REASON)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: 'Keep as distinct' }))
    expect(screen.getByRole('button', { name: 'Keep as distinct' })).toBeDisabled()
  },
}

export const RenameLoading: Story = {
  tags: ['no-vitest'], // same as MergeLoading — visual-only, leaks body lock
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveLoading} />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Open' }))
    // Switch to rename mode via the segment.
    await userEvent.click(await screen.findByRole('radio', { name: 'Rename one' }))
    // Rename the first row so the Save button enables.
    const inputs = await screen.findAllByRole('textbox')
    await userEvent.clear(inputs[0])
    await userEvent.type(inputs[0], 'Jorin')
    await userEvent.click(await screen.findByRole('button', { name: 'Save renames' }))
  },
}

export const KeepMode: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveOk} />,
}

export const KeepLoading: Story = {
  tags: ['no-vitest'], // same as MergeLoading — visual-only, leaks body lock
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveLoading} />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Open' }))
    // Mode segment + footer button share the "Keep as distinct"
    // accessible name — disambiguate by role.
    await userEvent.click(await screen.findByRole('radio', { name: 'Keep as distinct' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Keep as distinct' }))
  },
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
          style={{ width: 360 }}
        >
          <Text variant="muted" size="sm" className="mb-2">
            {t.name}
          </Text>
          <ControlledDialog
            initialOpen={false}
            entityA={entityA}
            entityB={entityB}
            onResolve={resolveOk}
          />
        </View>
      ))}
    </View>
  ),
}

// Tags are user data, so the merge body is the one collision mode whose height
// scales without limit. The actions must not ride the scroll region away.
export const MergeManyTags: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity({ tags: Array.from({ length: 60 }, (_, i) => `tag-a-${i}`) })}
      entityB={baseEntity({
        id: 'ent_kael_2',
        tags: Array.from({ length: 60 }, (_, i) => `tag-b-${i}`),
      })}
      onResolve={resolveOk}
    />
  ),
  play: async () => {
    const confirm = await screen.findByRole('button', { name: /^Merge into/ })
    const panel = confirm.closest('[role="dialog"]') as HTMLElement

    expect(panel.getBoundingClientRect().height).toBeLessThanOrEqual(window.innerHeight * 0.9 + 1)

    let scroller: HTMLElement | null = null
    for (const candidate of Array.from(panel.querySelectorAll<HTMLElement>('div'))) {
      const overflowY = getComputedStyle(candidate).overflowY
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        candidate.scrollHeight > candidate.clientHeight
      ) {
        scroller = candidate
        break
      }
    }
    expect(scroller).not.toBeNull()
    expect(scroller!.contains(confirm)).toBe(false)

    const before = confirm.getBoundingClientRect().top
    scroller!.scrollTop = scroller!.scrollHeight
    expect(confirm.getBoundingClientRect().top).toBeCloseTo(before, 0)
    expect(confirm.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight + 1)
  },
}
