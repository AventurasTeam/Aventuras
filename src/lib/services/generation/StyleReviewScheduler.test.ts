import { describe, it, expect, vi } from 'vitest'
import { ActivityRecorder } from '#lib/services/activity/index.ts'
import { StyleReviewScheduler, type StyleReviewCheckInput } from './StyleReviewScheduler'

const input = (over: Partial<StyleReviewCheckInput> = {}): StyleReviewCheckInput => ({
  storyId: 'story',
  entries: [],
  mode: 'adventure',
  pov: 'second',
  tense: 'present',
  enabled: true,
  triggerInterval: 3,
  recentEntriesCount: 10,
  currentCounter: 2,
  shouldIncrement: true,
  source: 'test',
  ...over,
})

const review = (over = {}) => ({
  phrases: [],
  overallAssessment: 'Fine.',
  reviewedEntryCount: 3,
  timestamp: 0,
  ...over,
})

function recorded() {
  const recorder = new ActivityRecorder()
  recorder.setReporting('tree')
  recorder.startTurn('entry')
  const parentId = recorder.startStep('After the turn')
  return {
    reporting: { activity: recorder, parentId },
    parentId,
    steps: () => recorder.activeTurn!.steps.slice(1),
  }
}

describe('the recorded style review', () => {
  it('records a due review as an LLM step under the parent, passing it as the request parent', async () => {
    const { reporting, parentId, steps } = recorded()
    const analyzeStyle = vi.fn(async (..._args: unknown[]) => review())

    await new StyleReviewScheduler({ analyzeStyle }).checkAndTrigger(input(), undefined, reporting)

    const [step] = steps()
    expect(step).toMatchObject({ label: 'Style review', parentId, isLLM: true, status: 'done' })
    expect(analyzeStyle.mock.calls[0][5]).toBe(step.id)
  })

  it('records nothing when the review is not due', async () => {
    const { reporting, steps } = recorded()
    const analyzeStyle = vi.fn(async () => review())

    await new StyleReviewScheduler({ analyzeStyle }).checkAndTrigger(
      input({ currentCounter: 0 }),
      undefined,
      reporting,
    )

    expect(analyzeStyle).not.toHaveBeenCalled()
    expect(steps()).toEqual([])
  })

  it('fails the step with the reason the review absorbed, and still sets the result', async () => {
    const { reporting, steps } = recorded()
    const setResult = vi.fn()
    const analyzeStyle = vi.fn(async () => review({ failure: '401 · invalid API key' }))

    await new StyleReviewScheduler({ analyzeStyle }).checkAndTrigger(
      input(),
      { incrementCounter: vi.fn(), setLoading: vi.fn(), setResult },
      reporting,
    )

    expect(steps()[0]).toMatchObject({ status: 'failed', error: '401 · invalid API key' })
    expect(setResult).toHaveBeenCalled()
  })

  it('fails the step on a throw and stays non-fatal', async () => {
    const { reporting, steps } = recorded()
    const analyzeStyle = vi.fn(async () => {
      throw new Error('provider down')
    })

    const result = await new StyleReviewScheduler({ analyzeStyle }).checkAndTrigger(
      input(),
      undefined,
      reporting,
    )

    expect(result).toEqual({ triggered: false, failed: true })
    expect(steps()[0]).toMatchObject({ status: 'failed', error: 'provider down' })
  })
})
