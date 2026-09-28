import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, within } from 'storybook/test'

import type { HistoryOp, HistoryRowView, HistorySort } from '@/lib/history'

import { HistoryTabView, type HistoryTabViewProps } from './history-tab-view'

const view = (overrides: Partial<HistoryRowView>): HistoryRowView => ({
  id: 'delta_1',
  op: 'update',
  source: 'user_edit',
  targetTable: 'entities',
  targetDisplayName: 'Kael',
  fieldPath: 'state.traits',
  summary: 'Modified Traits',
  entryId: null,
  createdAtRelative: '2 h ago',
  actionId: 'act_1',
  ...overrides,
})

const ROWS: HistoryRowView[] = [
  view({ id: 'd4', op: 'delete', fieldPath: null, summary: 'Deleted', source: 'user_edit' }),
  view({
    id: 'd3',
    source: 'periodic_classifier',
    entryId: 'entry #47',
    summary: 'Modified Traits, Drives',
    fieldPath: 'state.traits, state.drives',
  }),
  view({
    id: 'd2',
    source: 'piggyback_tagged_block',
    fieldPath: 'state.current_location_id',
    summary: 'Modified Current location',
  }),
  view({
    id: 'd1',
    op: 'create',
    fieldPath: null,
    summary: 'Created',
    source: 'periodic_classifier',
    entryId: 'entry #12',
  }),
]

type HarnessProps = Omit<
  HistoryTabViewProps,
  'filtered' | 'search' | 'onSearchChange' | 'op' | 'onOpChange' | 'sort' | 'onSortChange'
> & {
  onOp: (op: HistoryOp | null) => void
  /** Default previews the narrow host layout; a play clicking the toolbar needs it past
   * Toolbar's 1024px threshold, or the desktop-viewport guess remounts the chip mid-click
   * (lessons-learned/formrow-narrow-story-remount.md, same mechanism for Toolbar). */
  boxWidth?: number
}

function Harness({ boxWidth = 520, ...props }: HarnessProps) {
  const [search, setSearch] = useState('')
  const [op, setOp] = useState<HistoryOp | null>(null)
  const [sort, setSort] = useState<HistorySort>('newest')
  return (
    <View style={{ width: '100%', maxWidth: boxWidth }}>
      <HistoryTabView
        {...props}
        filtered={search.trim() !== '' || op != null}
        search={search}
        onSearchChange={setSearch}
        op={op}
        onOpChange={(next) => {
          setOp(next)
          props.onOp(next)
        }}
        sort={sort}
        onSortChange={setSort}
      />
    </View>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Compounds/History/HistoryTabView',
  component: Harness,
  parameters: { layout: 'padded' },
  args: { rows: ROWS, status: 'ready', hasMore: true, onLoadMore: fn(), onRetry: fn(), onOp: fn() },
}
export default meta
type Story = StoryObj<typeof Harness>

/** Every op and several sources; `entry #n` is meta text and rows aren't pressable. */
export const Populated: Story = {
  args: { boxWidth: 1100 },
  play: async ({ args }) => {
    const rows = await screen.findAllByTestId('delta-log-row')
    expect(rows).toHaveLength(4)
    expect(within(rows[1]).getByText('periodic classifier · entry #47 · 2 h ago')).toBeVisible()
    expect(screen.queryAllByRole('button', { name: /^update Kael/ })).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: 'Load older' }))
    expect(args.onLoadMore).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'Deleted' }))
    expect(args.onOp).toHaveBeenLastCalledWith('delete')
  },
}

export const LoadingOlder: Story = {
  args: { status: 'loading-more' },
  play: async () => {
    const button = await screen.findByRole('button', { name: /Load older/ })
    await expect(button).toBeDisabled()
    await expect(within(button).getByRole('progressbar')).toBeVisible()
  },
}

export const Empty: Story = {
  args: { rows: [], hasMore: false },
  play: async () => {
    expect(await screen.findByText('No history yet')).toBeVisible()
  },
}

/** An active filter turns the empty list into "no match", not "no history". */
export const NoResults: Story = {
  args: { rows: [], hasMore: false, boxWidth: 1100 },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Deleted' }))
    expect(await screen.findByText('No changes match')).toBeVisible()
    expect(screen.queryByText('No history yet')).toBeNull()
  },
}

export const Failed: Story = {
  args: { rows: [], status: 'failed', hasMore: false },
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(args.onRetry).toHaveBeenCalledTimes(1)
  },
}

/** Phone: search on its own row, chips and sort wrap beneath it. */
export const Phone: Story = { globals: { viewport: { value: 'mobile1' } } }
