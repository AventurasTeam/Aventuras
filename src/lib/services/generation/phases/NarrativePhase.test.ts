import { describe, it, expect, vi } from 'vitest'
import { NarrativePhase, type NarrativeInput } from './NarrativePhase'
import type { GenerationEvent, RetrievalResult } from '../types'
import type { StreamChunk } from '$lib/services/ai/core/types'

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
      chunkCount: 3,
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

  it('treats a stream failure as fatal, unlike the other phases', async () => {
    // There is no turn without a narration, so this one cannot degrade gracefully.
    const streamNarrative = async function* (): AsyncGenerator<StreamChunk> {
      throw new Error('provider down')
    }

    const { events, result } = await drain(phaseWith(streamNarrative).execute(makeInput()))

    expect(result).toBeNull()
    expect(events.find((e) => e.type === 'error')).toMatchObject({ fatal: true })
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
  /** Records what the phase reported, in order, as `label` + final status. */
  function recordingReporter() {
    const steps: { id: string; label: string; status?: string; detail?: string }[] = []
    let n = 0
    return {
      steps,
      reporter: {
        startStep: (label: string, options: any = {}) => {
          const id = `s${++n}`
          steps.push({ id, label, detail: options.detail })
          return id
        },
        endStep: (id: string, status = 'done', detail?: string) => {
          const step = steps.find((s) => s.id === id)
          if (!step || step.status) return
          step.status = status
          if (detail !== undefined) step.detail = detail
        },
        recordStep: () => '',
      },
    }
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

    expect(steps.map((s) => s.label)).toEqual(['Narrative', 'Generating', 'Waiting for model'])
    const wait = steps.find((s) => s.label === 'Waiting for model')!
    expect(wait.status).toBe('done')
    // Ended by the reasoning chunk, so it is not still open when content arrives.
    expect(wait.detail).toBeUndefined()
  })

  it('marks the wait as having produced no tokens when the stream is empty', async () => {
    const { steps, reporter } = recordingReporter()

    await drain(phaseReporting(streamOf(chunk({ done: true })), reporter).execute(makeInput()))

    expect(steps.find((s) => s.label === 'Waiting for model')?.detail).toBe('no tokens')
  })

  it('reports the generating attempt as an LLM step with its chunk count', async () => {
    const { steps, reporter } = recordingReporter()
    const stream = streamOf(chunk({ content: 'Hi.' }), chunk({ done: true }))

    await drain(phaseReporting(stream, reporter).execute(makeInput()))

    const attempt = steps.find((s) => s.label === 'Generating')!
    expect(attempt.status).toBe('done')
    expect(attempt.detail).toBe('2 chunks')
  })

  it('reports each empty attempt separately without changing the retry loop', async () => {
    const { steps, reporter } = recordingReporter()
    const streamNarrative = vi.fn(streamOf(chunk({ content: '' }), chunk({ done: true })))

    const { events, result } = await drain(
      phaseReporting(streamNarrative, reporter).execute(makeInput()),
    )

    // Unchanged behaviour: still three attempts, still a fatal error, still no result.
    expect(streamNarrative).toHaveBeenCalledTimes(3)
    expect(result).toBeNull()
    expect(events.at(-1)).toMatchObject({ type: 'error', phase: 'narrative', fatal: true })

    const attempts = steps.filter(
      (s) => s.label.startsWith('Generating') || s.label.startsWith('Attempt'),
    )
    expect(attempts.map((s) => s.label)).toEqual(['Generating', 'Attempt 2', 'Attempt 3'])
    expect(attempts.every((s) => s.detail === 'empty response')).toBe(true)
    expect(steps.find((s) => s.label === 'Narrative')).toMatchObject({
      status: 'failed',
      detail: 'empty after 3 attempts',
    })
  })

  it('leaves no step running when the stream throws', async () => {
    const { steps, reporter } = recordingReporter()
    const streamNarrative = async function* (): AsyncGenerator<StreamChunk> {
      throw new Error('provider exploded')
    }

    await drain(phaseReporting(streamNarrative, reporter).execute(makeInput()))

    expect(steps.every((s) => s.status !== undefined)).toBe(true)
    expect(steps.find((s) => s.label === 'Narrative')?.status).toBe('failed')
  })

  it('records nothing when no reporter is injected', async () => {
    const stream = streamOf(chunk({ content: 'Hi.' }), chunk({ done: true }))

    const { result } = await drain(phaseWith(stream).execute(makeInput()))

    expect(result?.content).toBe('Hi.')
  })
})
