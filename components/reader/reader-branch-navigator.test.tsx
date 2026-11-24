// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { createRef, type RefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '@/lib/db'
import { branchesStore, resetAllStores, type BranchRow } from '@/lib/stores'

import type { BranchNavigatorHandle, BranchNavigatorProps } from './branch-navigator'
import {
  branchChipOf,
  ReaderBranchNavigator,
  type ReaderBranchNavigatorHandle,
} from './reader-branch-navigator'

const stubs = vi.hoisted(() => ({
  navigator: null as BranchNavigatorProps | null,
  handle: { open: vi.fn(), close: vi.fn() },
  refresh: vi.fn(async (_db: unknown, _storyId: string) => {}),
}))

// The view has its own stories; this file pins what the connected piece feeds it.
vi.mock('./branch-navigator', async () => {
  const { useImperativeHandle } = await import('react')
  return {
    BranchNavigator: (props: BranchNavigatorProps) => {
      stubs.navigator = props
      useImperativeHandle(props.ref, (): BranchNavigatorHandle => stubs.handle, [])
      return null
    },
  }
})
// The runtime `db` is a bridge client; the refresh it is handed to is what this file pins.
vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  db: {},
}))
vi.mock('@/lib/stores', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  refreshBranches: stubs.refresh,
}))

function branch(id: string, name: string, createdAt: number): BranchRow {
  return { id, name, parentBranchId: null, forkEntryId: null, createdAt }
}

const MAIN = branch('br_main', 'Main', 1)
const FORK = branch('br_fork', 'The road not taken', 2)
const TRAP = branch('br_trap', 'The trap', 3)

const onSwitch = vi.fn<(branchId: string) => void>()
const onRename = vi.fn<(branchId: string, name: string) => Promise<unknown>>(async () => {})

function connected(
  overrides: {
    isFocused?: boolean
    paused?: boolean
    ref?: RefObject<ReaderBranchNavigatorHandle | null>
  } = {},
) {
  return (
    <ReaderBranchNavigator
      ref={overrides.ref}
      storyId="story_1"
      branchId="br_main"
      isFocused={overrides.isFocused ?? true}
      paused={overrides.paused ?? false}
      onSwitch={onSwitch}
      onRename={onRename}
    />
  )
}

describe('branchChipOf', () => {
  it('counts the rows and names the current branch', () => {
    expect(branchChipOf([MAIN, FORK, TRAP], 'br_main')).toEqual({ count: 3, currentName: 'Main' })
  })

  it("names the reader's branch wherever it sits in the rows", () => {
    expect(branchChipOf([MAIN, FORK, TRAP], 'br_fork')).toEqual({
      count: 3,
      currentName: 'The road not taken',
    })
  })

  it('gives no chip while the rows lack the branch', () => {
    expect(branchChipOf([MAIN, FORK], 'br_new')).toBeNull()
  })

  it('gives no chip with no rows', () => {
    expect(branchChipOf([], 'br_main')).toBeNull()
  })
})

describe('ReaderBranchNavigator', () => {
  beforeEach(() => {
    resetAllStores()
    stubs.navigator = null
    stubs.handle.open.mockClear()
    stubs.handle.close.mockClear()
    stubs.refresh.mockClear()
    onSwitch.mockClear()
    onRename.mockClear()
  })
  afterEach(() => {
    cleanup()
  })

  it('refreshes the branch store for its story on mount, and not on a rerender', () => {
    const { rerender } = render(connected())
    rerender(connected({ paused: true }))
    expect(stubs.refresh.mock.calls).toEqual([[db, 'story_1']])
  })

  it("hands the view its story's rows, the chip they derive and the reader's branch", () => {
    branchesStore.hydrate('story_1', [MAIN, FORK])
    render(connected())
    expect(stubs.navigator?.rows).toEqual([MAIN, FORK])
    expect(stubs.navigator?.chip).toEqual({ count: 2, currentName: 'Main' })
    expect(stubs.navigator?.currentBranchId).toBe('br_main')
  })

  it("hands no rows and no chip while the store holds another story's", () => {
    branchesStore.hydrate('story_other', [MAIN, FORK])
    render(connected())
    expect(stubs.navigator?.rows).toEqual([])
    expect(stubs.navigator?.chip).toBeNull()
  })

  it('follows the store when a refresh lands', () => {
    render(connected())
    expect(stubs.navigator?.chip).toBeNull()
    act(() => branchesStore.hydrate('story_1', [MAIN, FORK, TRAP]))
    expect(stubs.navigator?.chip).toEqual({ count: 3, currentName: 'Main' })
  })

  it('passes paused and both handlers through untouched', () => {
    render(connected({ paused: true }))
    expect(stubs.navigator?.paused).toBe(true)
    stubs.navigator?.onSwitch('br_fork')
    expect(onSwitch).toHaveBeenCalledWith('br_fork')
    void stubs.navigator?.onRename('br_fork', 'The trap')
    expect(onRename).toHaveBeenCalledWith('br_fork', 'The trap')
  })

  it('opens the view through its own handle', () => {
    const ref = createRef<ReaderBranchNavigatorHandle>()
    render(
      <ReaderBranchNavigator
        ref={ref}
        storyId="story_1"
        branchId="br_main"
        isFocused
        paused={false}
        onSwitch={onSwitch}
        onRename={onRename}
      />,
    )
    ref.current?.open()
    expect(stubs.handle.open).toHaveBeenCalledTimes(1)
  })

  // A held open (phone `Browse branches…`, run after the Actions Sheet's exit) can land after a
  // Go-to row pushed another screen.
  it('opens nothing while the reader is out of focus', () => {
    const ref = createRef<ReaderBranchNavigatorHandle>()
    const { rerender } = render(connected({ ref }))
    rerender(connected({ ref, isFocused: false }))
    ref.current?.open()
    expect(stubs.handle.open).not.toHaveBeenCalled()
    rerender(connected({ ref }))
    ref.current?.open()
    expect(stubs.handle.open).toHaveBeenCalledTimes(1)
  })

  it("refreshes the rows as it opens while they lack the reader's branch", () => {
    const ref = createRef<ReaderBranchNavigatorHandle>()
    branchesStore.hydrate('story_1', [FORK])
    render(connected({ ref }))
    ref.current?.open()
    expect(stubs.refresh.mock.calls).toEqual([
      [db, 'story_1'],
      [db, 'story_1'],
    ])
    expect(stubs.handle.open).toHaveBeenCalledTimes(1)
  })

  it("opens on the rows it holds when they hold the reader's branch", () => {
    const ref = createRef<ReaderBranchNavigatorHandle>()
    branchesStore.hydrate('story_1', [MAIN, FORK])
    render(connected({ ref }))
    ref.current?.open()
    expect(stubs.refresh.mock.calls).toEqual([[db, 'story_1']])
    expect(stubs.handle.open).toHaveBeenCalledTimes(1)
  })

  it('closes when the reader loses focus, and stays shut on refocus', () => {
    const { rerender } = render(connected())
    expect(stubs.handle.close).not.toHaveBeenCalled()
    rerender(connected({ isFocused: false }))
    expect(stubs.handle.close).toHaveBeenCalledTimes(1)
    rerender(connected())
    expect(stubs.handle.close).toHaveBeenCalledTimes(1)
    expect(stubs.handle.open).not.toHaveBeenCalled()
  })
})
