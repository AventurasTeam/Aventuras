import { describe, expect, it } from 'vitest'

import type { RecoveredRun, RecoveryFailure, RecoveryReport } from '@/lib/pipeline'

import { formatRecoveryReport, formatRecoveryTitle } from './copy'

function recovered(kind: string, storyId: string | null): RecoveredRun {
  return {
    runId: `run_${kind}`,
    kind,
    actionId: `action_${kind}`,
    storyId,
    deltas: 1,
  }
}

function report(...reversed: RecoveredRun[]): RecoveryReport {
  return { reversed, failures: [] }
}

function failed(
  kind: string,
  storyId: string | null,
  refusal: RecoveryFailure['refusal'] = null,
): RecoveryFailure {
  return {
    runId: `run_${kind}`,
    kind,
    actionId: `action_${kind}`,
    storyId,
    error: new Error('could not reverse'),
    refusal,
  }
}

function failureReport(...failures: RecoveryFailure[]): RecoveryReport {
  return { reversed: [], failures }
}

describe('formatRecoveryReport', () => {
  it('formats a named per-turn recovery', () => {
    expect(
      formatRecoveryReport(report(recovered('per-turn', 'story_1')), {
        story_1: 'Mornstone',
      }),
    ).toBe(
      'An interrupted shutdown was detected in Mornstone. Your last AI response was reverted to keep the story consistent.',
    )
  })

  it('formats a named chapter-close recovery', () => {
    expect(
      formatRecoveryReport(report(recovered('chapter-close', 'story_1')), {
        story_1: 'Mornstone',
      }),
    ).toBe(
      'An interrupted shutdown was detected in Mornstone. The chapter-close pass was reverted; your story content is intact.',
    )
  })

  it('formats a named periodic-classifier recovery', () => {
    expect(
      formatRecoveryReport(report(recovered('periodic-classifier', 'story_1')), {
        story_1: 'Mornstone',
      }),
    ).toBe(
      'An interrupted shutdown was detected in Mornstone. A background memory update was reverted; your story content is intact.',
    )
  })

  it('uses unnamed copy for null and missing story IDs', () => {
    expect(formatRecoveryReport(report(recovered('per-turn', null)), {})).toBe(
      'An interrupted shutdown was detected. Your last AI response was reverted to keep the story consistent.',
    )
    expect(formatRecoveryReport(report(recovered('chapter-close', 'deleted')), {})).toBe(
      'An interrupted shutdown was detected. The chapter-close pass was reverted; your story content is intact.',
    )
  })

  it('joins multiple recovered runs into one paragraph', () => {
    expect(
      formatRecoveryReport(
        report(recovered('per-turn', 'story_1'), recovered('periodic-classifier', null)),
        { story_1: 'Mornstone' },
      ),
    ).toBe(
      'An interrupted shutdown was detected in Mornstone. Your last AI response was reverted to keep the story consistent. An interrupted shutdown was detected. A background memory update was reverted; your story content is intact.',
    )
  })

  it('formats an unknown named run kind with generic recovery copy', () => {
    expect(
      formatRecoveryReport(report(recovered('future-background-pass', 'story_1')), {
        story_1: 'Mornstone',
      }),
    ).toBe(
      'An interrupted shutdown was detected in Mornstone. An incomplete background update was reverted to keep the story consistent.',
    )
  })
})

describe('failure copy', () => {
  it('promises the pause only for a classifier orphan, which is the kind that causes one', () => {
    expect(
      formatRecoveryReport(failureReport(failed('periodic-classifier', 'story_1')), {
        story_1: 'Mornstone',
      }),
    ).toContain('Memory updates for this story are paused')
  })

  it('describes the fault without promising a pause for other kinds', () => {
    const text = formatRecoveryReport(failureReport(failed('per-turn', 'story_1')), {
      story_1: 'Mornstone',
    })
    expect(text).toContain('Mornstone')
    expect(text).not.toContain('paused')
  })

  it('falls back to unnamed copy when the story id resolves to no title', () => {
    expect(formatRecoveryReport(failureReport(failed('periodic-classifier', null)), {})).toContain(
      'that story',
    )
  })

  it('promises a retry for a failure a restart can heal', () => {
    for (const kind of ['periodic-classifier', 'per-turn'])
      for (const storyId of ['story_1', null])
        expect(
          formatRecoveryReport(failureReport(failed(kind, storyId)), { story_1: 'Mornstone' }),
        ).toContain('restarting the app retries automatically')
  })

  // Every boot refuses it again, so promising a retry would be false.
  it('promises no retry for an integrity refusal, and still says the content is intact', () => {
    for (const kind of ['periodic-classifier', 'per-turn'])
      for (const storyId of ['story_1', null]) {
        const text = formatRecoveryReport(failureReport(failed(kind, storyId, 'write-back')), {
          story_1: 'Mornstone',
        })
        expect(text).toContain('could not be undone without breaking later changes')
        expect(text).toMatch(/your story content is intact/i)
        expect(text).not.toContain('restart')
      }
  })

  it('keeps the pause for a classifier refusal, and its story name', () => {
    expect(
      formatRecoveryReport(failureReport(failed('periodic-classifier', 'story_1', 'write-back')), {
        story_1: 'Mornstone',
      }),
    ).toBe(
      'An interrupted background memory update in Mornstone could not be undone without breaking later changes. Memory updates for this story stay paused so nothing is duplicated — your story content is intact.',
    )
    expect(
      formatRecoveryReport(failureReport(failed('per-turn', 'story_1', 'write-back')), {
        story_1: 'Mornstone',
      }),
    ).toBe(
      'An interrupted background update in Mornstone could not be undone without breaking later changes. Your story content is intact.',
    )
  })

  it('reports reversed runs and failures together', () => {
    const text = formatRecoveryReport(
      {
        reversed: [recovered('per-turn', 'story_1')],
        failures: [failed('periodic-classifier', 'story_1')],
      },
      { story_1: 'Mornstone' },
    )
    expect(text).toContain('was reverted')
    expect(text).toContain('are paused')
  })
})

describe('formatRecoveryTitle', () => {
  it('does not claim recovery when nothing was reversed', () => {
    expect(formatRecoveryTitle(failureReport(failed('periodic-classifier', 'story_1')))).toBe(
      'Recovery incomplete',
    )
  })

  it('claims recovery when something was', () => {
    expect(formatRecoveryTitle(report(recovered('per-turn', 'story_1')))).toBe('Story recovered')
  })

  it('does not claim recovery when a reversal succeeded alongside one that failed', () => {
    expect(
      formatRecoveryTitle({
        reversed: [recovered('per-turn', 'story_1')],
        failures: [failed('periodic-classifier', 'story_2')],
      }),
    ).toBe('Recovery incomplete')
  })
})
