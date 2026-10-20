import { describe, it, expect, vi } from 'vitest'
import type { Chapter, Entry, LoreManagementResult } from '#lib/types/index.ts'
import { ActivityRecorder } from '#lib/services/activity/index.ts'
import {
  LORE_SESSION_BUSY,
  LoreManagementCoordinator,
  isLoreManagementRunning,
  type LoreManagementCallbacks,
  type LoreManagementDependencies,
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
  onSaveSession: vi.fn(async () => {}),
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

  it("names the failed session's chapter, so a retry runs it for that chapter", async () => {
    const chapter = { id: 'ch-1', number: 3 } as unknown as Chapter
    const coordinator = new LoreManagementCoordinator({
      runLoreManagement: vi.fn(async () => {
        throw new Error('branch switched')
      }),
    })
    const ui = { onStart: vi.fn(), onProgress: vi.fn(), onComplete: vi.fn(), onError: vi.fn() }

    await coordinator.runSession(
      input({ storyId: 'story-9', newChapter: { chapter, entries: [] } }),
      callbacks(),
      ui,
    )
    await coordinator.runSession(input({ storyId: 'story-9' }), callbacks(), ui)

    expect(ui.onError.mock.calls).toEqual([
      ['branch switched', chapter],
      ['branch switched', undefined],
    ])
  })
})

describe('progress reporting', () => {
  it('counts a saved session once, through the wrapper and not the callbacks', async () => {
    const created: string[] = []
    const coordinator = new LoreManagementCoordinator({
      runLoreManagement: async (_s, _b, _e, _r, _c, cb) => {
        await cb.onSaveSession({
          creates: [{ id: 'a', name: 'Kaelen' } as Entry, { id: 'b', name: 'Liora' } as Entry],
          updates: [],
          merges: [],
          deletes: [],
        })
        return { changes: [{ type: 'create' }, { type: 'create' }], summary: 'two', sessionId: 's' }
      },
    })
    const cbs = {
      ...callbacks(),
      onSaveSession: async (w: { creates: Entry[] }) =>
        void created.push(...w.creates.map((e) => e.name)),
    }
    const progress: number[] = []

    await coordinator.runSession(input({ storyId: 'story-3' }), cbs, {
      onStart: vi.fn(),
      onProgress: (_m, count) => progress.push(count),
      onComplete: vi.fn(),
    })

    expect(created).toEqual(['Kaelen', 'Liora'])
    // Nothing counted until the save lands, then the session at once, then the final total.
    expect(progress).toEqual([0, 2, 2])
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

describe('newChapter forwarding', () => {
  it('forwards newChapter to runLoreManagement when the caller passes one', async () => {
    const chapter = { id: 'ch-1', number: 3 } as unknown as Chapter
    const deps: LoreManagementDependencies = { runLoreManagement: vi.fn(async () => emptyResult()) }
    const coordinator = new LoreManagementCoordinator(deps)

    await coordinator.runSession(
      input({ storyId: 'story-5', newChapter: { chapter, entries: [] } }),
      callbacks(),
    )

    const options = vi.mocked(deps.runLoreManagement).mock.calls[0][6]
    expect(options?.newChapter).toEqual({ chapter, entries: [] })
  })

  it('passes no newChapter when the caller has none to give', async () => {
    const deps: LoreManagementDependencies = { runLoreManagement: vi.fn(async () => emptyResult()) }
    const coordinator = new LoreManagementCoordinator(deps)

    await coordinator.runSession(input({ storyId: 'story-6' }), callbacks())

    const options = vi.mocked(deps.runLoreManagement).mock.calls[0][6]
    expect(options?.newChapter).toBeUndefined()
  })
})

describe('chapterBuffer forwarding', () => {
  it('forwards chapterBuffer to runLoreManagement, including 0', async () => {
    const deps: LoreManagementDependencies = { runLoreManagement: vi.fn(async () => emptyResult()) }
    const coordinator = new LoreManagementCoordinator(deps)

    await coordinator.runSession(input({ storyId: 'story-7', chapterBuffer: 0 }), callbacks())

    const options = vi.mocked(deps.runLoreManagement).mock.calls[0][6]
    expect(options?.chapterBuffer).toBe(0)
  })

  it('passes no chapterBuffer when the caller sets none', async () => {
    const deps: LoreManagementDependencies = { runLoreManagement: vi.fn(async () => emptyResult()) }
    const coordinator = new LoreManagementCoordinator(deps)

    await coordinator.runSession(input({ storyId: 'story-8' }), callbacks())

    const options = vi.mocked(deps.runLoreManagement).mock.calls[0][6]
    expect(options?.chapterBuffer).toBeUndefined()
  })
})

describe('the recorded step', () => {
  function recorded() {
    const recorder = new ActivityRecorder()
    recorder.setReporting('tree')
    const recordId = recorder.startRecord('chapter:card', 'chapter')
    return { recorder, reporting: { activity: recorder, placement: { recordId } } }
  }
  const stepsOf = (recorder: ActivityRecorder) => recorder.find('chapter:card')!.steps

  it('closes done with the change count, and is the parent the run records under', async () => {
    const { recorder, reporting } = recorded()
    const runLoreManagement = vi.fn(async () => ({
      ...emptyResult(),
      changes: [{ type: 'create' as const }, { type: 'update' as const }],
    }))

    const result = await new LoreManagementCoordinator({ runLoreManagement }).runSession(
      input(),
      callbacks(),
      undefined,
      reporting,
    )

    const [step] = stepsOf(recorder)
    expect(step).toMatchObject({ label: 'Lore management', status: 'done', detail: '2 changes' })
    expect(runLoreManagement.mock.calls[0]).toContain(step.id)
    expect(result).toMatchObject({ completed: true, changeCount: 2 })
  })

  it('fails with the reason, and the result carries it', async () => {
    const { recorder, reporting } = recorded()
    const runLoreManagement = vi.fn(async () => {
      throw new Error('context overflow')
    })

    const result = await new LoreManagementCoordinator({ runLoreManagement }).runSession(
      input(),
      callbacks(),
      undefined,
      reporting,
    )

    expect(stepsOf(recorder)[0]).toMatchObject({ status: 'failed', error: 'context overflow' })
    expect(result).toMatchObject({ completed: false, error: 'context overflow' })
  })

  it('is skipped with the lock as its reason when another session holds the branch', async () => {
    const { recorder, reporting } = recorded()
    const first = gatedCoordinator()
    const running = first.coordinator.runSession(input(), callbacks())

    const result = await gatedCoordinator().coordinator.runSession(
      input(),
      callbacks(),
      undefined,
      reporting,
    )
    first.finish()
    await running

    expect(stepsOf(recorder)[0]).toMatchObject({ status: 'skipped', detail: LORE_SESSION_BUSY })
    expect(result).toMatchObject({ completed: false, skipped: true, error: LORE_SESSION_BUSY })
  })

  it('records nothing without reporting', async () => {
    const runLoreManagement = vi.fn(async (..._args: unknown[]) => emptyResult())

    await new LoreManagementCoordinator({ runLoreManagement }).runSession(input(), callbacks())

    expect(runLoreManagement.mock.calls[0][7]).toBeUndefined()
  })
})
