import { describe, expect, it } from 'vitest'

import type { RecoveredRun, RecoveryReport } from '@/lib/pipeline'

import { formatRecoveryReport } from './copy'

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
