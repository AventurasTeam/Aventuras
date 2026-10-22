import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./fetchAdapter', () => ({
  imageGetFetch: vi.fn(),
}))
vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: { apiSettings: { llmTimeoutMs: 60_000 } },
}))

const sdkFetch = vi.hoisted(() => vi.fn())
vi.mock('#lib/services/ai/sdk/providers/sdkFetch.ts', () => ({
  createSdkFetch: vi.fn(() => sdkFetch),
  createPollSdkFetch: vi.fn(() => sdkFetch),
}))

// The poll delay is real time; the tests do not need it.
vi.mock('#lib/utils/async.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/utils/async.ts')>()),
  sleep: vi.fn(async () => {}),
}))

import { specToPixels } from '#lib/utils/image.ts'
import { imageGetFetch } from './fetchAdapter'
import { ComfyMode, clearComfyCacheForUrl, createComfyProvider, fetchModelList } from './comfy'
import BasicWorkflow from './comfyWorkflows/basic-txt2img-workflow.json'
import LoraWorkflow from './comfyWorkflows/lora-txt2img-workflow.json'
import UnetWorkflow from './comfyWorkflows/unet-txt2img-workflow.json'
import type { ImageGenerateOptions } from './types'

type Graph = Record<string, { inputs: Record<string, unknown> }>

const SPEC = { orientation: 'landscape', size: 'medium' } as const
const SIZE = specToPixels(SPEC)

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

const options = (over: Partial<ImageGenerateOptions> = {}): ImageGenerateOptions => ({
  model: 'checkpoint:m.safetensors',
  prompt: 'a castle',
  spec: SPEC,
  ...over,
})

function postedGraph(): Graph {
  const call = sdkFetch.mock.calls.find(([, init]) => init?.method === 'POST')!
  return JSON.parse(call[1].body as string).prompt as Graph
}

const generate = (
  providerOptions: Record<string, unknown>,
  over: Partial<ImageGenerateOptions> = {},
) => createComfyProvider({ apiKey: '' }).generate(options({ providerOptions, ...over }))

function serve(outputNode: string) {
  sdkFetch.mockImplementation(async (input: string, init?: RequestInit) => {
    const { pathname } = new URL(input)
    if (init?.method === 'POST') {
      return json({ prompt_id: JSON.parse(init.body as string).prompt_id })
    }
    if (pathname.startsWith('/api/jobs/')) {
      return json({
        status: 'completed',
        outputs: {
          [outputNode]: { images: [{ filename: 'o.png', subfolder: '', type: 'output' }] },
        },
      })
    }
    return new Response(new Uint8Array([1, 2, 3]))
  })
}

const SERVER = { os: 'linux', comfyui_version: '0.42.0' }
let system: Record<string, unknown> | undefined

const listing = (lists: Record<string, string[]>) =>
  vi.mocked(imageGetFetch).mockImplementation(async (url) => {
    if (String(url).endsWith('/system_stats')) {
      if (!system) throw new Error('Image API error 404')
      return { ok: true, json: async () => ({ system }) } as unknown as Response
    }
    const type = String(url).split('/models/')[1]
    return { ok: true, json: async () => lists[type] ?? [] } as unknown as Response
  })

const statsRequests = () =>
  vi.mocked(imageGetFetch).mock.calls.filter(([url]) => String(url).endsWith('/system_stats'))

beforeEach(() => {
  vi.clearAllMocks()
  clearComfyCacheForUrl('http://localhost:8188')
  system = { ...SERVER }
  listing({})
  serve('9')
})

