import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
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
          compact={<Text className="font-medium">{row.name}</Text>}
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

function midY(el: Element): number {
  const r = el.getBoundingClientRect()
  return (r.top + r.bottom) / 2
}

/**
 * A control-height `compactAction` (a Button, ~36px) sits beside 22px
 * icon-actions. Top-aligning them parked their centres 7px apart and let the
 * taller control drag the row off its own centre; the cluster centres on a
 * control-height line box instead. Asserting this needs NativeWind classNames
 * to actually resolve under vitest, which they do as of the storybook project's
 * cssInterop registration.
 */
export const CompactActionSharesTheIconActionCentreline: Story = {
  render: () => (
    <ExpandableRow
      expanded={false}
      invalid={false}
      onToggle={() => {}}
      onRemove={() => {}}
      removeLabel="Remove row"
      expandLabel="Expand row"
      collapseLabel="Collapse row"
      compact={<Text className="font-medium">char</Text>}
      editor={<Text variant="muted">Editor body</Text>}
      compactAction={
        <Button variant="secondary" size="sm">
          <Text>Set as lead</Text>
        </Button>
      }
    />
  ),
  play: async () => {
    const action = screen.getByRole('button', { name: 'Set as lead' })
    const remove = screen.getByRole('button', { name: 'Remove row' })
    const name = screen.getByText('char')

    // The two controls differ in height by design; only their centres must agree.
    expect(action.getBoundingClientRect().height).toBeGreaterThan(
      remove.getBoundingClientRect().height,
    )
    expect(Math.abs(midY(action) - midY(remove))).toBeLessThanOrEqual(1)
    // ...and the cluster tracks the summary's first line rather than floating
    // below it, which is what made the whole row read as badly centred.
    expect(Math.abs(midY(name) - midY(remove))).toBeLessThanOrEqual(3)
  },
}
