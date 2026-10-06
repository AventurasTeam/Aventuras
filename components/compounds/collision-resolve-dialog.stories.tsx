import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
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
      overlap: { awareness: 0, involvements: 0, relationships: 0, holdersLosingItem: 0 },
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
    overlap: { awareness: 0, involvements: 0, relationships: 0, holdersLosingItem: 0 },
  },
})

const LONG_A =
  'A wandering swordsman drifting between cities, marked by old scars on his off-hand and the habit of speaking only when spoken to. Known to keep the company of stray dogs at every inn he passes through.'
const LONG_B =
  'A city guardsman posted at the eastern gate, terse and slow to anger; identified by the inverted phoenix sigil on his pauldron and the half-moon scar across his right eyebrow that the captain claims is from a tavern brawl, though Kael never confirms.'

const GATE_REASON = 'Generation is in flight. Cancel to edit.'

const lineClamp = (node: HTMLElement) =>
  getComputedStyle(node).getPropertyValue('-webkit-line-clamp')

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
const resolveError = () => Promise.reject(new Error('Write failed (story stub)'))

function ControlledDialog({
  initialOpen = true,
  entityA: a,
  entityB: b,
  onResolve,
  blockedReason,
}: {
  initialOpen?: boolean
  entityA: EntitySummary
  entityB: EntitySummary
  onResolve: (r: Resolution) => Promise<void>
  blockedReason?: string
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
    const row = await screen.findByRole('group', { name: 'Priority' })
    for (const label of ['Name', 'Description', 'Status', 'Retired reason', 'Injection mode'])
      expect(screen.queryByRole('group', { name: label })).toBeNull()
    expect(within(row).getByRole('button', { name: '20' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: '5' })).toBeInTheDocument()
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
    await waitFor(() => expect(lineClamp(screen.getByText(LONG_A))).toBe('3'))
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
    const pickAText = within(pickA).getByText(/ · Canonical$/)
    expect(pickAText.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      pickA.getBoundingClientRect().bottom,
    )

    // Stacked choices carry their own captions, so the column header row is absent.
    expect(screen.queryByText(/^Older · .+ · Canonical$/)).toBeNull()

    // A is the picked side, so tapping B's prose is the only tap that could wrongly pick.
    await userEvent.click(screen.getByText(LONG_B))

    await waitFor(() => expect(lineClamp(screen.getByText(LONG_B))).toBe('none'))
    expect(lineClamp(screen.getByText(LONG_A))).toBe('3')
    expect(older).toHaveAttribute('aria-checked', 'true')
    expect(newer).toHaveAttribute('aria-checked', 'false')

    await userEvent.click(newer)
    await waitFor(() => expect(newer).toHaveAttribute('aria-checked', 'true'))
  },
}

export const MergeOverlapFootnote: Story = {
  render: () => (
    <ControlledDialog
      entityA={entityA}
      entityB={{
        ...entityB,
        // A case variant, so a footnote naming the wrong row is visible.
        name: 'KAEL',
        relationCounts: {
          ...entityB.relationCounts,
          overlap: { awareness: 2, involvements: 1, relationships: 0, holdersLosingItem: 0 },
        },
      }}
      onResolve={resolveOk}
    />
  ),
  play: async () => {
    // Side identification and the canonical marker: column headers and the picker agree.
    expect(await screen.findByText(/^Older · .+ · Canonical$/)).toBeInTheDocument()
    expect(screen.getByText(/^Newer · [^·]+$/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^Kael · .+ · Canonical$/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^KAEL · [^·]+$/ })).toBeInTheDocument()
    expect(screen.getByText('Moves on merge (KAEL → Kael)')).toBeInTheDocument()

    expect(
      await screen.findByText(
        'Kael already has 2 of these awareness rows: it keeps its own, and the duplicates are dropped.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Kael already takes part in 1 of these happenings: it keeps its involvement, and the duplicate is dropped.',
      ),
    ).toBeInTheDocument()

    // With B canonical the summary shows A's counts, and A overlaps nothing.
    await userEvent.click(screen.getByRole('radio', { name: /^KAEL · / }))
    await waitFor(() => expect(screen.queryByText(/already has/)).toBeNull())
    expect(screen.getByText('Moves on merge (Kael → KAEL)')).toBeInTheDocument()
    expect(screen.getByText(/^Newer · .+ · Canonical$/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /^KAEL · .+ · Canonical$/ })).toBeInTheDocument()
  },
}

export const MergeCanonicalFlip: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveOk} />,
}

export const MergeLoading: Story = {
  // Visual-only: the dialog gates close while submitting (`handleOpenChange`),
  // so the never-resolving driver leaves
  // body scroll-locked between tests. Skipped from vitest via
  // `tags: { exclude: ['no-vitest'] }` in vitest.config.ts.
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
    await userEvent.click(await screen.findByRole('button', { name: /^Merge into / }))

    const resolution = lastResolution as Resolution | null
    expect(resolution).not.toBeNull()
    expect(resolution).toMatchObject({
      mode: 'merge',
      // The losing side's aliases survive and the deselected one is dropped; the case
      // variant was one keyword all along, in the older side's spelling.
      finalKeywords: ['the gate guard', 'the swordsman'],
      finalTags: ['guard', 'hero', 'sword'],
    })
  },
}