describe('basic checkpoint graph', () => {
  const opts = {
    mode: ComfyMode.BasicTxt2Img,
    positivePrompt: 'masterpiece',
    negativePrompt: 'blurry',
    step: 4,
    cfg: 2,
    sampler: 'euler',
    scheduler: 'karras',
  }

  it('fills the checkpoint, sampler, size and prompts at their node paths', async () => {
    const result = await generate(opts)
    const graph = postedGraph()

    expect(result.base64).toBe('AQID')
    expect(graph['4'].inputs.ckpt_name).toBe('m.safetensors')
    expect(graph['3'].inputs).toMatchObject({
      steps: 4,
      cfg: 2,
      sampler_name: 'euler',
      scheduler: 'karras',
    })
    expect(Number.isSafeInteger(graph['3'].inputs.seed)).toBe(true)
    expect(graph['5'].inputs).toEqual({ width: SIZE.width, height: SIZE.height, batch_size: 1 })
    expect(graph['6'].inputs.text).toBe('a castle, masterpiece')
    expect(graph['7'].inputs.text).toBe('blurry')
  })

  it('leaves the rest of the template alone, and the template itself unmodified', async () => {
    const before = structuredClone(BasicWorkflow)
    await generate(opts)
    const graph = postedGraph()

    expect(BasicWorkflow).toEqual(before)
    expect(graph['8']).toEqual((BasicWorkflow as Graph)['8'])
    expect(graph['9']).toEqual((BasicWorkflow as Graph)['9'])
  })

  it('defaults the sampler settings', async () => {
    await generate({ mode: ComfyMode.BasicTxt2Img })
    expect(postedGraph()['3'].inputs).toMatchObject({
      steps: 6,
      cfg: 1,
      sampler_name: 'dpmpp_2m_sde_gpu',
      scheduler: 'sgm_uniform',
    })
  })

  it('reads the image from the SaveImage node', async () => {
    serve('10')
    await expect(generate(opts)).rejects.toThrow(
      'output node 9 (SaveImage) produced no image; images came from node 10',
    )
  })
})

describe('LoRA graph', () => {
  it('adds the LoRA name and strengths', async () => {
    await generate({
      mode: ComfyMode.LoraTxt2Img,
      lora: { name: 'detail.safetensors', strengthModel: 0.6 },
    })
    const graph = postedGraph()

    expect(graph['2'].inputs).toMatchObject({
      lora_name: 'detail.safetensors',
      strength_model: 0.6,
      strength_clip: 1,
    })
    expect(graph['4'].inputs.ckpt_name).toBe('m.safetensors')
    expect(graph['8']).toEqual((LoraWorkflow as Graph)['8'])
  })

  it('picks the LoRA workflow from the options when no mode is set', async () => {
    await generate({ lora: { name: 'detail.safetensors' } })
    expect(postedGraph()['2'].inputs.lora_name).toBe('detail.safetensors')
  })
})

describe('UNet graph', () => {
  const opts = {
    mode: ComfyMode.UnetTxt2Img,
    clipName: 'clip.safetensors',
    vaeName: 'ae.safetensors',
    positivePrompt: 'tag',
    negativePrompt: 'ignored',
  }

  beforeEach(() => serve('10'))

  it('fills the loaders, sampler, size and prompt', async () => {
    await generate(opts, { model: 'unet:flux.safetensors' })
    const graph = postedGraph()

    expect(graph['1'].inputs).toMatchObject({
      unet_name: 'flux.safetensors',
      weight_dtype: 'default',
    })
    expect(graph['3'].inputs).toMatchObject({ clip_name: 'clip.safetensors', type: 'lumina2' })
    expect(graph['4'].inputs.vae_name).toBe('ae.safetensors')
    expect(graph['5'].inputs.text).toBe('a castle, tag')
    expect(graph['7'].inputs).toMatchObject({
      width: SIZE.width,
      height: SIZE.height,
      batch_size: 1,
    })
    expect(graph['8'].inputs).toMatchObject({
      steps: 8,
      cfg: 1,
      sampler_name: 'res_multistep',
      scheduler: 'simple',
    })
    expect(Number.isSafeInteger(graph['8'].inputs.seed)).toBe(true)
    expect(JSON.stringify(graph)).not.toContain('ignored')
    expect(graph['10']).toEqual((UnetWorkflow as Graph)['10'])
  })

  it('detects a diffusion model by its folder when no mode is set', async () => {
    listing({
      diffusion_models: ['flux.safetensors'],
      text_encoders: ['clip.safetensors'],
      vae: ['ae.safetensors'],
    })
    await generate({}, { model: 'flux.safetensors' })
    const graph = postedGraph()
    expect(graph['1'].inputs.unet_name).toBe('flux.safetensors')
    expect(graph['3'].inputs.clip_name).toBe('clip.safetensors')
    expect(graph['4'].inputs.vae_name).toBe('ae.safetensors')
  })

  it('fails when the server has no text encoder', async () => {
    await expect(
      generate({ mode: ComfyMode.UnetTxt2Img }, { model: 'unet:flux.safetensors' }),
    ).rejects.toThrow('No CLIP/text encoder model found')
  })
})

