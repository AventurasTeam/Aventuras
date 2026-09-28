import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import type { Delta, Happening, Thread } from '@/lib/db'
import type { HistoryChunk, HistoryQuery, HistoryTable } from '@/lib/history'
import { generationStore, happeningsStore, threadsStore } from '@/lib/stores'

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

const WAIT = { timeout: 3000 }

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
    generationStore.__reset()
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
    await screen.findAllByTestId('delta-log-row', {}, WAIT)
    await userEvent.click(screen.getByRole('button', { name: 'Deleted' }))
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ op: 'delete', cursor: null }), WAIT)
    expect(await screen.findByText('No changes match', {}, WAIT)).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    await userEvent.type(screen.getByPlaceholderText('Search fields, changes…'), 'status')
    await waitFor(
      () =>
        expect(queries.at(-1)).toMatchObject({
          search: 'status',
          labelPaths: ['status'],
          cursor: null,
        }),
      WAIT,
    )
    expect(queries.at(-1)?.op).toBeUndefined()
  },
}

/** Clearing a no-match search keeps "No changes match" until the unfiltered log arrives. */
export const ClearingASearch: Story = {
  args: { branchId: 'br_1', targetTable: 'threads', targetId: 'thread_amulet' },
  play: async () => {
    const input = await screen.findByPlaceholderText('Search fields, changes…', {}, WAIT)
    await userEvent.type(input, 'zzz')
    expect(await screen.findByText('No changes match', {}, WAIT)).toBeVisible()

    // The wrong empty state may render for as little as one commit, so read every mutation record.
    let sawEmpty = false
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const texts = Array.from(record.addedNodes, (node) => node.textContent ?? '')
        if (record.type === 'characterData') texts.push(record.target.textContent ?? '')
        if (texts.some((text) => text.includes('No history yet'))) sawEmpty = true
      }
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    await userEvent.clear(input)
    await screen.findAllByTestId('delta-log-row', {}, WAIT)
    observer.disconnect()
    expect(sawEmpty).toBe(false)
  },
}

function SwitchTargetHarness() {
  const [target, setTarget] = useState<{ targetTable: HistoryTable; targetId: string }>({
    targetTable: 'threads',
    targetId: 'thread_amulet',
  })
  return (
    <View className="gap-3">
      <Button
        variant="secondary"
        size="sm"
        onPress={() => setTarget({ targetTable: 'happenings', targetId: 'hap_fire' })}
      >
        <Text>Switch to the happening</Text>
      </Button>
      <HistoryTab branchId="br_1" targetTable={target.targetTable} targetId={target.targetId} />
    </View>
  )
}

/** A target switch on the same mounted host drops the prior row's search and op filter. */
export const SwitchingTargetsResetsFilters: Story = {
  render: () => <SwitchTargetHarness />,
  play: async () => {
    await screen.findAllByTestId('delta-log-row', {}, WAIT)
    await userEvent.type(screen.getByPlaceholderText('Search fields, changes…'), 'status')
    await userEvent.click(screen.getByRole('button', { name: 'Deleted' }))
    await waitFor(() => expect(screen.getByText('No changes match')).toBeVisible(), WAIT)

    await userEvent.click(screen.getByRole('button', { name: 'Switch to the happening' }))
    await waitFor(
      () => expect(screen.getByPlaceholderText('Search fields, changes…')).toHaveValue(''),
      WAIT,
    )
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Deleted' })).toHaveAttribute('aria-pressed', 'false')
    const [row] = await screen.findAllByTestId('delta-log-row', {}, WAIT)
    expect(within(row).getByText('The keep burns')).toBeVisible()
  },
}

const reloadSpy = fn(
  async (_query: HistoryQuery): Promise<HistoryChunk> => ({
    rows: [delta('threads', 'thread_amulet', { status: 'pending' })],
    nextCursor: null,
  }),
)

/** `version` gets a fresh identity — and the log reloads from `cursor: null` — on a same-row
 * patch or a run/reversal settle, not just on mount. */
export const ReloadsOnRowPatchAndRunSettle: Story = {
  args: { branchId: 'br_1', targetTable: 'threads', targetId: 'thread_amulet' },
  decorators: [
    (Story) => (
      <HistoryLoaderProvider value={reloadSpy}>
        <Story />
      </HistoryLoaderProvider>
    ),
  ],
  play: async () => {
    await screen.findAllByTestId('delta-log-row', {}, WAIT)
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1), WAIT)
    expect(reloadSpy.mock.calls[0][0]).toEqual(expect.objectContaining({ cursor: null }))

    threadsStore.patch('br_1', {
      op: 'update',
      id: 'thread_amulet',
      columns: { title: 'What the amulet truly wants' },
    })
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(2), WAIT)
    expect(reloadSpy.mock.calls[1][0]).toEqual(expect.objectContaining({ cursor: null }))

    const runId = 'run_settle_test'
    generationStore.startRun({
      runId,
      kind: 'test_run',
      gateBehavior: 'no-gate',
      actionId: 'act_settle',
      storyId: null,
      branchId: 'br_1',
      abortController: new AbortController(),
      currentPhase: 'test',
      intermediates: {},
      terminal: Promise.resolve(),
      resolveTerminal: () => {},
    })
    generationStore.finishRun(runId)
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(3), WAIT)
    expect(reloadSpy.mock.calls[2][0]).toEqual(expect.objectContaining({ cursor: null }))
  },
}