export const MergeAgreeingListsKeepCanonical: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity({ tags: ['hero', 'sword'], keywords: ['the swordsman', 'the wanderer'] })}
      entityB={baseEntity({
        id: 'ent_kael_2',
        tags: ['sword', 'hero'],
        keywords: ['The Wanderer', 'the swordsman'],
      })}
      onResolve={resolveCapturing}
    />
  ),
  play: async () => {
    lastResolution = null
    // Both partitions are null, so no chips render: pick B canonical and submit.
    await userEvent.click((await screen.findAllByRole('radio', { name: /^Kael · / }))[1])
    await userEvent.click(await screen.findByRole('button', { name: /^Merge into / }))

    const resolution = lastResolution as Resolution | null
    expect(resolution).not.toBeNull()
    // The canonical's own lists, in its own order and spelling; A's sorted copy would differ.
    expect(resolution).toMatchObject({
      mode: 'merge',
      canonicalId: 'ent_kael_2',
      finalTags: ['sword', 'hero'],
      finalKeywords: ['The Wanderer', 'the swordsman'],
    })
  },
}

export const MergeKeywordsInCanonicalSpelling: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity({ keywords: ['the swordsman', 'the wanderer'] })}
      entityB={baseEntity({ id: 'ent_kael_2', keywords: ['The Swordsman', 'the gate guard'] })}
      onResolve={resolveCapturing}
    />
  ),
  play: async () => {
    lastResolution = null
    await userEvent.click((await screen.findAllByRole('radio', { name: /^Kael · / }))[1])
    // The shared keyword shows, and is written, as the canonical spells it.
    expect(await screen.findByRole('button', { name: 'The Swordsman' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'the swordsman' })).toBeNull()
    await userEvent.click(await screen.findByRole('button', { name: /^Merge into / }))

    expect(lastResolution).toMatchObject({
      canonicalId: 'ent_kael_2',
      finalKeywords: ['The Swordsman', 'the gate guard', 'the wanderer'],
    })
  },
}

export const MergeKeywordDeselectSurvivesFlip: Story = {
  render: () => (
    <ControlledDialog
      entityA={baseEntity({ keywords: ['The Swordsman', 'the wanderer'] })}
      entityB={baseEntity({ id: 'ent_kael_2', keywords: ['the swordsman', 'the gate guard'] })}
      onResolve={resolveCapturing}
    />
  ),
  play: async () => {
    lastResolution = null
    await userEvent.click(await screen.findByRole('button', { name: 'The Swordsman' }))
    await userEvent.click(screen.getAllByRole('radio', { name: /^Kael · / })[1])
    await userEvent.click(await screen.findByRole('button', { name: /^Merge into / }))

    expect(lastResolution).toMatchObject({
      finalKeywords: ['the gate guard', 'the wanderer'],
    })
  },
}

export const MergeError: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveError} />,
}

export const RenameMode: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveOk} />,
}

export const RenameCaseOnly: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveOk} />,
  play: async () => {
    await userEvent.click(await screen.findByRole('radio', { name: 'Rename one' }))
    const save = () => screen.getByRole('button', { name: 'Save renames' })
    expect(save()).toBeDisabled()
    expect(screen.getByText('Change at least one name to clear the collision.')).toBeInTheDocument()
    // Nothing edited yet: the disabled reason says what the help line says.
    expect(save().closest('[title]')).toHaveAttribute(
      'title',
      'Change at least one name to clear the collision.',
    )

    const inputs = await screen.findAllByRole('textbox')
    await userEvent.clear(inputs[1])
    await userEvent.type(inputs[1], 'KAEL')

    expect(await screen.findByText(/still collide/)).toBeInTheDocument()
    expect(save()).toBeDisabled()
    expect(save().closest('[title]')).toHaveAttribute(
      'title',
      expect.stringContaining('still collide'),
    )

    await userEvent.type(inputs[1], ' the Guard')

    await waitFor(() => expect(save()).not.toBeDisabled())
    expect(screen.getByText('Change at least one name to clear the collision.')).toBeInTheDocument()
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
    await userEvent.type(inputs[1], ' the Guard  ')
    await userEvent.click(screen.getByRole('button', { name: 'Save renames' }))

    await waitFor(() => expect(lastResolution).not.toBeNull())
    expect(lastResolution).toEqual({
      mode: 'rename',
      renames: [{ id: 'ent_kael_2', newName: 'Kael the Guard' }],
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
    await userEvent.type(inputs[1], ' the Guard')
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
    // Dirty the first input so the Save button enables.
    const inputs = await screen.findAllByRole('textbox')
    await userEvent.type(inputs[0], ' edit')
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