describe('custom workflow', () => {
  const workflow = {
    '57:27': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
    '57:28': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
    '57:3': { class_type: 'KSampler', inputs: { seed: 0 } },
    '60': { class_type: 'SaveImage', inputs: {} },
  }
  const custom = (over: Record<string, unknown> = {}) => ({
    workflow,
    positivePromptPath: '57:27.inputs.text',
    seedPath: '57:3.inputs.seed',
    outputNodeId: '60',
    negativePromptPath: '57:28.inputs.text',
    ...over,
  })

  beforeEach(() => serve('60'))

  it('fills only the detected paths and leaves the size to the workflow', async () => {
    const result = await generate(
      { mode: ComfyMode.CustomWorkflow, customWorkflow: custom(), negativePrompt: 'bad' },
      { model: '' },
    )
    const graph = postedGraph()

    expect(result.base64).toBe('AQID')
    expect(graph['57:27'].inputs.text).toBe('a castle')
    expect(graph['57:28'].inputs.text).toBe('bad')
    expect(Number.isSafeInteger(graph['57:3'].inputs.seed)).toBe(true)
    expect(Object.keys(graph)).toEqual(Object.keys(workflow))
  })

  it('does not touch a negative node without a path', async () => {
    await generate(
      {
        mode: ComfyMode.CustomWorkflow,
        customWorkflow: custom({ negativePromptPath: null }),
        negativePrompt: 'bad',
      },
      { model: '' },
    )
    expect(postedGraph()['57:28'].inputs.text).toBe('')
  })

  it('checks the server version too', async () => {
    system = { ...SERVER, comfyui_version: '0.25.1' }
    await expect(
      generate({ mode: ComfyMode.CustomWorkflow, customWorkflow: custom() }, { model: '' }),
    ).rejects.toThrow('older than 0.26.0')
    expect(sdkFetch).not.toHaveBeenCalled()
  })
})

describe('server version', () => {
  const opts = { mode: ComfyMode.BasicTxt2Img }

  it.each(['0.25.1', '0.9.9', '0.3.77'])(
    'refuses %s with a message that says what to do',
    async (version) => {
      system = { ...SERVER, comfyui_version: version }
      await expect(generate(opts)).rejects.toThrow(
        `ComfyUI ${version} is older than 0.26.0, the oldest version Aventuras supports. Update ComfyUI.`,
      )
      expect(sdkFetch).not.toHaveBeenCalled()
    },
  )

  it.each(['0.26.0', '0.26.1', '0.42.4', '1.0.0'])('accepts %s', async (version) => {
    system = { ...SERVER, comfyui_version: version }
    await expect(generate(opts)).resolves.toMatchObject({ base64: 'AQID' })
  })

  it('lets a version it cannot read through', async () => {
    system = { ...SERVER, comfyui_version: 'nightly' }
    await expect(generate(opts)).resolves.toMatchObject({ base64: 'AQID' })
  })

  it('lets a server that will not report its version through', async () => {
    system = undefined
    await expect(generate(opts)).resolves.toMatchObject({ base64: 'AQID' })
  })

  it('gives a server that does not answer a short timeout', async () => {
    await generate(opts)
    expect(statsRequests()[0][2]).toMatchObject({ timeoutMs: 5_000 })
  })

  it('asks once per base URL', async () => {
    await generate(opts)
    await generate(opts)
    expect(statsRequests()).toHaveLength(1)
  })

  it('asks again after refusing, so an updated server is let in', async () => {
    system = { ...SERVER, comfyui_version: '0.25.1' }
    await expect(generate(opts)).rejects.toThrow('older than 0.26.0')
    system = { ...SERVER, comfyui_version: '0.26.0' }
    await expect(generate(opts)).resolves.toMatchObject({ base64: 'AQID' })
    expect(statsRequests()).toHaveLength(2)
  })

  it('asks again after a server that could not be asked', async () => {
    system = undefined
    await generate(opts)
    system = { ...SERVER }
    await generate(opts)
    expect(statsRequests()).toHaveLength(2)
  })
})

