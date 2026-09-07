import { describe, it, expect, vi } from 'vitest'
import { ActivityRecorder } from './recorder'

function recorderAt(times: number[] = []) {
  let i = 0
  const clock = () => times[Math.min(i++, times.length - 1)] ?? 0
  const onChange = vi.fn()
  const recorder = new ActivityRecorder(onChange, times.length ? clock : () => 0)
  return { recorder, onChange }
}

describe('reporting off', () => {
  it('appends nothing', () => {
    const { recorder, onChange } = recorderAt()

    recorder.startTurn('entry-1')
    const id = recorder.startStep('retrieval')
    recorder.endStep(id)
    recorder.recordStep('grep')
    recorder.endTurn()

    expect(recorder.snapshot()).toEqual([])
    expect(recorder.activeTurn).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('returns an empty step id that closing tolerates', () => {
    const { recorder } = recorderAt()

    expect(recorder.startStep('retrieval')).toBe('')
    expect(() => recorder.endStep('')).not.toThrow()
  })

  it('drops the turn in flight when reporting is turned off mid-turn', () => {
    const { recorder } = recorderAt()
    recorder.setReporting('line')
    recorder.startTurn('entry-1')

    recorder.setReporting('off')

    expect(recorder.activeTurn).toBeNull()
    expect(recorder.startStep('retrieval')).toBe('')
  })

  it('does not retain the abandoned turn, which nothing can close', () => {
    const { recorder } = recorderAt()
    recorder.setReporting('line')
    recorder.startTurn('entry-1')
    recorder.startStep('retrieval')

    recorder.setReporting('off')
    recorder.setReporting('line')

    expect(recorder.snapshot()).toEqual([])
  })

  it('keeps turns that had already finished when reporting is turned off', () => {
    const { recorder } = recorderAt()
    recorder.setReporting('line')
    recorder.startTurn('entry-1')
    recorder.endTurn()
    recorder.startTurn('entry-2')

    recorder.setReporting('off')

    expect(recorder.snapshot().map((t) => t.entryId)).toEqual(['entry-1'])
  })
})

describe('recording', () => {
  it('records steps under the turn in flight', () => {
    const { recorder } = recorderAt()
    recorder.setReporting('line')
    recorder.startTurn('entry-1')

    const retrieval = recorder.startStep('retrieval')
    recorder.startStep('query ch.12', { parentId: retrieval, isLLM: true })

    const [turn] = recorder.snapshot()
    expect(turn.entryId).toBe('entry-1')
    expect(turn.steps).toHaveLength(2)
    expect(turn.steps[1].parentId).toBe(retrieval)
    expect(turn.steps[1].isLLM).toBe(true)
  })

  it('records `line` and `tree` identically', () => {
    const shape = (reporting: 'line' | 'tree') => {
      const { recorder } = recorderAt()
      recorder.setReporting(reporting)
      recorder.startTurn('entry-1')
      recorder.startStep('retrieval')
      recorder.endTurn()
      return recorder.snapshot()[0].steps.map((s) => s.label)
    }

    expect(shape('line')).toEqual(shape('tree'))
  })

  it('closes a step with a status and an optional detail', () => {
    const { recorder } = recorderAt([0, 0, 250])
    recorder.setReporting('line')
    recorder.startTurn('entry-1')
    const id = recorder.startStep('classification')

    recorder.endStep(id, 'failed', 'timed out')

    const step = recorder.snapshot()[0].steps[0]
    expect(step.status).toBe('failed')
    expect(step.detail).toBe('timed out')
    expect(step.endedAt).toBe(250)
  })

  it('ignores a second close of the same step', () => {
    const { recorder } = recorderAt()
    recorder.setReporting('line')
    recorder.startTurn('entry-1')
    const id = recorder.startStep('retrieval')
    recorder.endStep(id, 'done')

    recorder.endStep(id, 'failed')

    expect(recorder.snapshot()[0].steps[0].status).toBe('done')
  })

  it('places a pre-measured step by its duration rather than the clock', () => {
    const { recorder } = recorderAt([0, 0, 5_000])
    recorder.setReporting('line')
    recorder.startTurn('entry-1')

    recorder.recordStep('query ch.4', { isLLM: true, durationMs: 6_200 })

    const step = recorder.snapshot()[0].steps[0]
    expect(step.endedAt! - step.startedAt).toBe(6_200)
    expect(step.status).toBe('done')
  })

  it('closes a step still open when the turn ends, at the end time of that turn', () => {
    // startTurn, startStep, endTurn -- one clock read each.
    const { recorder } = recorderAt([0, 0, 900])
    recorder.setReporting('line')
    recorder.startTurn('entry-1')
    recorder.startStep('retrieval')

    recorder.endTurn()

    const turn = recorder.snapshot()[0]
    expect(turn.endedAt).toBe(900)
    // Not left running: its duration would otherwise be measured against viewing time.
    expect(turn.steps[0]).toMatchObject({
      status: 'skipped',
      endedAt: 900,
      detail: 'interrupted',
    })
  })

  it('keeps the detail a step already carried when the turn ends around it', () => {
    const { recorder } = recorderAt()
    recorder.setReporting('line')
    recorder.startTurn('entry-1')
    recorder.startStep('Agent', { detail: '3/8 steps' })

    recorder.endTurn()

    expect(recorder.snapshot()[0].steps[0].detail).toBe('3/8 steps')
  })

  it('leaves already-closed steps alone when the turn ends', () => {
    const { recorder } = recorderAt()
    recorder.setReporting('line')
    recorder.startTurn('entry-1')
    const done = recorder.startStep('retrieval')
    recorder.endStep(done, 'failed', 'boom')

    recorder.endTurn()

    expect(recorder.snapshot()[0].steps[0]).toMatchObject({ status: 'failed', detail: 'boom' })
  })

  it('revises a running step detail, for a counter that moves while it is open', () => {
    const { recorder } = recorderAt()
    recorder.setReporting('line')
    recorder.startTurn('entry-1')
    const id = recorder.startStep('Agent', { detail: '0/10 steps' })

    recorder.updateStep(id, '3/10 steps')

    expect(recorder.snapshot()[0].steps[0].detail).toBe('3/10 steps')
  })

  it('does not revise a step that has already closed', () => {
    const { recorder } = recorderAt()
    recorder.setReporting('line')
    recorder.startTurn('entry-1')
    const id = recorder.startStep('Agent', { detail: '0/10 steps' })
    recorder.endStep(id, 'done', '8/10 steps')

    recorder.updateStep(id, '9/10 steps')

    expect(recorder.snapshot()[0].steps[0].detail).toBe('8/10 steps')
  })

  it('does not notify when the detail is unchanged', () => {
    const { recorder, onChange } = recorderAt()
    recorder.setReporting('line')
    recorder.startTurn('entry-1')
    const id = recorder.startStep('Agent', { detail: '3/10 steps' })
    onChange.mockClear()

    recorder.updateStep(id, '3/10 steps')

    expect(onChange).not.toHaveBeenCalled()
  })

  it('backdates the turn to work that ran before it opened', () => {
    // Input translation is a model call on the same critical path, but it runs before the
    // generation path is entered.
    const { recorder } = recorderAt([5_000])
    recorder.setReporting('line')

    recorder.startTurn('entry-1', 1_000)

    expect(recorder.snapshot()[0].startedAt).toBe(1_000)
  })

  it('uses the clock when nothing preceded the turn', () => {
    const { recorder } = recorderAt([5_000])
    recorder.setReporting('line')

    recorder.startTurn('entry-1')

    expect(recorder.snapshot()[0].startedAt).toBe(5_000)
  })

  it('discards the oldest turns beyond the retention bound', () => {
    const recorder = new ActivityRecorder(
      () => {},
      () => 0,
      2,
    )
    recorder.setReporting('line')

    for (const entryId of ['a', 'b', 'c']) {
      recorder.startTurn(entryId)
      recorder.endTurn()
    }

    expect(recorder.snapshot().map((t) => t.entryId)).toEqual(['b', 'c'])
  })

  it('notifies on every change', () => {
    const { recorder, onChange } = recorderAt()
    recorder.setReporting('line')

    recorder.startTurn('entry-1')
    const id = recorder.startStep('retrieval')
    recorder.endStep(id)
    recorder.endTurn()

    expect(onChange).toHaveBeenCalledTimes(4)
  })
})
