import { describe, it, expect, vi } from 'vitest'
import type { Entry, LoreManagementResult } from '$lib/types'
import {
  LoreManagementCoordinator,
  isLoreManagementRunning,
  type LoreManagementCallbacks,
  type LoreSessionInput,
} from './LoreManagementCoordinator'

const emptyResult = (): LoreManagementResult => ({
  changes: [],
  summary: 'nothing to do',
  sessionId: 's',
})

const input = (over: Partial<LoreSessionInput> = {}): LoreSessionInput => ({
  storyId: 'story-1',
  currentBranchId: null,
  lorebookEntries: [] as Entry[],
  chapters: [],
  recentEntries: [],
  mode: 'adventure',
  pov: 'second',
  tense: 'past',
  ...over,
})

const callbacks = (): LoreManagementCallbacks => ({
  onCreateEntry: vi.fn(async () => {}),
  onUpdateEntry: vi.fn(async () => {}),
  onDeleteEntry: vi.fn(async () => {}),
  onMergeEntries: vi.fn(async () => {}),
})

/** A coordinator whose run resolves only when the returned `finish` is called. */
function gatedCoordinator() {
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const runLoreManagement = vi.fn(async () => {
    await gate
    return emptyResult()
  })
  return {
    coordinator: new LoreManagementCoordinator({ runLoreManagement }),
    runLoreManagement,
    finish: () => release(),
  }
}

describe('the per-branch lock', () => {
  it('refuses a second session on the same branch instead of running it', async () => {
    // Two agents on one lorebook write over each other: each takes an index snapshot at
    // the start and edits by index, so the second one's writes land on entries the first
    // has already merged away.
    const first = gatedCoordinator()
    const second = gatedCoordinator()

    const running = first.coordinator.runSession(input(), callbacks())
    const rejected = await second.coordinator.runSession(input(), callbacks())

    expect(rejected).toMatchObject({ completed: false, skipped: true })
    expect(second.runLoreManagement).not.toHaveBeenCalled()

    first.finish()
    await running
  })

  it('lets two branches of one story run at the same time', async () => {
    // A branch has its own resolved view of the entries, so they are two lorebooks.
    const main = gatedCoordinator()
    const fork = gatedCoordinator()

    const a = main.coordinator.runSession(input({ currentBranchId: null }), callbacks())
    const b = fork.coordinator.runSession(input({ currentBranchId: 'branch-2' }), callbacks())

    expect(fork.runLoreManagement).toHaveBeenCalled()

    main.finish()
    fork.finish()
    await Promise.all([a, b])
  })

  it('releases the lock once the writes are done, not when the UI catches up', async () => {
    // The completion message lingers for a couple of seconds; the next run must not.
    const { coordinator, finish } = gatedCoordinator()
    const uiCallbacks = {
      onStart: vi.fn(),
      onProgress: vi.fn(),
      onComplete: vi.fn(),
    }

    const running = coordinator.runSession(input(), callbacks(), uiCallbacks)
    expect(isLoreManagementRunning('story-1', null)).toBe(true)

    finish()
    await running

    expect(isLoreManagementRunning('story-1', null)).toBe(false)
    // Still up: the lock and the message have different lifetimes on purpose.
    expect(uiCallbacks.onComplete).not.toHaveBeenCalled()
  })

  it('releases the lock when the session throws', async () => {
    const coordinator = new LoreManagementCoordinator({
      runLoreManagement: vi.fn(async () => {
        throw new Error('provider down')
      }),
    })

    const result = await coordinator.runSession(input({ storyId: 'story-2' }), callbacks())

    expect(result).toMatchObject({ completed: false })
    expect(result.skipped).toBeUndefined()
    expect(isLoreManagementRunning('story-2', null)).toBe(false)
  })
})

describe('progress reporting', () => {
  it('counts each applied change once, through the wrapper and not the callbacks', async () => {
    const created: string[] = []
    const coordinator = new LoreManagementCoordinator({
      runLoreManagement: async (_s, _b, _e, _r, _c, cb) => {
        await cb.onCreateEntry({ id: 'a', name: 'Kaelen' } as Entry)
        await cb.onCreateEntry({ id: 'b', name: 'Liora' } as Entry)
        return { changes: [{ type: 'create' }, { type: 'create' }], summary: 'two', sessionId: 's' }
      },
    })
    const cbs = { ...callbacks(), onCreateEntry: async (e: Entry) => void created.push(e.name) }
    const progress: number[] = []

    await coordinator.runSession(input({ storyId: 'story-3' }), cbs, {
      onStart: vi.fn(),
      onProgress: (_m, count) => progress.push(count),
      onComplete: vi.fn(),
    })

    expect(created).toEqual(['Kaelen', 'Liora'])
    // Two increments while running, then the final total.
    expect(progress).toEqual([1, 2, 2])
  })

  it('hands the summary over separately, since progress is wiped seconds later', async () => {
    const coordinator = new LoreManagementCoordinator({
      runLoreManagement: async () => ({
        changes: [],
        summary: 'merged Vor’koth',
        sessionId: 's',
      }),
    })
    const onSummary = vi.fn()

    await coordinator.runSession(input({ storyId: 'story-4' }), callbacks(), {
      onStart: vi.fn(),
      onProgress: vi.fn(),
      onSummary,
      onComplete: vi.fn(),
    })

    expect(onSummary).toHaveBeenCalledWith('merged Vor’koth', 0)
  })
})
