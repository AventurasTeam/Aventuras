import { describe, it, expect, vi } from 'vitest'
import { APICallError } from 'ai'
import { NarrativePhase, type NarrativeInput } from './NarrativePhase'
import type { GenerationEvent, RetrievalResult } from '../types'
import type { StreamChunk } from '$lib/services/ai/core/types'
import { ActivityRecorder } from '$lib/services/activity'

async function drain<R>(gen: AsyncGenerator<GenerationEvent, R>) {
  const events: GenerationEvent[] = []
  for (;;) {
    const next = await gen.next()
    if (next.done) return { events, result: next.value }
    events.push(next.value)
  }
}

/** A stream chunk; `content` and `done` are required on the type, so they get defaults. */
const chunk = (over: Partial<StreamChunk> = {}): StreamChunk => ({
  content: '',
  done: false,
  ...over,
})

/**
 * A stand-in for `streamNarrative` that yields the given chunks. Declared with rest
 * parameters so a `vi.fn()` wrapping it records the arguments the phase passed.
 */
const streamOf = (...chunks: StreamChunk[]) =>
  async function* (..._args: unknown[]): AsyncGenerator<StreamChunk> {
    for (const c of chunks) yield c
  }

const retrievalResult: RetrievalResult = {
  worldStateBlock: '## World State',
  chapterContext: '## Chapters',
  lorebookContext: '## Lorebook',
  lorebookRetrievalResult: null,
  worldStateRetrievalResult: null,
  timelineFillResult: null,
  combinedContext: '## Chapters\n## Lorebook',
}

function makeInput(overrides: Partial<NarrativeInput> = {}): NarrativeInput {
  return {
    visibleEntries: [],
    worldState: {} as any,
    story: { id: 's1' } as any,
    retrievalResult,
    styleReview: null,
    ...overrides,
  } as NarrativeInput
}

const phaseWith = (streamNarrative: any) => new NarrativePhase({ streamNarrative })

