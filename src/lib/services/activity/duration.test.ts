import { describe, it, expect } from 'vitest'
import { formatDuration, stepDuration, turnDuration } from './duration'
import type { ActivityStep, ActivityTurn } from './types'

const base: ActivityStep = {
  id: 's',
  parentId: null,
  label: 's',
  isLLM: false,
  status: 'done',
  startedAt: 1_000,
}

describe('stepDuration', () => {
  it('measures a finished step between its own times', () => {
    expect(stepDuration({ ...base, endedAt: 3_500 }, 9_999)).toBe(2_500)
  })

  it('measures a running step against now', () => {
    expect(stepDuration({ ...base, status: 'running' }, 4_000)).toBe(3_000)
  })

  it('never reports a negative duration', () => {
    expect(stepDuration({ ...base, status: 'running' }, 0)).toBe(0)
  })
})

describe('turnDuration', () => {
  const turn: ActivityTurn = { id: 't', entryId: 'e', startedAt: 500, steps: [] }

  it('measures a running turn against now', () => {
    expect(turnDuration(turn, 2_500)).toBe(2_000)
  })

  it('measures a finished turn between its own times', () => {
    expect(turnDuration({ ...turn, endedAt: 1_500 }, 9_999)).toBe(1_000)
  })
})

describe('formatDuration', () => {
  it('reports sub-second times in milliseconds', () => {
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(42)).toBe('42ms')
    expect(formatDuration(999)).toBe('999ms')
  })

  it('reports seconds with one decimal', () => {
    expect(formatDuration(1_000)).toBe('1.0s')
    expect(formatDuration(6_240)).toBe('6.2s')
    expect(formatDuration(59_900)).toBe('59.9s')
  })

  it('reports minutes and seconds beyond a minute', () => {
    expect(formatDuration(60_000)).toBe('1m 0s')
    expect(formatDuration(95_000)).toBe('1m 35s')
    expect(formatDuration(600_000)).toBe('10m 0s')
  })

  it('carries a rounded 60 seconds into the next minute', () => {
    expect(formatDuration(119_800)).toBe('2m 0s')
  })
})
