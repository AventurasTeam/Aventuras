import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'

import { ExpandableRow, useRowExpansion } from './expandable-row'

type DemoRow = { id: string; name: string }

// Exercises useRowExpansion + ExpandableRow together, the pairing every
// consumer uses — a story against either piece alone wouldn't catch a
// mismatch at the seam between them.
function Demo({
  rows: initialRows,
  invalidId,
  compactActionRowId,
  reseedTo,
}: {
  rows: DemoRow[]
  invalidId?: string
  compactActionRowId?: string
  /** When set, renders a test-only "Reseed rows" trigger that swaps `rows` wholesale. */
  reseedTo?: DemoRow[]
}) {
  const [rows, setRows] = useState(initialRows)
  const { expanded, toggle } = useRowExpansion(rows)

  return (
    <>
      {rows.map((row) => (
        <ExpandableRow
          key={row.id}
          invalid={row.id === invalidId}
          expanded={expanded.has(row.id)}
          onToggle={() => toggle(row.id)}
          onRemove={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
          removeLabel={`Remove ${row.name}`}
          expandLabel={`Expand ${row.name}`}
          collapseLabel={`Collapse ${row.name}`}
          compact={
            <View className="min-h-control-sm justify-center">
              <Text className="font-medium">{row.name}</Text>
            </View>
          }
          editor={<Text variant="muted">Editor body for {row.name}</Text>}
          compactAction={
            row.id === compactActionRowId ? (
              <Pressable accessibilityRole="button" aria-label={`Pin ${row.name}`}>
                <Text>Pin</Text>
              </Pressable>
            ) : undefined
          }
        />
      ))}
      {reseedTo ? (
        <Pressable
          accessibilityRole="button"
          aria-label="Reseed rows"
          onPress={() => setRows(reseedTo)}
        >
          <Text>Reseed rows</Text>
        </Pressable>
      ) : null}
    </>
  )
}

const meta: Meta<typeof ExpandableRow> = {
  title: 'Compounds/ExpandableRow',
  component: ExpandableRow,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <View className="w-[480px] gap-2 rounded-md bg-bg-base p-6">
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof ExpandableRow>

export const Default: Story = {
  render: () => (
    <Demo
      rows={[
        { id: 'a', name: 'First row' },
        { id: 'b', name: 'Second row' },
      ]}
      compactActionRowId="a"
    />
  ),
  play: async () => {
    // compactAction (e.g. a "pin"/"set as lead" affordance) sits left of
    // remove in source order — proves the slot lands where ExpandableRow's
    // JSX places it, since this prop has no other exerciser yet.
    const pin = screen.getByRole('button', { name: 'Pin First row' })
    const remove = screen.getByRole('button', { name: 'Remove First row' })
    expect(pin.compareDocumentPosition(remove) & 4).toBe(4)
  },
}

/** `invalid` swaps the row's border to `border-danger` — no other chrome change. */
export const WithInvalidRow: Story = {
  render: () => (
    <Demo
      rows={[
        { id: 'a', name: 'First row' },
        { id: 'b', name: 'Second row' },
      ]}
      invalidId="b"
    />
  ),
}

export const ExpandRevealsEditorBelowCompactRow: Story = {
  render: () => <Demo rows={[{ id: 'a', name: 'Only row' }]} />,
  play: async () => {
    expect(screen.queryByText('Editor body for Only row')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Expand Only row' }))
    expect(await screen.findByText('Editor body for Only row')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Collapse Only row' }))
    await waitFor(() =>
      expect(screen.queryByText('Editor body for Only row')).not.toBeInTheDocument(),
    )
  },
}

export const RemovingARowPrunesItsExpansionSoARecycledIdStartsCollapsed: Story = {
  // Regression for no-harmless-id-leaks.md at the compound level: the shell
  // owns this invariant now, and a break here must fail loudly instead of
  // only surfacing indirectly through an unrelated consumer's stories.
  render: () => (
    <Demo
      rows={[
        { id: 'dup-id', name: 'Row A' },
        { id: 'keep-id', name: 'Row B' },
      ]}
      reseedTo={[
        { id: 'keep-id', name: 'Row B' },
        { id: 'dup-id', name: 'Row C' },
      ]}
    />
  ),
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Expand Row A' }))
    expect(await screen.findByText('Editor body for Row A')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Remove Row A' }))
    await waitFor(() => expect(screen.queryByText('Row A')).not.toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Reseed rows' }))

    // Row C reuses "dup-id" — it must render collapsed, not pre-expanded
    // from the leaked "dup-id" entry left behind by Row A.
    expect(await screen.findByText('Row C')).toBeInTheDocument()
    expect(screen.queryByText('Editor body for Row C')).not.toBeInTheDocument()
  },
}

function mid(el: Element): number {
  const r = el.getBoundingClientRect()
  return (r.top + r.bottom) / 2
}

function row(compactAction?: ReactNode) {
  return (
    <ExpandableRow
      expanded={false}
      invalid={false}
      onToggle={() => {}}
      onRemove={() => {}}
      removeLabel="Remove row"
      expandLabel="Expand row"
      collapseLabel="Collapse row"
      compact={
        <View className="min-h-control-sm justify-center">
          <Text className="font-medium">char</Text>
        </View>
      }
      editor={<Text variant="muted">Editor body</Text>}
      compactAction={compactAction}
    />
  )
}

/**
 * Pins the cluster's centreline: a Button-sized `compactAction`, the 22px
 * icon-actions, `compact`'s first line and the row itself all share it.
 * Vacuous unless NativeWind classNames resolve under vitest (cssInterop).
 */
export const CompactActionCentresOnTheRow: Story = {
  render: () =>
    row(
      <Button variant="secondary" size="sm">
        <Text>Set as lead</Text>
      </Button>,
    ),
  play: async () => {
    const action = screen.getByRole('button', { name: 'Set as lead' })
    const remove = screen.getByRole('button', { name: 'Remove row' })
    const name = screen.getByText('char')
    const rowEl = action.closest('.rounded-md') as HTMLElement

    const a = action.getBoundingClientRect()
    const r = rowEl.getBoundingClientRect()
    // The controls differ in height by design; only their centres must agree.
    expect(a.height).toBeGreaterThan(remove.getBoundingClientRect().height)
    expect(Math.abs(mid(action) - mid(remove))).toBeLessThanOrEqual(1)
    expect(Math.abs(mid(action) - mid(name))).toBeLessThanOrEqual(1)
    // Centred in the row, not top-anchored with the slack dumped underneath.
    expect(Math.abs(a.top - r.top - (r.bottom - a.bottom))).toBeLessThanOrEqual(1)
    expect(Math.abs(mid(action) - mid(rowEl))).toBeLessThanOrEqual(1)
  },
}

/** Icon-only cluster (no `compactAction`) must centre on the same line box —
 *  otherwise consumers that pass no action, like lore-list, sit tilted. */
export const IconOnlyClusterStaysCentred: Story = {
  render: () => row(),
  play: async () => {
    const remove = screen.getByRole('button', { name: 'Remove row' })
    const name = screen.getByText('char')
    const rowEl = remove.closest('.rounded-md') as HTMLElement
    expect(Math.abs(mid(remove) - mid(name))).toBeLessThanOrEqual(1)
    expect(Math.abs(mid(remove) - mid(rowEl))).toBeLessThanOrEqual(1)
  },
}