describe('NarrativePhase', () => {
  it('accumulates content and reasoning across chunks', async () => {
    const stream = streamOf(
      chunk({ content: 'The dragon ', reasoning: 'setting up ' }),
      chunk({ content: 'fell.', reasoning: 'the fall' }),
      chunk({ done: true }),
    )

    const { events, result } = await drain(phaseWith(stream).execute(makeInput()))

    expect(result).toEqual({
      content: 'The dragon fell.',
      reasoning: 'setting up the fall',
    })
    expect(events.filter((e) => e.type === 'narrative_chunk')).toHaveLength(2)
    expect(events.at(-1)?.type).toBe('phase_complete')
  })

  it('does not emit a chunk event for a bare done marker', async () => {
    // It carries nothing to show; forwarding it would append an empty render pass.
    const stream = streamOf(chunk({ content: 'Hi.' }), chunk({ done: true }))

    const { events } = await drain(phaseWith(stream).execute(makeInput()))

    expect(events.filter((e) => e.type === 'narrative_chunk')).toHaveLength(1)
  })

  it('passes the world state block separately from the retrieved context', async () => {
    // The two are joined downstream, not here: memory retrieval has to be told what world
    // state the narrator already has, which is only expressible while they are distinct.
    const streamNarrative = vi.fn(streamOf(chunk({ content: 'Hi.' }), chunk({ done: true })))

    await drain(phaseWith(streamNarrative).execute(makeInput()))

    const args = streamNarrative.mock.calls[0]
    expect(args[4]).toBe('## Chapters\n## Lorebook')
    expect(args[7]).toBe('## World State')
  })

  describe('empty responses', () => {
    // Some providers return a well-formed but empty stream. Surfacing that as a blank
    // narration looks like the app broke, so it is retried before giving up.

    it('retries and succeeds on a later attempt', async () => {
      let attempt = 0
      const streamNarrative = vi.fn(async function* () {
        attempt++
        if (attempt < 3) return
        yield chunk({ content: 'Finally.' })
      })

      const { result } = await drain(phaseWith(streamNarrative).execute(makeInput()))

      expect(streamNarrative).toHaveBeenCalledTimes(3)
      expect(result?.content).toBe('Finally.')
    })

    it('treats whitespace-only output as empty', async () => {
      const streamNarrative = vi.fn(streamOf(chunk({ content: '   \n  ' })))

      const { result } = await drain(phaseWith(streamNarrative).execute(makeInput()))

      expect(streamNarrative).toHaveBeenCalledTimes(3)
      expect(result).toBeNull()
    })

    it('gives up fatally after three attempts', async () => {
      const streamNarrative = vi.fn(async function* (): AsyncGenerator<StreamChunk> {})

      const { events, result } = await drain(phaseWith(streamNarrative).execute(makeInput()))

      expect(streamNarrative).toHaveBeenCalledTimes(3)
      expect(result).toBeNull()
      const error = events.find((e) => e.type === 'error')
      expect(error).toMatchObject({ fatal: true, phase: 'narrative' })
    })
  })

  it('re-sends a stream that fails before any text, as it does an empty one', async () => {
    let call = 0
    const streamNarrative = vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      if (++call === 1) throw new Error('stream cut')
      yield chunk({ content: 'The dragon fell.' })
    })

    const { events, result } = await drain(phaseWith(streamNarrative).execute(makeInput()))

    expect(streamNarrative).toHaveBeenCalledTimes(2)
    expect(result?.content).toBe('The dragon fell.')
    expect(events.some((e) => e.type === 'error')).toBe(false)
  })

  it('gives up fatally when every pass fails, naming the last reason', async () => {
    // There is no turn without a narration, so this one cannot degrade gracefully.
    const streamNarrative = vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      throw new Error('provider down')
    })

    const { events, result } = await drain(phaseWith(streamNarrative).execute(makeInput()))

    expect(streamNarrative).toHaveBeenCalledTimes(3)
    expect(result).toBeNull()
    expect(events.find((e) => e.type === 'error')).toMatchObject({
      fatal: true,
      error: new Error('Failed after 3 passes: provider down'),
    })
  })

  it('does not re-send a request that failed outright: its retries are already spent', async () => {
    const refused = new APICallError({
      message: 'Unauthorized',
      url: 'https://example.test',
      requestBodyValues: {},
      statusCode: 401,
    })
    const streamNarrative = vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      throw refused
    })

    const { events } = await drain(phaseWith(streamNarrative).execute(makeInput()))

    expect(streamNarrative).toHaveBeenCalledTimes(1)
    expect(events.find((e) => e.type === 'error')).toMatchObject({ fatal: true, error: refused })
  })

  it('keeps the text streamed before a failure, reporting the failure non-fatally', async () => {
    const streamNarrative = vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      yield chunk({ content: 'The dragon ' })
      throw new Error('connection reset')
    })

    const { events, result } = await drain(phaseWith(streamNarrative).execute(makeInput()))

    expect(streamNarrative).toHaveBeenCalledTimes(1)
    expect(result?.content).toBe('The dragon ')
    expect(events.find((e) => e.type === 'error')).toMatchObject({ fatal: false })
    expect(events.at(-1)?.type).toBe('phase_complete')
  })

  describe('abort', () => {
    it('does not start the stream when already aborted', async () => {
      const controller = new AbortController()
      controller.abort()
      const streamNarrative = vi.fn()

      const { events, result } = await drain(
        phaseWith(streamNarrative).execute(makeInput({ abortSignal: controller.signal })),
      )

      expect(streamNarrative).not.toHaveBeenCalled()
      expect(result).toBeNull()
      expect(events.map((e) => e.type)).toEqual(['phase_start', 'aborted'])
    })

    it('stops mid-stream and discards what it had', async () => {
      const controller = new AbortController()
      const streamNarrative = async function* () {
        yield chunk({ content: 'The dragon ' })
        controller.abort()
        yield chunk({ content: 'fell.' })
      }

      const { events, result } = await drain(
        phaseWith(streamNarrative).execute(makeInput({ abortSignal: controller.signal })),
      )

      expect(result).toBeNull()
      expect(events.at(-1)?.type).toBe('aborted')
      expect(events.filter((e) => e.type === 'narrative_chunk')).toHaveLength(1)
    })

    it('reports an AbortError as an abort, not a fatal error', async () => {
      const abortError = new Error('aborted')
      abortError.name = 'AbortError'
      const streamNarrative = async function* (): AsyncGenerator<StreamChunk> {
        throw abortError
      }

      const { events } = await drain(phaseWith(streamNarrative).execute(makeInput()))

      expect(events.map((e) => e.type)).toEqual(['phase_start', 'aborted'])
    })
  })
})

