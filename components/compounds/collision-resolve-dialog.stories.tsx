import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { screen, userEvent } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes/registry'

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
    injectionMode: 'on-relevance',
    tags: ['hero', 'sword'],
    state: { hp: 100, mp: 30 },
    relationCounts: {
      awarenessRows: 12,
      involvements: 4,
      inverseRefs: 2,
      embeddings: 1,
      translationRows: 3,
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
  state: { hp: 90, post: 'east-gate' },
  relationCounts: {
    awarenessRows: 1,
    involvements: 0,
    inverseRefs: 0,
    embeddings: 1,
    translationRows: 0,
  },
})

const resolveOk = async (r: Resolution) => {
  console.log('[story] resolved:', r)
}
const resolveLoading = () => new Promise<void>(() => {})
const resolveError = () => Promise.reject(new Error('Write failed (story stub)'))

function ControlledDialog({
  initialOpen = true,
  entityA: a,
  entityB: b,
  onResolve,
}: {
  initialOpen?: boolean
  entityA: EntitySummary
  entityB: EntitySummary
  onResolve: (r: Resolution) => Promise<void>
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
      entityA={baseEntity({
        description:
          'A wandering swordsman drifting between cities, marked by old scars on his off-hand and the habit of speaking only when spoken to. Known to keep the company of stray dogs at every inn he passes through.',
      })}
      entityB={baseEntity({
        id: 'ent_kael_2',
        description:
          'A city guardsman posted at the eastern gate, terse and slow to anger; identified by the inverted phoenix sigil on his pauldron and the half-moon scar across his right eyebrow that the captain claims is from a tavern brawl, though Kael never confirms.',
      })}
      onResolve={resolveOk}
    />
  ),
}

export const MergeCanonicalFlip: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveOk} />,
}

export const MergeLoading: Story = {
  // Visual-only: the dialog gates close while submitting (collision-
  // resolve-dialog.tsx line 74), so the never-resolving driver leaves
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

export const MergeError: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveError} />,
}

export const RenameMode: Story = {
  render: () => <ControlledDialog entityA={entityA} entityB={entityB} onResolve={resolveOk} />,
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
