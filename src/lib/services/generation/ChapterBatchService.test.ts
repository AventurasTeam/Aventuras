/**
 * Tests for ChapterBatchService, the orchestrator behind "Generate chapters
 * from history". All AI/DB access is injected (same DI pattern as
 * ChapterService/LoreManagementCoordinator), so this exercises real
 * sequencing/branching logic against fakes rather than mocking modules.
 *
 * planChapterBoundaries itself is covered by ChapterBatchPlanner.test.ts —
 * here entries are built so the real planner produces a known, simple
 * boundary count (one narration entry per chapter), letting these tests
 * focus on what the service does with each boundary.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  ChapterBatchService,
  type ChapterBatchServiceDependencies,
  type ChapterBatchInput,
  type ChapterBatchCallbacks,
} from './ChapterBatchService'
import type { Chapter, StoryEntry, TimeTracker } from '$lib/types'
import type { ClassificationResult } from '$lib/services/ai/sdk'

/** `count` narration entries, 1000 tokens each — one boundary per entry at
 * threshold 1000 (all-narration avoids the turn-alignment extension, which
 * is covered separately by ChapterBatchPlanner.test.ts). */
function makeEntries(count: number): StoryEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    storyId: 's1',
    type: 'narration',
    content: `entry ${i}`,
    parentId: null,
    position: i,
    createdAt: 0,
    metadata: { tokenCount: 1000 },
    branchId: null,
  })) as StoryEntry[]
}

function makeChapter(n: number): Chapter {
  return {
    id: `chapter-${n}`,
    storyId: 's1',
    number: n,
    title: null,
    startEntryId: `e${n - 1}`,
    endEntryId: `e${n - 1}`,
    entryCount: 1,
    summary: `Summary ${n}`,
    startTime: null,
    endTime: null,
    keywords: [],
    characters: [],
    locations: [],
    plotThreads: [],
    emotionalTone: null,
    branchId: null,
    createdAt: 0,
  }
}

function makeClassificationResult(
  timeProgression: ClassificationResult['scene']['timeProgression'] = 'hours',
): ClassificationResult {
  return {
    entryUpdates: {
      characterUpdates: [],
      locationUpdates: [],
      itemUpdates: [],
      storyBeatUpdates: [],
      newCharacters: [],
      newLocations: [],
      newItems: [],
      newStoryBeats: [],
    },
    scene: { presentCharacterNames: [], timeProgression },
  } as unknown as ClassificationResult
}

function baseInput(overrides: Partial<ChapterBatchInput> = {}): ChapterBatchInput {
  return {
    entries: makeEntries(3),
    startIndex: 0,
    tokenThreshold: 1000,
    chapterBuffer: 0,
    includeLorebook: false,
    includeTimeline: false,
    includeClassification: false,
    storyId: 'story-1',
    currentBranchId: null,
    lorebookEntries: [],
    mode: 'adventure',
    pov: 'second',
    tense: 'present',
    ...overrides,
  }
}

function baseCallbacks(overrides: Partial<ChapterBatchCallbacks> = {}): ChapterBatchCallbacks {
  return {
    isCancelled: () => false,
    onChapterProgress: vi.fn(),
    loreCallbacks: {
      onCreateEntry: vi.fn(async () => {}),
      onUpdateEntry: vi.fn(async () => {}),
      onDeleteEntry: vi.fn(async () => {}),
      onMergeEntries: vi.fn(async () => {}),
    },
    ...overrides,
  }
}