describe('NarrativePhase activity reporting', () => {
  /** The real recorder, with a turn open for the phase to report into. */
  function recordingReporter() {
    const reporter = new ActivityRecorder()
    reporter.setReporting('tree')
    reporter.startTurn('entry')
    return { steps: reporter.activeTurn!.steps, reporter }
  }

  const phaseReporting = (streamNarrative: any, activity: any) =>
    new NarrativePhase({ streamNarrative, activity })

  it('reports the wait for the model, ending it at the first chunk that carries anything', async () => {
    const { steps, reporter } = recordingReporter()
    const stream = streamOf(
      chunk({ reasoning: 'thinking' }),
      chunk({ content: 'The dragon fell.' }),
      chunk({ done: true }),
    )

    await drain(phaseReporting(stream, reporter).execute(makeInput()))

    // In the order they happen: the wait, then the streaming it gives way to.
    expect(steps.map((s) => s.label)).toEqual(['Narrative', 'Waiting for model', 'Generating'])
    const wait = steps.find((s) => s.label === 'Waiting for model')!
    expect(wait.status).toBe('done')
    // Ended by the reasoning chunk, so it is not still open when content arrives.
    expect(wait.detail).toBeUndefined()
  })

  it('opens no streaming step when the model never produces anything', async () => {
    const { steps, reporter } = recordingReporter()

    await drain(phaseReporting(streamOf(chunk({ done: true })), reporter).execute(makeInput()))

    expect(steps.some((s) => s.label === 'Generating')).toBe(false)
  })

  it('marks the wait as having had no response when the stream ends without one', async () => {
    const { steps, reporter } = recordingReporter()

    await drain(phaseReporting(streamOf(chunk({ done: true })), reporter).execute(makeInput()))

    expect(steps.find((s) => s.label === 'Waiting for model')?.detail).toBe('no response')
  })

  it('reports the streaming as the LLM step, with the chunk count', async () => {
    const { steps, reporter } = recordingReporter()
    const stream = streamOf(chunk({ content: 'Hi.' }), chunk({ done: true }))

    await drain(phaseReporting(stream, reporter).execute(makeInput()))

    // A single pass gets no container of its own.
    expect(steps.some((s) => s.label.startsWith('Pass'))).toBe(false)
    expect(steps.find((s) => s.label === 'Generating')).toMatchObject({
      status: 'done',
      detail: '1 chunk',
      isLLM: true,
    })
  })

  it('reports each empty pass as failed, grouping the first once a second follows', async () => {
    const recorder = new ActivityRecorder()
    recorder.setReporting('tree')
    recorder.startTurn('entry')
    const streamNarrative = vi.fn(streamOf(chunk({ content: '' }), chunk({ done: true })))

    const { events, result } = await drain(
      phaseReporting(streamNarrative, recorder).execute(makeInput()),
    )

    // Unchanged behaviour: still three passes, still a fatal error, still no result.
    expect(streamNarrative).toHaveBeenCalledTimes(3)
    expect(result).toBeNull()
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      phase: 'narrative',
      fatal: true,
      error: new Error('Empty response after 3 passes'),
    })

    const steps = recorder.snapshot()[0].steps
    const narrative = steps.find((s) => s.label === 'Narrative')!
    expect(narrative).toMatchObject({ status: 'failed', error: 'Empty response after 3 passes' })
    const passes = steps.filter((s) => s.parentId === narrative.id)
    expect(passes.map((s) => [s.label, s.status, s.error, s.attempt])).toEqual([
      ['Pass 1', 'failed', 'Empty response', true],
      ['Pass 2', 'failed', 'Empty response', true],
      ['Pass 3', 'failed', 'Empty response', true],
    ])
    const pass1 = passes.find((s) => s.label === 'Pass 1')!
    expect(steps.filter((s) => s.parentId === pass1.id).map((s) => s.label)).toEqual([
      'Waiting for model',
    ])
  })

  it('leaves no step running when the stream throws', async () => {
    const { steps, reporter } = recordingReporter()
    const streamNarrative = async function* (): AsyncGenerator<StreamChunk> {
      throw new Error('provider exploded')
    }

    await drain(phaseReporting(streamNarrative, reporter).execute(makeInput()))

    expect(steps.every((s) => s.status !== 'running')).toBe(true)
    expect(steps.find((s) => s.label === 'Narrative')?.status).toBe('failed')
  })

  it('marks a narration kept after a failure as failed', async () => {
    const { steps, reporter } = recordingReporter()
    const streamNarrative = async function* (): AsyncGenerator<StreamChunk> {
      yield chunk({ content: 'The dragon ' })
      throw new Error('connection reset')
    }

    await drain(phaseReporting(streamNarrative, reporter).execute(makeInput()))

    expect(
      steps.filter((s) => s.label !== 'Waiting for model').map((s) => [s.label, s.status]),
    ).toEqual([
      ['Narrative', 'failed'],
      ['Generating', 'failed'],
    ])
  })

  it('records nothing when no reporter is injected', async () => {
    const stream = streamOf(chunk({ content: 'Hi.' }), chunk({ done: true }))

    const { result } = await drain(phaseWith(stream).execute(makeInput()))

    expect(result?.content).toBe('Hi.')
  })
})

describe('NarrativePhase response steps', () => {
  function recordingReporter() {
    const reporter = new ActivityRecorder()
    reporter.setReporting('tree')
    reporter.startTurn('entry')
    return { steps: reporter.activeTurn!.steps, reporter }
  }

  it('shows an empty answer as a response with no content, after its wait', async () => {
    const { steps, reporter } = recordingReporter()
    const stream = streamOf({ content: '', done: false, started: true }, chunk({ done: true }))

    await drain(
      new NarrativePhase({ streamNarrative: stream, activity: reporter } as any).execute(
        makeInput(),
      ),
    )

    expect(steps.slice(1, 3).map((s) => [s.label, s.detail])).toEqual([
      ['Waiting for model', undefined],
      ['Generating', 'no content'],
    ])
  })

  it('does not count the start of the response as a chunk', async () => {
    const { steps, reporter } = recordingReporter()
    const stream = streamOf(
      { content: '', done: false, started: true },
      chunk({ content: 'Hi.' }),
      chunk({ done: true }),
    )

    const { result } = await drain(
      new NarrativePhase({ streamNarrative: stream, activity: reporter } as any).execute(
        makeInput(),
      ),
    )

    expect(steps.find((s) => s.label === 'Generating')?.detail).toBe('1 chunk')
    expect(result?.content).toBe('Hi.')
  })
})
