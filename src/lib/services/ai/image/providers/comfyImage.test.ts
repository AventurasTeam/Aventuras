import { describe, it, expect, vi, beforeEach } from 'vitest'
import { APICallError, InvalidResponseDataError } from 'ai'
import type { ImageModelV4CallOptions } from '@ai-sdk/provider'

vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: { apiSettings: { llmTimeoutMs: 60_000 } },
}))
vi.mock('#lib/services/ai/sdk/providers/sdkFetch.ts', () => ({
  createSdkFetch: vi.fn(),
  createPollSdkFetch: vi.fn(),
}))

// Even a zero delay is a timer tick, and each poll would wait for one. An aborted signal still
// ends the wait, as with the real one. `abortable` is spied on, so a test can wait for the calls
// parked on a pending upload.
vi.mock('#lib/utils/async.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#lib/utils/async.ts')>()
  return {
    ...actual,
    abortable: vi.fn(actual.abortable),
    sleep: vi.fn(async (_ms: number, signal?: AbortSignal) => signal?.throwIfAborted()),
  }
})

import type { Fetch } from '#lib/services/ai/sdk/providers/index.ts'
import { abortable, sleep } from '#lib/utils/async.ts'
import { generateSdkImage } from './sdkImage'
import { createComfyImage, setGraphInput } from './comfyImage'

const BASE_URL = 'http://localhost:8188'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

type Route = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>

const fetchMock = vi.fn<Fetch>()
const pollMock = vi.fn<Fetch>()
let route: Route

const WORKFLOW = {
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'x' } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'y' } },
  '3': { class_type: 'KSampler', inputs: { seed: 1, positive: ['6', 0] } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 1, height: 1 } },
  '9': { class_type: 'SaveImage', inputs: {} },
}

const PATHS = {
  positive: '6.inputs.text',
  negative: '7.inputs.text',
  seed: '3.inputs.seed',
  width: '5.inputs.width',
  height: '5.inputs.height',
}

const comfyOptions = (over: Record<string, unknown> = {}) => ({
  comfyui: { workflow: WORKFLOW, outputNodeId: '9', paths: PATHS, ...over },
})

const model = () =>
  createComfyImage({
    baseURL: BASE_URL,
    fetch: fetchMock,
    pollFetch: pollMock,
  }).imageModel('ckpt.safetensors')

const callOptions = (over: Partial<ImageModelV4CallOptions> = {}): ImageModelV4CallOptions => ({
  prompt: 'a castle',
  n: 1,
  size: '768x512',
  aspectRatio: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerOptions: comfyOptions(),
  ...over,
})

function bodyOf(init: RequestInit | undefined) {
  return JSON.parse(init?.body as string) as Record<string, any>
}

function sentPrompt() {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/prompt'))!
  return { url: String(call[0]), init: call[1], body: bodyOf(call[1]) }
}

const cancelsOf = (id: string) =>
  pollMock.mock.calls.filter(
    ([url, init]) => init?.method === 'POST' && String(url) === `${BASE_URL}/api/jobs/${id}/cancel`,
  )

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

async function rejection(promise: PromiseLike<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
}

const image = (filename = 'out.png') => ({ images: [{ filename, subfolder: '', type: 'output' }] })

const job = (over: Record<string, unknown> = {}) => ({
  status: 'completed',
  outputs: { '9': image() },
  ...over,
})

const failedJob = (executionError?: Record<string, unknown>) =>
  job({ status: 'failed', outputs: {}, execution_error: executionError })

let clientId = ''

interface Handlers {
  prompt?: Route
  upload?: Route
  job?: Route
  cancel?: Route
  view?: Route
}

