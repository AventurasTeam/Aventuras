import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import type { Delta, Happening, Thread } from '@/lib/db'
import type { HistoryChunk, HistoryQuery } from '@/lib/history'
import { happeningsStore, threadsStore } from '@/lib/stores'

import { HistoryLoaderProvider } from './history-loader'
import { HistoryTab } from './history-tab'
import { withQueryClient } from './with-query-client'

const delta = (
  targetTable: string,
  targetId: string,
  undoPayload: Record<string, unknown>,
): Delta => ({
  id: `delta_${targetId}`,
  branchId: 'br_1',
  entryId: null,
  actionId: 'act_1',
  logPosition: 1,
  source: 'periodic_classifier',
  targetTable,
  targetId,
  op: 'update',
  undoPayload,
  encodingVersion: 1,
  createdAt: Date.now() - 60_000,
})

const queries: HistoryQuery[] = []

// A filtered query matches nothing, so the no-match state is reachable.
const load = async (query: HistoryQuery): Promise<HistoryChunk> => {
  queries.push(query)
  if (query.op != null || (query.search ?? '') !== '') return { rows: [], nextCursor: null }
  return {
    rows: [
      query.targetTable === 'threads'
        ? delta('threads', 'thread_amulet', { status: 'pending' })
        : delta('happenings', 'hap_fire', { commonKnowledge: 0 }),
    ],
    nextCursor: null,
  }
}

function hydrateTargets(): () => void {
  threadsStore.hydrate('br_1', [
    {
      id: 'thread_amulet',
      branchId: 'br_1',
      title: 'What the amulet wants',
      description: null,
      category: null,
      icon: null,
      status: 'active',
      injectionMode: 'auto',
      triggeredAtEntryId: null,
      resolvedAtEntryId: null,
      embeddingStale: 0,
      createdAt: 1,
      updatedAt: 1,
    } satisfies Thread,
  ])
  happeningsStore.hydrate('br_1', [
    {
      id: 'hap_fire',
      branchId: 'br_1',
      title: 'The keep burns',
      description: null,
      category: null,
      icon: null,
      temporal: null,
      occurredAtEntryId: null,
      commonKnowledge: 1,
      embeddingStale: 0,
      createdAt: 1,
      updatedAt: 1,
    } satisfies Happening,
  ])
  return () => {
    threadsStore.__reset()
    happeningsStore.__reset()
  }
}

const meta: Meta<typeof HistoryTab> = {
  title: 'Compounds/History/HistoryTab',
  component: HistoryTab,
  parameters: { layout: 'padded' },
  // Per story, with cleanup, so the hydrated rows can't leak into another file's stories.
  beforeEach: () => {
    queries.length = 0
    return hydrateTargets()
  },
  decorators: [
    (Story) => (
      <HistoryLoaderProvider value={load}>
        <Story />
      </HistoryLoaderProvider>
    ),
    withQueryClient,
  ],
}
export default meta
type Story = StoryObj<typeof HistoryTab>

export const ThreadRow: Story = {
  args: { branchId: 'br_1', targetTable: 'threads', targetId: 'thread_amulet' },
  play: async () => {
    const [row] = await screen.findAllByTestId('delta-log-row')
    expect(within(row).getByText('What the amulet wants')).toBeVisible()
    expect(within(row).getByText('Modified Status')).toBeVisible()
  },
}

export const HappeningRow: Story = {
  args: { branchId: 'br_1', targetTable: 'happenings', targetId: 'hap_fire' },
  play: async () => {
    const [row] = await screen.findAllByTestId('delta-log-row')
    expect(within(row).getByText('The keep burns')).toBeVisible()
    expect(within(row).getByText('Modified Common knowledge')).toBeVisible()
  },
}

/** The op chip and the debounced search both reach the query, each from the first chunk. */
export const FiltersReachTheQuery: Story = {
  args: { branchId: 'br_1', targetTable: 'threads', targetId: 'thread_amulet' },
  play: async () => {
    await screen.findAllByTestId('delta-log-row')
    await userEvent.click(screen.getByRole('button', { name: 'Deleted' }))
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ op: 'delete', cursor: null }))
    expect(await screen.findByText('No changes match')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    await userEvent.type(screen.getByPlaceholderText('Search fields, changes…'), 'status')
    await waitFor(() =>
      expect(queries.at(-1)).toMatchObject({
        search: 'status',
        labelPaths: ['status'],
        cursor: null,
      }),
    )
    expect(queries.at(-1)?.op).toBeUndefined()
  },
}
