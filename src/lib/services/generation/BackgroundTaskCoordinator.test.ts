import { describe, it, expect, vi } from 'vitest'
import type { Chapter, MemoryConfig, StoryEntry } from '#lib/types/index.ts'
import { ActivityRecorder } from '#lib/services/activity/index.ts'
import { ChapterCards } from '#lib/services/chapterCreation/index.ts'
import {
  BackgroundTaskCoordinator,
  CUT_NO_LONGER_OPEN,
  type BackgroundTaskInput,
} from './BackgroundTaskCoordinator'
import type { LoreSessionInput } from './LoreManagementCoordinator'

const entries = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, metadata: {} }) as StoryEntry)

interface Overrides {
  analysis?: unknown
  summary?: () => Promise<unknown>
  lore?: () => Promise<unknown>
}

function setup(over: Overrides = {}) {
  const cutOpen = { value: true }
  const order: string[] = []
  const recorder = new ActivityRecorder()
  recorder.setReporting('tree')
  const turnId = recorder.startTurn('n41')
  const afterTurn = recorder.startStep('After the turn', { recordId: turnId })
  const cards = new ChapterCards()

  const deps = {
    chapterService: {
      analyzeForChapter: vi.fn(async (..._args: unknown[]) => {
        order.push('analysis')
        return (over.analysis ?? {
          shouldCreateChapter: true,
          optimalEndIndex: 6,
          keywords: [],
        }) as any
      }),
      summarizeChapter: vi.fn(async (..._args: unknown[]) => {
        order.push('summary')
        if (over.summary) return (await over.summary()) as any
        return { summary: 'They crossed.', title: 'The Ferry', keywords: [] } as any
      }),
      addChapter: vi.fn(async (..._args: unknown[]) => {}),
    },
    loreManagement: {
      runLoreManagement: vi.fn(async (..._args: unknown[]) => {
        order.push('lore')
        if (over.lore) return (await over.lore()) as any
        return { changes: [], summary: 'done', sessionId: 's' }
      }),
    },
    styleReview: { analyzeStyle: vi.fn() as any },
  }

  const loreSession = vi.fn((): LoreSessionInput => ({
    storyId: 'story',
    currentBranchId: 'b',
    lorebookEntries: [],
    chapters: [],
    recentEntries: [],
    mode: 'adventure',
    pov: 'second',
    tense: 'present',
  }))

  const onTurnWorkEnded = vi.fn((recorded: boolean) => {
    order.push(`turn ended (${recorded})`)
    if (recorded) recorder.endStep(afterTurn)
    else recorder.discardStep(afterTurn)
    recorder.endRecord(turnId)
  })

  const input: BackgroundTaskInput = {
    styleReview: {
      storyId: 'story',
      entries: [],
      mode: 'adventure',
      pov: 'second',
      tense: 'present',
      enabled: false,
      triggerInterval: 3,
      recentEntriesCount: 10,
      currentCounter: 0,
      shouldIncrement: false,
      source: 'test',
    },
    chapterCheck: {
      storyId: 'story',
      currentBranchId: 'b',
      entries,
      lastChapterEndIndex: 0,
      tokensSinceLastChapter: 5000,
      tokensOutsideBuffer: 5000,
      messagesSinceLastChapter: 10,
      memoryConfig: {
        tokenThreshold: 4000,
        chapterBuffer: 2,
        summaryDetail: 'auto',
      } as MemoryConfig,
      currentBranchChapters: [{ number: 6 } as Chapter],
      mode: 'adventure',
      pov: 'second',
      tense: 'present',
    },
    loreSession,
    loreCallbacks: {
      onCreateEntry: vi.fn(),
      onUpdateEntry: vi.fn(),
      onDeleteEntry: vi.fn(),
      onMergeEntries: vi.fn(),
    },
    activity: recorder,
    activityParentId: afterTurn,
    onTurnWorkEnded,
    chapterCard: {
      cards,
      anchorEntryId: 'n41',
      openRecord: (key) => recorder.startRecord(key, 'chapter'),
      reopenRecord: (key) => recorder.reopenRecord(key),
      closeRecord: (id) => recorder.endRecord(id),
      isCutOpen: () => cutOpen.value,
    },
  }

  const coordinator = new BackgroundTaskCoordinator(deps)
  const turnSteps = () => recorder.find('n41')!.steps
  const card = () => cards.forScope('story', 'b')[0]
  const cardSteps = () => recorder.find(card().recordKey)!.steps
  return {
    coordinator,
    input,
    deps,
    order,
    recorder,
    turnSteps,
    card,
    cardSteps,
    cards,
    loreSession,
    onTurnWorkEnded,
    cutOpen,
  }
}