function serve(handlers: Handlers = {}) {
  route = async (url, init) => {
    const { pathname } = url
    if (init?.method === 'POST' && pathname === '/prompt') {
      clientId = bodyOf(init).prompt_id
      return (
        handlers.prompt?.(url, init) ?? json({ prompt_id: clientId, number: 1, node_errors: {} })
      )
    }
    if (init?.method === 'POST' && pathname === '/upload/image') {
      const file = (init.body as FormData).get('image') as File
      return (
        handlers.upload?.(url, init) ??
        json({ name: file.name, subfolder: 'aventuras', type: 'input' })
      )
    }
    if (pathname.startsWith('/api/jobs/') && pathname.endsWith('/cancel')) {
      return handlers.cancel?.(url, init) ?? json({ cancelled: true })
    }
    if (pathname.startsWith('/api/jobs/')) return handlers.job?.(url, init) ?? json(job())
    if (pathname === '/view') {
      return handlers.view?.(url, init) ?? new Response(new Uint8Array([1, 2, 3]))
    }
    return json({}, 404)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  clientId = ''
  fetchMock.mockImplementation(async (input, init) => route(new URL(String(input)), init))
  pollMock.mockImplementation(async (input, init) => route(new URL(String(input)), init))
  serve()
})

describe('setGraphInput', () => {
  it('returns the graph with the value written at a dotted path, node ids with colons whole', () => {
    const graph = { '57:27': { inputs: { text: 'a' } }, '9': { inputs: {} } }
    const next = setGraphInput(graph, '57:27.inputs.text', 'b')
    expect(next).toEqual({ '57:27': { inputs: { text: 'b' } }, '9': { inputs: {} } })
    expect(graph['57:27'].inputs.text).toBe('a')
    expect(next['9']).toBe(graph['9'])
  })

  it('creates missing levels', () => {
    expect(setGraphInput({}, '4.inputs.seed', 7)).toEqual({ '4': { inputs: { seed: 7 } } })
  })

  it.each(['__proto__.x', 'a.constructor.b', 'a.prototype'])('rejects %s', (path) => {
    expect(() => setGraphInput({}, path, 1)).toThrow('Invalid workflow path')
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })
})

