// @vitest-environment jsdom
import { zodResolver } from '@hookform/resolvers/zod'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useMemo, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PlotSaveResult } from '@/lib/actions'
import type { Thread } from '@/lib/db'
import { threadDraftFrom, threadDraftSchema, type ThreadDraft } from '@/lib/plot'

import { usePlotRowSession } from './use-plot-row-session'
import { usePlotSelection } from './use-plot-selection'

// The real catalog pulls lucide-react-native, which node can't parse.
vi.mock('./plot-icon', () => ({ PLOT_ICON_KEYS: [] }))

const resolver = zodResolver(threadDraftSchema)
const noop = () => {}

function thread(id: string, title: string): Thread {
  return {
    id,
    branchId: 'br_1',
    title,
    description: null,
    category: null,
    icon: null,
    status: 'pending',
    injectionMode: 'auto',
    triggeredAtEntryId: null,
    resolvedAtEntryId: null,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

// The route's wiring: the save writes a row, and onSaved selects it.
function useHarness() {
  const [threads, setThreads] = useState<Thread[]>([])
  const plot = usePlotSelection({
    initialId: null,
    kind: 'thread',
    threads,
    happenings: [],
    ready: true,
  })
  const row = plot.selection?.type === 'thread' ? plot.selection.row : null
  const values = useMemo(() => threadDraftFrom(row), [row])
  const session = usePlotRowSession<ThreadDraft>({
    kind: 'thread',
    rowId: row?.id ?? null,
    createSeq: plot.selection?.type === 'create' ? plot.selection.seq : undefined,
    values,
    resolver,
    fieldLabel: (field) => field,
    issueText: (message) => message,
    onSave: async (draft): Promise<PlotSaveResult> => {
      const id = `t_${draft.title}`
      setThreads((prev) => [...prev, thread(id, draft.title)])
      return { status: 'ok', id }
    },
    onSaved: plot.select,
    onSession: noop,
  })
  return { plot, session }
}

afterEach(cleanup)

describe('usePlotRowSession', () => {
  it('opens a blank draft when [+] Blank from a dirty create is answered with Save', async () => {
    const hook = renderHook(() => useHarness())
    act(() => hook.result.current.plot.startCreate())
    act(() => hook.result.current.session.form.setValue('title', 'First', { shouldDirty: true }))
    act(() => hook.result.current.session.requestLeave(hook.result.current.plot.startCreate))
    await act(async () => {
      hook.result.current.session.resolveLeave('save')
    })
    expect(hook.result.current.plot.selection?.type).toBe('create')
    expect(hook.result.current.session.form.getValues().title).toBe('')
  })
})
