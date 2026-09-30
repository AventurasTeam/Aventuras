import { describe, it, expect } from 'vitest'
import { turnOutcome } from './outcome'
import { ActivityRecorder } from './recorder'

describe('turnOutcome', () => {
  it('is finished when nothing went wrong', () => {
    expect(turnOutcome({ stopRequested: false })).toEqual({ outcome: 'finished', error: null })
  })

  it('is halted by a fatal pipeline error, with its reason', () => {
    expect(turnOutcome({ stopRequested: false, fatalError: '500 · upstream failed' })).toEqual({
      outcome: 'halted',
      error: '500 · upstream failed',
    })
  })

  it('is halted by an empty response', () => {
    expect(turnOutcome({ stopRequested: false, emptyResponse: 'empty response' })).toEqual({
      outcome: 'halted',
      error: 'empty response',
    })
  })

  it('is halted by a caught error, whose message wins over the others', () => {
    expect(
      turnOutcome({
        stopRequested: false,
        caughtError: 'could not save the entry',
        fatalError: 'x',
        emptyResponse: 'y',
      }),
    ).toEqual({ outcome: 'halted', error: 'could not save the entry' })
  })

  it('is stopped when the reader stopped it, whatever else happened', () => {
    expect(turnOutcome({ stopRequested: true, caughtError: 'aborted' })).toEqual({
      outcome: 'stopped',
      error: null,
    })
  })
})

describe('endTurn outcome', () => {
  it('records the outcome and reason, defaulting to finished', () => {
    const recorder = new ActivityRecorder()
    recorder.setReporting('line')

    recorder.startTurn('a')
    recorder.endTurn()
    recorder.startTurn('b')
    recorder.endTurn('halted', '401 · invalid API key')

    const [a, b] = recorder.snapshot()
    expect(a).toMatchObject({ outcome: 'finished' })
    expect(a.error).toBeUndefined()
    expect(b).toMatchObject({ outcome: 'halted', error: '401 · invalid API key' })
  })
})