describe('request', () => {
  it('writes the prompt, negative, seed and size into the graph it posts', async () => {
    const result = await generateSdkImage({
      model: model(),
      prompt: 'a castle',
      size: '768x512',
      providerOptions: comfyOptions({ negativePrompt: 'blurry' }),
    })

    const { url, init, body } = sentPrompt()
    expect(url).toBe(`${BASE_URL}/prompt`)
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
    expect(body.prompt['6'].inputs.text).toBe('a castle')
    expect(body.prompt['7'].inputs.text).toBe('blurry')
    expect(body.prompt['5'].inputs).toEqual({ width: 768, height: 512 })
    expect(Number.isSafeInteger(body.prompt['3'].inputs.seed)).toBe(true)
    expect(body.prompt['3'].inputs.positive).toEqual(['6', 0])
    expect(result.base64).toBe('AQID')
  })

  it('uses the seed it is given', async () => {
    await model().doGenerate(callOptions({ seed: 42 }))
    expect(sentPrompt().body.prompt['3'].inputs.seed).toBe(42)
  })

  it('does not change the workflow it was handed', async () => {
    const before = structuredClone(WORKFLOW)
    await model().doGenerate(callOptions())
    expect(WORKFLOW).toEqual(before)
  })

  it('writes the inputs it is given first, so the prompt and size still win', async () => {
    await model().doGenerate(
      callOptions({
        providerOptions: comfyOptions({
          inputs: [
            ['3.inputs.steps', 20],
            ['6.inputs.text', 'overwritten'],
          ],
        }),
      }),
    )
    const { prompt } = sentPrompt().body
    expect(prompt['3'].inputs.steps).toBe(20)
    expect(prompt['6'].inputs.text).toBe('a castle')
  })

  it('addresses nodes with colons in their id', async () => {
    serve({ job: () => json(job({ outputs: { '60': image() } })) })
    const workflow = {
      '57:27': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
      '57:3': { class_type: 'KSampler', inputs: { seed: 0 } },
      '60': { class_type: 'SaveImage', inputs: {} },
    }
    await model().doGenerate(
      callOptions({
        size: undefined,
        providerOptions: {
          comfyui: {
            workflow,
            outputNodeId: '60',
            paths: { positive: '57:27.inputs.text', seed: '57:3.inputs.seed' },
          },
        },
      }),
    )
    const { prompt } = sentPrompt().body
    expect(prompt['57:27'].inputs.text).toBe('a castle')
    expect(typeof prompt['57:3'].inputs.seed).toBe('number')
  })

  it('leaves out the negative prompt when the workflow has no path for it', async () => {
    const { negative: _, ...paths } = PATHS
    await model().doGenerate(
      callOptions({ providerOptions: comfyOptions({ paths, negativePrompt: 'blurry' }) }),
    )
    expect(sentPrompt().body.prompt['7'].inputs.text).toBe('y')
  })

  it('sends a client prompt_id and polls with the id the server answers', async () => {
    serve({ prompt: () => json({ prompt_id: 'server-id' }) })
    const result = await model().doGenerate(callOptions())
    expect(sentPrompt().body.prompt_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.images).toHaveLength(1)
    expect(String(pollMock.mock.calls[0][0])).toBe(`${BASE_URL}/api/jobs/server-id`)
  })

  it('warns when size has nowhere to go, and for aspect ratio, unused files and mask', async () => {
    const { width: _w, height: _h, ...paths } = PATHS
    const result = await model().doGenerate(
      callOptions({
        aspectRatio: '16:9',
        files: [{ type: 'file', mediaType: 'image/png', data: 'iVBORw0KGgo=' }],
        mask: { type: 'file', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
        providerOptions: comfyOptions({ paths }),
      }),
    )
    expect(result.warnings.map((w) => (w as { feature: string }).feature)).toEqual([
      'aspectRatio',
      'mask',
      'size',
      'files',
    ])
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/upload/image'))).toBe(false)
  })

  it('names what is wrong with the provider options', async () => {
    const error = await rejection(
      model().doGenerate(callOptions({ providerOptions: { comfyui: { outputNodeId: '9' } } })),
    )
    expect((error as Error).message).toContain('invalid provider options')
    expect((error as Error).message).toContain('workflow')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('needs a text prompt', async () => {
    const error = await rejection(model().doGenerate(callOptions({ prompt: undefined })))
    expect((error as Error).message).toContain('text prompt')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('references', () => {
  const LOAD_WORKFLOW = {
    ...WORKFLOW,
    '10': { class_type: 'LoadImage', inputs: { image: 'saved-a.png' } },
    '11': { class_type: 'LoadImage', inputs: { image: 'saved-b.png' } },
  }
  const png = (data = 'iVBORw0KGgo=') => ({ type: 'file' as const, mediaType: 'image/png', data })
  const uploads = () =>
    fetchMock.mock.calls.filter(([url]) => String(url) === `${BASE_URL}/upload/image`)

  const other = 'AQID'
  const uploadedName = (index: number) =>
    ((uploads()[index][1]!.body as FormData).get('image') as File).name
  const generateWith = (
    files: NonNullable<ImageModelV4CallOptions['files']>,
    {
      over = {},
      references = ['10.inputs.image'],
      call = {},
    }: {
      over?: Record<string, unknown>
      references?: string[]
      call?: Partial<ImageModelV4CallOptions>
    } = {},
  ) =>
    model().doGenerate(
      callOptions({
        ...call,
        files,
        providerOptions: comfyOptions({
          workflow: LOAD_WORKFLOW,
          paths: { ...PATHS, references },
          ...over,
        }),
      }),
    )

  it('uploads each reference into temp and writes the names into the graph', async () => {
    const result = await generateWith([png(), png(other)], {
      references: ['10.inputs.image', '11.inputs.image'],
    })

    expect(uploads()).toHaveLength(2)
    const form = uploads()[0][1]!.body as FormData
    expect(form.get('type')).toBe('temp')
    expect(form.get('subfolder')).toBe('aventuras')
    expect(uploadedName(0)).toMatch(/^aventuras-[0-9a-f]{16}\.png$/)

    const graph = sentPrompt().body.prompt
    expect(graph['10'].inputs.image).toBe(`aventuras/${uploadedName(0)} [temp]`)
    expect(graph['11'].inputs.image).toBe(`aventuras/${uploadedName(1)} [temp]`)
    expect(result.warnings).toEqual([])
  })

  it('names an upload after its bytes', async () => {
    await generateWith([png()])
    await generateWith([png()])
    await generateWith([png(other)])
    expect(uploadedName(1)).toBe(uploadedName(0))
    expect(uploadedName(2)).not.toBe(uploadedName(0))
  })

  it('uploads into the input folder when asked, without an annotation', async () => {
    await generateWith([png()], { over: { referenceFolder: 'input' } })
    expect((uploads()[0][1]!.body as FormData).get('type')).toBe('input')
    expect(sentPrompt().body.prompt['10'].inputs.image).toBe(`aventuras/${uploadedName(0)}`)
  })

  it('writes the name the server answers with', async () => {
    serve({ upload: () => json({ name: 'taken (1).png', subfolder: 'aventuras', type: 'temp' }) })
    await generateWith([png()])
    expect(sentPrompt().body.prompt['10'].inputs.image).toBe('aventuras/taken (1).png [temp]')
  })

  describe('concurrent generations', () => {
    let release: () => void
    let gate: Promise<void>

    beforeEach(() => {
      gate = new Promise((resolve) => (release = resolve))
      serve({
        upload: async (_url, init) => {
          await abortable(gate, init?.signal ?? undefined)
          const file = (init!.body as FormData).get('image') as File
          return json({ name: file.name, subfolder: 'aventuras', type: 'temp' })
        },
      })
    })

    const prompts = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/prompt'))
    // Hashing is asynchronous: the handler's gate is the first `abortable` call and each call
    // parked on the pending upload adds one.
    const parked = (calls: number) =>
      vi.waitFor(() => expect(vi.mocked(abortable)).toHaveBeenCalledTimes(calls))

    it('make one upload for the same bytes', async () => {
      const first = generateWith([png()])
      const second = generateWith([png()])
      await parked(2)
      release()
      await Promise.all([first, second])

      expect(uploads()).toHaveLength(1)
      const sent = prompts().map(([, init]) => bodyOf(init).prompt['10'].inputs.image)
      expect(sent).toEqual([
        `aventuras/${uploadedName(0)} [temp]`,
        `aventuras/${uploadedName(0)} [temp]`,
      ])
    })

    it('upload again when the first one was aborted', async () => {
      const controller = new AbortController()
      const first = rejection(generateWith([png()], { call: { abortSignal: controller.signal } }))
      const second = generateWith([png()])
      await parked(2)
      controller.abort()
      release()

      expect(await first).toBeDefined()
      await second
      expect(uploads()).toHaveLength(2)
      expect(prompts()).toHaveLength(1)
    })

    it('let a waiting generation cancel at once', async () => {
      const controller = new AbortController()
      const first = generateWith([png()])
      const waiting = rejection(generateWith([png()], { call: { abortSignal: controller.signal } }))
      await parked(2)
      controller.abort(new Error('stop'))

      expect(((await waiting) as Error).message).toBe('stop')
      release()
      await first
    })
  })

  it('uploads before it queues the prompt', async () => {
    await generateWith([png()])
    const paths = fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)
    expect(paths.indexOf('/upload/image')).toBeLessThan(paths.indexOf('/prompt'))
  })

  it('leaves the other LoadImage nodes at their saved image', async () => {
    await generateWith([png()], { references: ['10.inputs.image', '11.inputs.image'] })
    expect(uploads()).toHaveLength(1)
    expect(sentPrompt().body.prompt['11'].inputs.image).toBe('saved-b.png')
  })

  it('drops references the workflow has no input for, with a warning', async () => {
    const result = await generateWith([png(), png(), png()])
    expect(uploads()).toHaveLength(1)
    expect(result.warnings).toEqual([
      expect.objectContaining({ type: 'other', message: expect.stringContaining('2 reference') }),
    ])
  })

  it('does not upload without references', async () => {
    await generateWith([])
    expect(uploads()).toHaveLength(0)
    expect(sentPrompt().body.prompt['10'].inputs.image).toBe('saved-a.png')
  })

  it('fails without queueing when an upload is refused', async () => {
    serve({ upload: () => json({ error: 'no space left' }, 500) })
    const error = await rejection(generateWith([png()]))
    expect(APICallError.isInstance(error)).toBe(true)
    expect((error as Error).message).toContain('reference upload failed')
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/prompt'))).toBe(false)
  })

  it('rejects an upload reply it cannot read', async () => {
    serve({ upload: () => json({ unexpected: true }) })
    const error = await rejection(generateWith([png()]))
    expect(InvalidResponseDataError.isInstance(error)).toBe(true)
  })

  it('refuses a reference given as a URL', async () => {
    const error = await rejection(generateWith([{ type: 'url', url: 'https://example.com/a.png' }]))
    expect((error as Error).message).toContain('base64')
  })
})

describe('polling', () => {
  it('polls the job until it finishes, then downloads the image', async () => {
    const statuses = ['pending', 'in_progress', 'completed']
    let polls = 0
    serve({
      job: () => {
        const status = statuses[polls++]
        return json(status === 'completed' ? job() : { status })
      },
    })
    const result = await model().doGenerate(callOptions())
    expect(polls).toBe(3)
    expect(result.images).toEqual([new Uint8Array([1, 2, 3])])
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/prompt',
      '/view',
    ])
    expect(
      pollMock.mock.calls.every(([url]) => String(url) === `${BASE_URL}/api/jobs/${clientId}`),
    ).toBe(true)
  })

  it('encodes the output file in the /view URL', async () => {
    serve({
      job: () =>
        json(
          job({
            outputs: {
              '9': { images: [{ filename: 'a b&c.png', subfolder: 'x/y', type: 'temp' }] },
            },
          }),
        ),
    })
    await model().doGenerate(callOptions())
    const view = new URL(String(fetchMock.mock.calls.at(-1)![0]))
    expect(view.pathname).toBe('/view')
    expect(view.searchParams.get('filename')).toBe('a b&c.png')
    expect(view.searchParams.get('subfolder')).toBe('x/y')
    expect(view.searchParams.get('type')).toBe('temp')
    expect(view.search).not.toContain('&c.png')
  })

  it('keeps going through failed polls', async () => {
    let polls = 0
    serve({
      job: () => {
        if (++polls === 1) throw new Error('socket closed')
        if (polls === 2) return new Response('busy', { status: 503 })
        return json(job())
      },
    })
    expect((await model().doGenerate(callOptions())).images).toHaveLength(1)
    expect(polls).toBe(3)
  })

  it.each([
    ['a reply of the wrong shape', () => json({ unexpected: true })],
    ['a reply that is not JSON', () => new Response('<html>oops</html>')],
  ])('fails at once on %s, and cancels the job', async (_name, reply) => {
    let polls = 0
    serve({
      job: () => {
        polls++
        return reply()
      },
    })
    const error = await rejection(model().doGenerate(callOptions()))
    expect(InvalidResponseDataError.isInstance(error)).toBe(true)
    expect((error as Error).message).toContain('unreadable job status')
    expect(polls).toBe(1)
    await vi.waitFor(() => expect(cancelsOf(clientId)).toHaveLength(1))
  })

  it('reads the outputs it can when one node reports something else', async () => {
    serve({ job: () => json(job({ outputs: { '9': image(), '12': 'oops' } })) })
    expect((await model().doGenerate(callOptions())).images).toHaveLength(1)
  })

  it('counts only failures in a row', async () => {
    let polls = 0
    serve({
      job: () => {
        // Nine failures, a poll that works, nine more, then the result.
        if (polls++ % 10 !== 9) throw new Error('socket closed')
        return json(polls === 20 ? job() : { status: 'in_progress' })
      },
    })
    expect((await model().doGenerate(callOptions())).images).toHaveLength(1)
    expect(polls).toBe(20)
  })

  it('gives up on the tenth failure in a row, and cancels the job', async () => {
    let polls = 0
    serve({
      job: () => {
        polls++
        throw new Error('socket closed')
      },
    })
    const error = await rejection(model().doGenerate(callOptions()))
    expect((error as Error).message).toBe('ComfyUI stopped answering status checks: socket closed')
    expect(APICallError.isInstance(error)).toBe(false)
    expect(polls).toBe(10)
    await vi.waitFor(() => expect(cancelsOf(clientId)).toHaveLength(1))
  })

  it('polls straight after queueing, then waits between polls', async () => {
    const order: string[] = []
    vi.mocked(sleep).mockImplementationOnce(async () => {
      order.push('sleep')
    })
    let polls = 0
    serve({
      job: () => {
        order.push('poll')
        return json(++polls === 2 ? job() : { status: 'pending' })
      },
    })
    await model().doGenerate(callOptions())
    expect(order).toEqual(['poll', 'sleep', 'poll'])
  })

  it('fails at once when the server no longer has the job', async () => {
    let polls = 0
    serve({
      job: () => {
        polls++
        return polls === 1 ? json({ status: 'in_progress' }) : json({ error: 'Job not found' }, 404)
      },
    })
    const error = await rejection(model().doGenerate(callOptions()))
    expect((error as Error).message).toContain('no longer has this job')
    expect(polls).toBe(2)
  })

  it('suggests an old server when the first poll finds no job', async () => {
    serve({ job: () => json({ error: 'Not found' }, 404) })
    const error = await rejection(model().doGenerate(callOptions()))
    expect((error as Error).message).toContain('older than 0.26.0')
  })

  it.each([401, 403, 400])(
    'fails at once on a %i from a poll, and cancels the job',
    async (status) => {
      let polls = 0
      serve({
        job: () => {
          polls++
          return json({ error: 'no' }, status)
        },
      })
      const error = await rejection(model().doGenerate(callOptions()))
      expect(APICallError.isInstance(error)).toBe(true)
      expect((error as APICallError).statusCode).toBe(status)
      expect(polls).toBe(1)
      await vi.waitFor(() => expect(cancelsOf(clientId)).toHaveLength(1))
    },
  )

  it.each([408, 429])('keeps going through a %i from a poll', async (status) => {
    let polls = 0
    serve({ job: () => (++polls === 1 ? json({}, status) : json(job())) })
    expect((await model().doGenerate(callOptions())).images).toHaveLength(1)
    expect(polls).toBe(2)
  })
})

describe('errors', () => {
  it('reads node validation errors from a 400', async () => {
    fetchMock.mockImplementation(async () =>
      json(
        {
          error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed' },
          node_errors: {
            '4': {
              class_type: 'CheckpointLoaderSimple',
              errors: [{ message: 'Value not in list: ckpt_name', details: 'x' }],
            },
          },
        },
        400,
      ),
    )
    const error = await rejection(model().doGenerate(callOptions()))
    expect(APICallError.isInstance(error)).toBe(true)
    expect((error as APICallError).message).toBe(
      'ComfyUI Validation Error: Node 4 (CheckpointLoaderSimple): Value not in list: ckpt_name',
    )
    expect((error as APICallError).statusCode).toBe(400)
    expect((error as APICallError).isRetryable).toBe(false)
    expect(pollMock).not.toHaveBeenCalled()
  })

  it('leaves the class out of a node error that has none', async () => {
    fetchMock.mockImplementation(async () =>
      json({ node_errors: { '5': { errors: [{ message: 'bad input' }] } } }, 400),
    )
    const error = await rejection(model().doGenerate(callOptions()))
    expect((error as Error).message).toBe('ComfyUI Validation Error: Node 5: bad input')
  })

  it('reads a bare error message from a 400', async () => {
    fetchMock.mockImplementation(async () =>
      json(
        { error: { type: 'invalid_prompt', message: 'No prompt provided' }, node_errors: {} },
        400,
      ),
    )
    const error = await rejection(model().doGenerate(callOptions()))
    expect((error as Error).message).toBe('ComfyUI Error: No prompt provided')
  })

  it('falls back to the body text, then the status', async () => {
    fetchMock.mockImplementation(async () => new Response('Bad gateway', { status: 502 }))
    expect(((await rejection(model().doGenerate(callOptions()))) as Error).message).toBe(
      'ComfyUI Error: Bad gateway',
    )
    fetchMock.mockImplementation(async () => new Response('', { status: 503 }))
    expect(((await rejection(model().doGenerate(callOptions()))) as Error).message).toBe(
      'ComfyUI Error: HTTP 503',
    )
  })

  it('rejects a 200 whose errors drop the output node, and cancels the job', async () => {
    serve({
      prompt: () =>
        json({
          prompt_id: clientId,
          node_errors: {
            '9': {
              class_type: 'SaveImage',
              errors: [{ message: 'Required input is missing: images' }],
              dependent_outputs: ['9'],
            },
          },
        }),
    })
    const error = await rejection(model().doGenerate(callOptions()))
    expect((error as Error).message).toBe(
      'ComfyUI Validation Error: Node 9 (SaveImage): Required input is missing: images',
    )
    await vi.waitFor(() => expect(cancelsOf(clientId)).toHaveLength(1))
    expect(pollMock.mock.calls.some(([, init]) => init?.method !== 'POST')).toBe(false)
  })

  it('warns about a 200 whose errors leave the output node alone', async () => {
    serve({
      prompt: () =>
        json({
          prompt_id: clientId,
          node_errors: {
            '12': {
              class_type: 'PreviewImage',
              errors: [{ message: 'Required input is missing: images' }],
              dependent_outputs: ['12'],
            },
          },
        }),
    })
    const result = await model().doGenerate(callOptions())
    expect(result.images).toHaveLength(1)
    expect(result.warnings).toEqual([
      expect.objectContaining({
        type: 'other',
        message: expect.stringContaining('Node 12 (PreviewImage)'),
      }),
    ])
  })

  it('names the node and message of an execution error', async () => {
    serve({
      job: () =>
        json(
          failedJob({
            node_id: '3',
            node_type: 'KSampler',
            exception_type: 'torch.OutOfMemoryError',
            exception_message: 'CUDA out of memory\n',
          }),
        ),
    })
    const error = await rejection(model().doGenerate(callOptions()))
    expect((error as Error).message).toBe('ComfyUI Error: Node 3 (KSampler): CUDA out of memory')
  })

  it('still reports an execution error that names nothing', async () => {
    serve({ job: () => json(failedJob()) })
    const error = await rejection(model().doGenerate(callOptions()))
    expect((error as Error).message).toBe('ComfyUI Error: execution failed')
  })

  it('reports an interrupted job', async () => {
    serve({ job: () => json(job({ status: 'cancelled', outputs: {} })) })
    const error = await rejection(model().doGenerate(callOptions()))
    expect((error as Error).message).toBe('ComfyUI execution was interrupted')
  })

  it('names the output node when it produced nothing', async () => {
    serve({ job: () => json(job({ outputs: { '9': {} } })) })
    const error = await rejection(model().doGenerate(callOptions()))
    expect((error as Error).message).toBe(
      'ComfyUI Error: output node 9 (SaveImage) produced no image',
    )
  })

  it('says where the images came from when another node produced them', async () => {
    serve({ job: () => json(job({ outputs: { '9': {}, '12': image(), '15': image() } })) })
    const error = await rejection(model().doGenerate(callOptions()))
    expect((error as Error).message).toBe(
      'ComfyUI Error: output node 9 (SaveImage) produced no image; images came from node 12, 15',
    )
  })

  it.each([404, 429])('throws a plain Error when /view answers %i', async (status) => {
    serve({ view: () => new Response('gone', { status }) })
    const error = await rejection(model().doGenerate(callOptions()))
    expect(APICallError.isInstance(error)).toBe(false)
    expect((error as Error).message).toBe(`ComfyUI image download failed: HTTP ${status}`)
  })
})

describe('cancelling', () => {
  const abortOnFirstPoll = (controller: AbortController) => {
    serve({
      job: () => {
        controller.abort()
        return json({ status: 'in_progress' })
      },
    })
  }

  it('cancels the job when the caller aborts', async () => {
    const controller = new AbortController()
    abortOnFirstPoll(controller)

    await expect(
      model().doGenerate(callOptions({ abortSignal: controller.signal })),
    ).rejects.toBeDefined()

    await vi.waitFor(() => expect(cancelsOf(clientId)).toHaveLength(1))
  })

  it('sends the cancel without the caller signal', async () => {
    const controller = new AbortController()
    abortOnFirstPoll(controller)

    await rejection(model().doGenerate(callOptions({ abortSignal: controller.signal })))

    await vi.waitFor(() => expect(cancelsOf(clientId)).toHaveLength(1))
    expect(cancelsOf(clientId)[0][1]?.signal).toBeUndefined()
  })

  it('finds the job by its client id when the abort lands during the POST', async () => {
    const controller = new AbortController()
    serve({
      prompt: () => {
        controller.abort()
        throw new DOMException('Request aborted', 'AbortError')
      },
    })

    const error = await rejection(
      model().doGenerate(callOptions({ abortSignal: controller.signal })),
    )
    expect((error as Error).name).toBe('AbortError')

    await vi.waitFor(() => expect(cancelsOf(clientId)).toHaveLength(1))
  })

  it('does not wait for the cancel before failing', async () => {
    const controller = new AbortController()
    serve({
      job: () => {
        controller.abort()
        return json({ status: 'in_progress' })
      },
      cancel: () => new Promise<Response>(() => {}),
    })
    await rejection(model().doGenerate(callOptions({ abortSignal: controller.signal })))
    expect(cancelsOf(clientId)).toHaveLength(1)
  })

  it('has nothing to cancel once the server refused the prompt', async () => {
    serve({ prompt: () => json({ error: { message: 'No' } }, 400) })
    await rejection(model().doGenerate(callOptions()))
    await settle()
    expect(pollMock).not.toHaveBeenCalled()
  })

  it('sends nothing when the signal had already fired', async () => {
    const controller = new AbortController()
    controller.abort()
    const error = await rejection(
      model().doGenerate(callOptions({ abortSignal: controller.signal })),
    )
    expect((error as Error).name).toBe('AbortError')
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(pollMock).not.toHaveBeenCalled()
  })

  it('has nothing to cancel once the job finished', async () => {
    serve({ job: () => json(failedJob({ node_id: '3', node_type: 'KSampler' })) })
    await rejection(model().doGenerate(callOptions()))
    expect(cancelsOf(clientId)).toHaveLength(0)
  })

  it('cancels again while a prompt it never saw accepted is not found', async () => {
    const controller = new AbortController()
    let attempts = 0
    serve({
      prompt: () => {
        controller.abort()
        throw new DOMException('Request aborted', 'AbortError')
      },
      cancel: () => json({ cancelled: ++attempts === 3 }),
    })
    await rejection(model().doGenerate(callOptions({ abortSignal: controller.signal })))
    await vi.waitFor(() => expect(cancelsOf(clientId)).toHaveLength(3))
    await settle()
    expect(cancelsOf(clientId)).toHaveLength(3)
  })

  it('gives up cancelling a prompt that never turns up', async () => {
    const controller = new AbortController()
    serve({
      prompt: () => {
        controller.abort()
        throw new DOMException('Request aborted', 'AbortError')
      },
      cancel: () => json({ cancelled: false }),
    })
    await rejection(model().doGenerate(callOptions({ abortSignal: controller.signal })))
    await vi.waitFor(() => expect(cancelsOf(clientId)).toHaveLength(6))
    await settle()
    expect(cancelsOf(clientId)).toHaveLength(6)
    expect(vi.mocked(sleep).mock.calls.map(([ms]) => ms)).toEqual([500, 1000, 2000, 4000, 8000])
  })

  it('cancels an accepted prompt once', async () => {
    const controller = new AbortController()
    serve({
      job: () => {
        controller.abort()
        return json({ status: 'in_progress' })
      },
      cancel: () => json({ cancelled: false }),
    })
    await rejection(model().doGenerate(callOptions({ abortSignal: controller.signal })))
    await vi.waitFor(() => expect(cancelsOf(clientId)).toHaveLength(1))
    await settle()
    expect(cancelsOf(clientId)).toHaveLength(1)
  })

  it('works without a signal at all', async () => {
    serve({ job: () => json({}, 404) })
    const error = await rejection(model().doGenerate(callOptions()))
    expect((error as Error).message).toContain('older than 0.26.0')
  })
})