describe('base URL', () => {
  const requestedUrls = () => [
    ...vi.mocked(imageGetFetch).mock.calls.map(([url]) => String(url)),
    ...sdkFetch.mock.calls.map(([url]) => String(url)),
  ]

  it('drops a trailing slash from every request', async () => {
    listing({ diffusion_models: ['flux.safetensors'] })
    const provider = createComfyProvider({ apiKey: '', baseUrl: ' http://localhost:8188// ' })
    await provider.generate(options({ model: 'checkpoint:m.safetensors' }))
    await provider.listModels()
    await provider.getSamplerInfo?.()?.catch(() => {})

    const urls = requestedUrls()
    expect(urls).toContain('http://localhost:8188/system_stats')
    expect(urls).toContain('http://localhost:8188/prompt')
    expect(urls).toContain('http://localhost:8188/models/checkpoints')
    expect(urls).toContain('http://localhost:8188/object_info/KSampler')
    expect(urls.filter((url) => url.replace('http://', '').includes('//'))).toEqual([])
  })

  it('is dropped by fetchModelList too', async () => {
    await fetchModelList('http://localhost:8188/ ', 'checkpoints')
    expect(String(vi.mocked(imageGetFetch).mock.calls[0][0])).toBe(
      'http://localhost:8188/models/checkpoints',
    )
  })

  it('finds the cache entry clearComfyCacheForUrl is given with a slash', async () => {
    const provider = createComfyProvider({ apiKey: '', baseUrl: 'http://localhost:8188/' })
    await provider.generate(options({ providerOptions: { mode: ComfyMode.BasicTxt2Img } }))
    clearComfyCacheForUrl('http://localhost:8188/')
    await provider.generate(options({ providerOptions: { mode: ComfyMode.BasicTxt2Img } }))
    expect(statsRequests()).toHaveLength(2)
  })
})

describe('model names in a subfolder', () => {
  const lora = { name: 'styles/detail.safetensors' }
  const generateLora = () =>
    generate({ mode: ComfyMode.LoraTxt2Img, lora }, { model: 'checkpoint:sdxl/m.safetensors' })

  it("uses a Windows server's separator", async () => {
    system = { ...SERVER, os: 'win32' }
    await generateLora()
    const graph = postedGraph()
    expect(graph['4'].inputs.ckpt_name).toBe('sdxl\\m.safetensors')
    expect(graph['2'].inputs.lora_name).toBe('styles\\detail.safetensors')
  })

  it("uses a Linux or macOS server's separator", async () => {
    system = { ...SERVER, os: 'darwin' }
    await generate(
      { mode: ComfyMode.LoraTxt2Img, lora: { name: 'styles\\detail.safetensors' } },
      { model: 'checkpoint:sdxl\\m.safetensors' },
    )
    const graph = postedGraph()
    expect(graph['4'].inputs.ckpt_name).toBe('sdxl/m.safetensors')
    expect(graph['2'].inputs.lora_name).toBe('styles/detail.safetensors')
  })

  it('leaves the names as they are when the OS is not reported', async () => {
    system = { comfyui_version: '0.42.0' }
    await generateLora()
    expect(postedGraph()['4'].inputs.ckpt_name).toBe('sdxl/m.safetensors')
  })

  it('converts the loaders of a UNet graph', async () => {
    system = { ...SERVER, os: 'win32' }
    serve('10')
    await generate(
      {
        mode: ComfyMode.UnetTxt2Img,
        clipName: 'te/clip.safetensors',
        vaeName: 'vae/ae.safetensors',
      },
      { model: 'unet:flux/dev.safetensors' },
    )
    const graph = postedGraph()
    expect(graph['1'].inputs.unet_name).toBe('flux\\dev.safetensors')
    expect(graph['3'].inputs.clip_name).toBe('te\\clip.safetensors')
    expect(graph['4'].inputs.vae_name).toBe('vae\\ae.safetensors')
  })
})
