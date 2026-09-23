// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { Happening, Thread } from '@/lib/db'
import type { PlotKind } from '@/lib/list-modules'

import { usePlotSelection } from './use-plot-selection'

function thread(id: string, title: string, extra: Partial<Thread> = {}): Thread {
  return {
    id,
    branchId: 'br_1',
    title,
    description: null,
    category: null,
    icon: null,
    status: 'active',
    injectionMode: 'auto',
    triggeredAtEntryId: null,
    resolvedAtEntryId: null,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

function happening(id: string, title: string, extra: Partial<Happening> = {}): Happening {
  return {
    id,
    branchId: 'br_1',
    title,
    description: null,
    category: null,
    icon: null,
    temporal: null,
    occurredAtEntryId: null,
    commonKnowledge: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

const THREADS = [thread('t_1', 'Amulet'), thread('t_2', 'Trust')]
const HAPPENINGS = [happening('h_1', 'Ambush')]

type Props = {
  initialId: string | null
  kind: PlotKind
  threads: readonly Thread[]
  happenings: readonly Happening[]
  ready: boolean
}

function setup(initial: Props) {
  return renderHook((props: Props) => usePlotSelection(props), { initialProps: initial })
}

afterEach(cleanup)

describe('usePlotSelection', () => {
  it('selects the row an initial id resolves to', () => {
    const hook = setup({
      initialId: 't_1',
      kind: 'thread',
      threads: THREADS,
      happenings: HAPPENINGS,
      ready: true,
    })
    expect(hook.result.current.selection).toEqual({ type: 'thread', row: THREADS[0] })
  })

  it('clears a selected row that disappears only once ready', () => {
    const hook = setup({
      initialId: 't_1',
      kind: 'thread',
      threads: THREADS,
      happenings: HAPPENINGS,
      ready: true,
    })
    expect(hook.result.current.selection).toEqual({ type: 'thread', row: THREADS[0] })

    hook.rerender({
      initialId: 't_1',
      kind: 'thread',
      threads: [],
      happenings: HAPPENINGS,
      ready: false,
    })
    expect(hook.result.current.selection).toBeNull()
    expect(hook.result.current.selectedId).toBe('t_1')

    hook.rerender({
      initialId: 't_1',
      kind: 'thread',
      threads: [],
      happenings: HAPPENINGS,
      ready: true,
    })
    expect(hook.result.current.selectedId).toBeNull()
  })

  it('starts create mode and clears the selected id', () => {
    const hook = setup({
      initialId: 't_1',
      kind: 'thread',
      threads: THREADS,
      happenings: HAPPENINGS,
      ready: true,
    })
    act(() => hook.result.current.startCreate())
    expect(hook.result.current.selection).toEqual({ type: 'create', kind: 'thread', seq: 1 })
    expect(hook.result.current.selectedId).toBeNull()
  })

  it('gives a repeat startCreate a fresh create identity', () => {
    const hook = setup({
      initialId: null,
      kind: 'thread',
      threads: THREADS,
      happenings: HAPPENINGS,
      ready: true,
    })
    act(() => hook.result.current.startCreate())
    act(() => hook.result.current.startCreate())
    expect(hook.result.current.selection).toEqual({ type: 'create', kind: 'thread', seq: 2 })
  })

  it('select leaves create mode', () => {
    const hook = setup({
      initialId: null,
      kind: 'thread',
      threads: THREADS,
      happenings: HAPPENINGS,
      ready: true,
    })
    act(() => hook.result.current.startCreate())
    expect(hook.result.current.creating).toBe(true)
    act(() => hook.result.current.select('t_2'))
    expect(hook.result.current.creating).toBe(false)
    expect(hook.result.current.selection).toEqual({ type: 'thread', row: THREADS[1] })
  })

  it('a kind switch with an id from the other kind yields no selection', () => {
    const hook = setup({
      initialId: 't_1',
      kind: 'thread',
      threads: THREADS,
      happenings: HAPPENINGS,
      ready: true,
    })
    expect(hook.result.current.selection).toEqual({ type: 'thread', row: THREADS[0] })
    hook.rerender({
      initialId: 't_1',
      kind: 'happening',
      threads: THREADS,
      happenings: HAPPENINGS,
      ready: true,
    })
    expect(hook.result.current.selection).toBeNull()
  })
})
