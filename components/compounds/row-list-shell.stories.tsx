import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import { Text } from '@/components/ui/text'

import { RowListRow, useRowExpansion } from './row-list-shell'

type DemoRow = { id: string; name: string }

// Exercises useRowExpansion + RowListRow together, the same pairing every
// consumer (LoreList, the wizard cast list) uses — a story against either
// piece alone wouldn't catch a mismatch at the seam between them.
function Demo({ rows: initialRows, invalidId }: { rows: DemoRow[]; invalidId?: string }) {
  const [rows, setRows] = useState(initialRows)
  const { expanded, toggle } = useRowExpansion(rows)

  return (
    <>
      {rows.map((row) => (
        <RowListRow
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
        />
      ))}
    </>
  )
}

const meta: Meta<typeof RowListRow> = {
  title: 'Compounds/RowListShell',
  component: RowListRow,
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
type Story = StoryObj<typeof RowListRow>

export const Default: Story = {
  render: () => (
    <Demo
      rows={[
        { id: 'a', name: 'First row' },
        { id: 'b', name: 'Second row' },
      ]}
    />
  ),
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

export const ExpandRevealsEditorInPlaceOfCompactSummary: Story = {
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
