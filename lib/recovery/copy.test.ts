import { describe, expect, it } from 'vitest'

import type { BootRecoveryReport, RecoveredRun, RecoveryFailure } from '@/lib/pipeline'

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

function report(...reversed: RecoveredRun[]): BootRecoveryReport {
  return { reversed, failures: [], heldStoryIds: [] }
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

// The hold unread: every pass failure reads as holding its branch.
function failureReport(...failures: RecoveryFailure[]): BootRecoveryReport {
  return { reversed: [], failures, heldStoryIds: null }
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

  // generation-pipeline.md → Recovery modal: a pass holds its branch's turns; it isn't background.
  it('formats a named periodic-classifier recovery', () => {
    expect(
      formatRecoveryReport(report(recovered('periodic-classifier', 'story_1')), {
        story_1: 'Mornstone',
      }),
    ).toBe(
      'An interrupted shutdown was detected in Mornstone. A memory update was reverted; your story content is intact.',
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
      'An interrupted shutdown was detected in Mornstone. Your last AI response was reverted to keep the story consistent. An interrupted shutdown was detected. A memory update was reverted; your story content is intact.',
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
  it("promises the branch's turns stop only for a classifier orphan, the kind that holds one", () => {
    expect(
      formatRecoveryReport(failureReport(failed('periodic-classifier', 'story_1')), {
        story_1: 'Mornstone',
      }),
    ).toBe(
      "An interrupted memory update in Mornstone could not be undone. Its branch can't take turns until it is — your story content is intact, and restarting the app retries automatically.",
    )
  })

  it('describes the fault without promising the turns stop for other kinds', () => {
    const text = formatRecoveryReport(failureReport(failed('per-turn', 'story_1')), {
      story_1: 'Mornstone',
    })
    expect(text).toContain('Mornstone')
    expect(text).not.toContain("can't take turns")
  })

  it('falls back to unnamed copy when the story id resolves to no title', () => {
    expect(formatRecoveryReport(failureReport(failed('periodic-classifier', null)), {})).toBe(
      "An interrupted memory update could not be undone. That story's branch can't take turns until it is — your story content is intact, and restarting the app retries automatically.",
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

  it('keeps the hold for a classifier refusal, and its story name', () => {
    expect(
      formatRecoveryReport(failureReport(failed('periodic-classifier', 'story_1', 'write-back')), {
        story_1: 'Mornstone',
      }),
    ).toBe(
      "An interrupted memory update in Mornstone could not be undone without breaking later changes. Its branch can't take turns — your story content is intact.",
    )
    expect(
      formatRecoveryReport(failureReport(failed('periodic-classifier', null, 'write-back')), {}),
    ).toBe(
      "An interrupted memory update could not be undone without breaking later changes. That story's branch can't take turns — your story content is intact.",
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
        heldStoryIds: ['story_1'],
      },
      { story_1: 'Mornstone' },
    )
    expect(text).toBe(
      "An interrupted shutdown was detected in Mornstone. Your last AI response was reverted to keep the story consistent. An interrupted memory update in Mornstone could not be undone. Its branch can't take turns until it is — your story content is intact, and restarting the app retries automatically.",
    )
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
        heldStoryIds: ['story_2'],
      }),
    ).toBe('Recovery incomplete')
  })

  // generation-pipeline.md → Recovery-failure policy: a hold that can't be read counts as one.
  it('does not claim recovery when the hold could not be read', () => {
    expect(
      formatRecoveryTitle({
        reversed: [recovered('per-turn', 'story_1')],
        failures: [],
        heldStoryIds: null,
      }),
    ).toBe('Recovery incomplete')
  })
})

// generation-pipeline.md → Recovery-failure policy: the stop is promised only where the boot left
// the branch held, read after the reset rather than inferred from the failures.
describe('the hold the boot left', () => {
  const names = { story_1: 'Mornstone', story_2: 'Vellaby' }

  it('promises no stop for a pass failure whose branch the reset freed', () => {
    const text = formatRecoveryReport(
      { reversed: [], failures: [failed('periodic-classifier', 'story_1')], heldStoryIds: [] },
      names,
    )
    expect(text).toBe(
      'An interrupted background update in Mornstone could not be undone. Your story content is intact, and restarting the app retries automatically.',
    )
  })

  // The failure explains the hold, so the hold isn't listed again as one left unfinished.
  it('keeps the stop for a pass failure whose branch is still held, naming the hold once', () => {
    expect(
      formatRecoveryReport(
        {
          reversed: [],
          failures: [failed('periodic-classifier', 'story_1')],
          heldStoryIds: ['story_1'],
        },
        names,
      ),
    ).toBe(
      "An interrupted memory update in Mornstone could not be undone. Its branch can't take turns until it is — your story content is intact, and restarting the app retries automatically.",
    )
  })

  // Only a pass holds a branch, so a turn's failure there leaves the hold unexplained.
  it('names a held story whose only failure is a turn, beside that failure', () => {
    expect(
      formatRecoveryReport(
        {
          reversed: [],
          failures: [failed('per-turn', 'story_2')],
          heldStoryIds: ['story_2'],
        },
        names,
      ),
    ).toBe(
      "An interrupted background update in Vellaby could not be undone. Your story content is intact, and restarting the app retries automatically. A memory update in Vellaby was left unfinished at startup. Its branch can't take turns until it is cleared — your story content is intact, and restarting the app retries automatically.",
    )
  })

  it('names a held story no pass failure explains, as when the reset threw', () => {
    const held: BootRecoveryReport = {
      reversed: [recovered('per-turn', 'story_1')],
      failures: [],
      heldStoryIds: ['story_2'],
    }
    expect(formatRecoveryReport(held, names)).toBe(
      "An interrupted shutdown was detected in Mornstone. Your last AI response was reverted to keep the story consistent. A memory update in Vellaby was left unfinished at startup. Its branch can't take turns until it is cleared — your story content is intact, and restarting the app retries automatically.",
    )
    expect(formatRecoveryTitle(held)).toBe('Recovery incomplete')
  })
})