describe('the turn stage', () => {
  it('records a check that says not yet, ends the turn, and starts no card', async () => {
    const t = setup({ analysis: { shouldCreateChapter: false } })

    await t.coordinator.runBackgroundTasks(t.input)

    expect(t.turnSteps().map((s) => [s.label, s.status, s.detail])).toEqual([
      ['After the turn', 'done', undefined],
      ['Chapter check', 'done', 'not yet'],
    ])
    expect(t.recorder.find('n41')?.endedAt).toBeDefined()
    expect(t.cards.forScope('story', 'b')).toEqual([])
  })

  it('records nothing, and drops its parent, when neither task is due', async () => {
    const t = setup()
    t.input.chapterCheck.tokensOutsideBuffer = 0

    await t.coordinator.runBackgroundTasks(t.input)

    expect(t.onTurnWorkEnded).toHaveBeenCalledWith(false)
    expect(t.turnSteps()).toEqual([])
    expect(t.deps.chapterService.analyzeForChapter).not.toHaveBeenCalled()
  })

  it('fails the check with the reason, and still ends the turn', async () => {
    const t = setup()
    t.deps.chapterService.analyzeForChapter.mockRejectedValue(new Error('401 · invalid API key'))

    await t.coordinator.runBackgroundTasks(t.input)

    expect(t.turnSteps()[1]).toMatchObject({
      label: 'Chapter check',
      status: 'failed',
      error: '401 · invalid API key',
    })
    expect(t.onTurnWorkEnded).toHaveBeenCalledWith(true)
    expect(t.cards.forScope('story', 'b')).toEqual([])
  })
})

describe('a cut chapter', () => {
  it('hands off from the check, ends the turn before the summary, and finishes the card', async () => {
    const t = setup()

    const result = await t.coordinator.runBackgroundTasks(t.input)

    expect(t.order).toEqual(['analysis', 'turn ended (true)', 'summary', 'lore'])
    expect(t.turnSteps().map((s) => s.label)).toEqual([
      'After the turn',
      'Chapter check',
      'Chapter 7 handed off',
    ])
    expect(t.card()).toMatchObject({
      number: 7,
      phase: 'finished',
      title: 'The Ferry',
      anchorEntryId: 'n41',
    })
    expect(t.cardSteps().map((s) => [s.label, s.status])).toEqual([
      ['Chapter summary', 'done'],
      ['Lore management', 'done'],
    ])
    expect(t.recorder.find(t.card().recordKey)?.endedAt).toBeDefined()
    expect(t.deps.chapterService.addChapter).toHaveBeenCalledWith(result.chapterCreation.chapter, {
      storyId: 'story',
      branchId: 'b',
    })
  })

  it('leaves no chapter when the summary fails, and says why', async () => {
    const t = setup({
      summary: async () => {
        throw new Error('provider down')
      },
    })

    const result = await t.coordinator.runBackgroundTasks(t.input)

    expect(result.chapterCreation.created).toBe(false)
    expect(t.deps.chapterService.addChapter).not.toHaveBeenCalled()
    expect(t.card()).toMatchObject({ phase: 'summary-failed', reason: 'provider down' })
    expect(t.cardSteps()[0]).toMatchObject({ status: 'failed', error: 'provider down' })
    expect(t.deps.loreManagement.runLoreManagement).not.toHaveBeenCalled()
  })

  it('does not run lore management once the branch is no longer open', async () => {
    const t = setup()
    t.loreSession.mockImplementation(() => {
      throw new Error('The story or branch this chapter belongs to is no longer open')
    })

    const result = await t.coordinator.runBackgroundTasks(t.input)

    expect(t.deps.loreManagement.runLoreManagement).not.toHaveBeenCalled()
    expect(result.loreManagement).toMatchObject({ completed: false })
    expect(t.card()).toMatchObject({
      phase: 'lore-incomplete',
      reason: 'The story or branch this chapter belongs to is no longer open',
    })
    expect(t.cardSteps()[1]).toMatchObject({ label: 'Lore management', status: 'failed' })
  })

  it('marks the card incomplete when lore management fails', async () => {
    const t = setup({
      lore: async () => {
        throw new Error('context overflow')
      },
    })

    await t.coordinator.runBackgroundTasks(t.input)

    expect(t.card()).toMatchObject({ phase: 'lore-incomplete', reason: 'context overflow' })
  })

  it('still runs, and still starts a card, with reporting off', async () => {
    const t = setup()
    t.recorder.setReporting('off')

    await t.coordinator.runBackgroundTasks(t.input)

    expect(t.card()).toMatchObject({ phase: 'finished' })
    expect(t.recorder.find(t.card().recordKey)).toBeNull()
  })

  it('offers a retry after a failed summary, and the retry finishes the card', async () => {
    let fail = true
    const t = setup({
      summary: async () => {
        if (fail) throw new Error('provider down')
        return { summary: 'They crossed.', title: 'The Ferry', keywords: [] }
      },
    })
    await t.coordinator.runBackgroundTasks(t.input)
    expect(t.card()).toMatchObject({ phase: 'summary-failed', retryable: true })

    fail = false
    await t.cards.retrySummary(t.card().id)

    expect(t.card()).toMatchObject({ phase: 'finished', summaryRuns: 2, retryable: false })
    expect(t.cardSteps().map((s) => [s.label, s.status])).toEqual([
      ['Chapter summary', 'failed'],
      ['Chapter summary (run 2)', 'done'],
      ['Lore management', 'done'],
    ])
    expect(t.recorder.find(t.card().recordKey)?.endedAt).toBeDefined()
  })

  it('refuses a retry once the cut is no longer open, quietly', async () => {
    const notify = vi.fn()
    const t = setup({
      summary: async () => {
        throw new Error('provider down')
      },
    })
    ;(t.cards as any).notify = notify
    await t.coordinator.runBackgroundTasks(t.input)
    t.cutOpen.value = false

    await t.cards.retrySummary(t.card().id)

    expect(t.card()).toMatchObject({
      phase: 'summary-failed',
      retryable: false,
      reason: CUT_NO_LONGER_OPEN,
    })
    expect(t.deps.chapterService.summarizeChapter).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledTimes(1)
  })
})