function baseDeps(
  overrides: Partial<ChapterBatchServiceDependencies> = {},
): ChapterBatchServiceDependencies {
  let counter = 0
  return {
    buildAndSaveChapter: vi.fn(async () => makeChapter(++counter)),
    runLoreManagement: vi.fn(async () => ({ changes: [], summary: 'ok', sessionId: 'sess-1' })),
    estimateChapterTimeline: vi.fn(async () => ({ years: 0, days: 0, hours: 1, minutes: 0 })),
    getTimeTracker: vi.fn(() => ({ years: 0, days: 0, hours: 0, minutes: 0 }) as TimeTracker),
    setTimeTracker: vi.fn(async () => {}),
    updateChapterTimes: vi.fn(async () => {}),
    getChapterEntries: vi.fn(() => [] as StoryEntry[]),
    classifyChapter: vi.fn(async () => makeClassificationResult()),
    applyClassificationResult: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('ChapterBatchService — sequential execution', () => {
  it('calls buildAndSaveChapter once per planned boundary, in order', async () => {
    const deps = baseDeps()
    const service = new ChapterBatchService(deps)

    const result = await service.run(baseInput(), baseCallbacks())

    expect(deps.buildAndSaveChapter).toHaveBeenCalledTimes(3)
    expect(deps.buildAndSaveChapter).toHaveBeenNthCalledWith(1, 0, 1)
    expect(deps.buildAndSaveChapter).toHaveBeenNthCalledWith(2, 1, 2)
    expect(deps.buildAndSaveChapter).toHaveBeenNthCalledWith(3, 2, 3)
    expect(result.cancelled).toBe(false)
    expect(result.chapters).toHaveLength(3)
  })

  it('reports progress after each chapter, not just at the end', async () => {
    const onChapterProgress = vi.fn()
    const service = new ChapterBatchService(baseDeps())

    await service.run(baseInput(), baseCallbacks({ onChapterProgress }))

    expect(onChapterProgress).toHaveBeenCalledTimes(4)
    expect(onChapterProgress).toHaveBeenNthCalledWith(1, 0, 3)
    expect(onChapterProgress).toHaveBeenNthCalledWith(2, 1, 3)
    expect(onChapterProgress).toHaveBeenNthCalledWith(3, 2, 3)
    expect(onChapterProgress).toHaveBeenNthCalledWith(4, 3, 3)
  })
})

describe('ChapterBatchService — cancellation', () => {
  it('stops before the next chapter once isCancelled() flips true, keeping chapters already created', async () => {
    const deps = baseDeps()
    const service = new ChapterBatchService(deps)
    let checks = 0
    const isCancelled = () => {
      checks++
      return checks > 2
    }

    const result = await service.run(
      baseInput({ entries: makeEntries(4) }),
      baseCallbacks({ isCancelled }),
    )

    expect(deps.buildAndSaveChapter).toHaveBeenCalledTimes(2)
    expect(result.cancelled).toBe(true)
    expect(result.chapters).toHaveLength(2)
  })

  it('does not run the lorebook pass when cancelled before any chapter was created', async () => {
    const deps = baseDeps()
    const service = new ChapterBatchService(deps)

    const result = await service.run(
      baseInput({ includeLorebook: true }),
      baseCallbacks({ isCancelled: () => true }),
    )

    expect(result.chapters).toHaveLength(0)
    expect(deps.runLoreManagement).not.toHaveBeenCalled()
  })
})

describe('ChapterBatchService — lorebook pass', () => {
  it('runs runLoreManagement exactly once for the whole batch, not once per chapter', async () => {
    const deps = baseDeps()
    const service = new ChapterBatchService(deps)

    await service.run(baseInput({ includeLorebook: true }), baseCallbacks())

    expect(deps.runLoreManagement).toHaveBeenCalledTimes(1)
  })

  it('passes every created chapter into the single lore session', async () => {
    const deps = baseDeps()
    const service = new ChapterBatchService(deps)

    await service.run(baseInput({ includeLorebook: true }), baseCallbacks())

    const chaptersArg = vi.mocked(deps.runLoreManagement).mock.calls[0][4]
    expect(chaptersArg).toHaveLength(3)
  })

  it('does not run the lorebook pass when includeLorebook is false', async () => {
    const deps = baseDeps()
    const service = new ChapterBatchService(deps)

    await service.run(baseInput({ includeLorebook: false }), baseCallbacks())

    expect(deps.runLoreManagement).not.toHaveBeenCalled()
  })
})

describe('ChapterBatchService — timeline step', () => {
  it('does not touch the time tracker when includeTimeline is false', async () => {
    const deps = baseDeps()
    const service = new ChapterBatchService(deps)

    await service.run(baseInput({ includeTimeline: false }), baseCallbacks())

    expect(deps.estimateChapterTimeline).not.toHaveBeenCalled()
    expect(deps.setTimeTracker).not.toHaveBeenCalled()
    expect(deps.updateChapterTimes).not.toHaveBeenCalled()
  })

  it('advances a running time tracker across chapters and brackets each chapter with it', async () => {
    let time: TimeTracker = { years: 0, days: 0, hours: 0, minutes: 0 }
    const setTimeTracker = vi.fn(async (t: TimeTracker) => {
      time = t
    })
    const getTimeTracker = vi.fn(() => time)
    const updateChapterTimes = vi.fn(async () => {})
    const deps = baseDeps({
      getTimeTracker,
      setTimeTracker,
      updateChapterTimes,
      estimateChapterTimeline: vi.fn(async () => ({ years: 0, days: 0, hours: 2, minutes: 0 })),
    })
    const service = new ChapterBatchService(deps)

    const result = await service.run(baseInput({ includeTimeline: true }), baseCallbacks())

    expect(result.chapters[0].startTime).toEqual({ years: 0, days: 0, hours: 0, minutes: 0 })
    expect(result.chapters[0].endTime).toEqual({ years: 0, days: 0, hours: 2, minutes: 0 })
    // Each chapter's start is the previous chapter's end — no gaps in the timeline.
    expect(result.chapters[1].startTime).toEqual(result.chapters[0].endTime)
    expect(result.chapters[2].startTime).toEqual(result.chapters[1].endTime)
    // The bracket is persisted onto the chapter the store actually holds.
    expect(updateChapterTimes).toHaveBeenNthCalledWith(
      1,
      'chapter-1',
      result.chapters[0].startTime,
      result.chapters[0].endTime,
    )
  })
})

describe('ChapterBatchService — classification step', () => {
  it('does not classify when includeClassification is false', async () => {
    const deps = baseDeps()
    const service = new ChapterBatchService(deps)

    await service.run(baseInput({ includeClassification: false }), baseCallbacks())

    expect(deps.classifyChapter).not.toHaveBeenCalled()
    expect(deps.applyClassificationResult).not.toHaveBeenCalled()
  })

  it('calls classifyChapter and applyClassificationResult once per chapter', async () => {
    const deps = baseDeps()
    const service = new ChapterBatchService(deps)

    await service.run(baseInput({ includeClassification: true }), baseCallbacks())

    expect(deps.classifyChapter).toHaveBeenCalledTimes(3)
    expect(deps.applyClassificationResult).toHaveBeenCalledTimes(3)
  })

  it('forces scene.timeProgression to none before applying, regardless of what the classifier returned', async () => {
    // The classifier's own coarse per-turn bump (up to 1 day) would double-count
    // on top of whatever Timeline already established at chapter granularity —
    // or apply a misleading bump when Timeline is off entirely.
    const deps = baseDeps({
      classifyChapter: vi.fn(async () => makeClassificationResult('days')),
    })
    const service = new ChapterBatchService(deps)

    await service.run(baseInput({ includeClassification: true }), baseCallbacks())

    const applied = vi.mocked(deps.applyClassificationResult).mock.calls[0][0]
    expect(applied.scene.timeProgression).toBe('none')
  })

  it('includes both the chapter summary and its raw entries in the classified content', async () => {
    const fakeEntry = { type: 'narration', content: 'the raw turn' } as StoryEntry
    const deps = baseDeps({ getChapterEntries: vi.fn(() => [fakeEntry]) })
    const service = new ChapterBatchService(deps)

    await service.run(baseInput({ includeClassification: true }), baseCallbacks())

    const content = vi.mocked(deps.classifyChapter).mock.calls[0][0]
    expect(content).toContain('Summary 1')
    expect(content).toContain('the raw turn')
  })
})

describe('ChapterBatchService — timeline + classification together', () => {
  it('classifies each chapter with its own timeline bracket, not a stale value', async () => {
    // Phase 2 (timeline) must fully finish, brackets and all, before phase 3
    // (classification) starts reading the time tracker — otherwise chapter 1
    // could be classified with chapter 3's time or vice versa.
    let time: TimeTracker = { years: 0, days: 0, hours: 0, minutes: 0 }
    const setTimeTracker = vi.fn(async (t: TimeTracker) => {
      time = t
    })
    const getTimeTracker = vi.fn(() => time)
    const deps = baseDeps({
      getTimeTracker,
      setTimeTracker,
      classifyChapter: vi.fn(async () => makeClassificationResult()),
      estimateChapterTimeline: vi.fn(async () => ({ years: 0, days: 0, hours: 3, minutes: 0 })),
    })
    const service = new ChapterBatchService(deps)

    await service.run(
      baseInput({ includeTimeline: true, includeClassification: true }),
      baseCallbacks(),
    )

    const calls = vi.mocked(deps.classifyChapter).mock.calls
    expect(calls[0][1]).toEqual({ years: 0, days: 0, hours: 3, minutes: 0 })
    expect(calls[1][1]).toEqual({ years: 0, days: 0, hours: 6, minutes: 0 })
    expect(calls[2][1]).toEqual({ years: 0, days: 0, hours: 9, minutes: 0 })
  })
})

describe('ChapterBatchService — progress callbacks', () => {
  it('reports granular progress during timeline and classification phases', async () => {
    const onTimelineProgress = vi.fn()
    const onClassificationProgress = vi.fn()
    const deps = baseDeps()
    const service = new ChapterBatchService(deps)

    await service.run(
      baseInput({ includeTimeline: true, includeClassification: true }),
      baseCallbacks({ onTimelineProgress, onClassificationProgress }),
    )

    expect(onTimelineProgress).toHaveBeenCalled()
    expect(onClassificationProgress).toHaveBeenCalled()
    expect(onTimelineProgress).toHaveBeenLastCalledWith(3, 3)
    expect(onClassificationProgress).toHaveBeenLastCalledWith(3, 3)
  })
})
