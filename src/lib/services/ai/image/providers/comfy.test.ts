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
import {
  ComfyMode,
  clearComfyCacheForUrl,
  comfyReferenceLimit,
  createComfyProvider,
  fetchModelList,
  loadImageInputs,
  suggestReferenceInputs,
} from './comfy'
import BasicWorkflow from './comfyWorkflows/basic-txt2img-workflow.json'
import LoraWorkflow from './comfyWorkflows/lora-txt2img-workflow.json'
import UnetWorkflow from './comfyWorkflows/unet-txt2img-workflow.json'
import type { Json } from './comfyImage'
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
  const call = sdkFetch.mock.calls.find(
    ([input, init]) => init?.method === 'POST' && String(input).endsWith('/prompt'),
  )!
  return JSON.parse(call[1].body as string).prompt as Graph
}

const generate = (
  providerOptions: Record<string, unknown>,
  over: Partial<ImageGenerateOptions> = {},
) => createComfyProvider({ apiKey: '' }).generate(options({ providerOptions, ...over }))

function serve(outputNode: string) {
  sdkFetch.mockImplementation(async (input: string, init?: RequestInit) => {
    const { pathname } = new URL(input)
    if (init?.method === 'POST' && pathname === '/upload/image') {
      return json({ name: 'uploaded.png', subfolder: 'aventuras', type: 'input' })
    }
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
  const withLoad = {
    ...workflow,
    '61': { class_type: 'LoadImage', inputs: { image: 'saved.png' } },
  }

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

  it('uploads references into the workflow LoadImage nodes', async () => {
    await generate(
      { mode: ComfyMode.CustomWorkflow, customWorkflow: custom({ workflow: withLoad }) },
      { model: '', referenceImages: ['iVBORw0KGgo='] },
    )
    expect(postedGraph()['61'].inputs.image).toBe('aventuras/uploaded.png [temp]')
  })

  it('uploads only into the LoadImage nodes the profile selected', async () => {
    const twoLoads = {
      ...withLoad,
      '62': { class_type: 'LoadImage', inputs: { image: 'guide.png' } },
    }
    await generate(
      {
        mode: ComfyMode.CustomWorkflow,
        customWorkflow: custom({ workflow: twoLoads, referenceInputPaths: ['62.inputs.image'] }),
      },
      { model: '', referenceImages: ['iVBORw0KGgo=', 'AQID'] },
    )
    expect(postedGraph()['61'].inputs.image).toBe('saved.png')
    expect(postedGraph()['62'].inputs.image).toBe('aventuras/uploaded.png [temp]')
  })

  it('uploads into the input folder when the profile asks for it', async () => {
    await generate(
      {
        mode: ComfyMode.CustomWorkflow,
        customWorkflow: custom({ workflow: withLoad }),
        inputReferences: true,
      },
      { model: '', referenceImages: ['iVBORw0KGgo='] },
    )
    const upload = sdkFetch.mock.calls.find(([input]) => String(input).endsWith('/upload/image'))!
    expect((upload[1].body as FormData).get('type')).toBe('input')
    expect(postedGraph()['61'].inputs.image).toBe('aventuras/uploaded.png')
  })

  it('refuses custom-workflow mode without a workflow instead of drawing another one', async () => {
    await expect(generate({ mode: ComfyMode.CustomWorkflow }, { model: '' })).rejects.toThrow(
      'no custom workflow',
    )
  })

  it('sends no upload for a workflow without a LoadImage node', async () => {
    await generate(
      { mode: ComfyMode.CustomWorkflow, customWorkflow: custom() },
      { model: '', referenceImages: ['iVBORw0KGgo='] },
    )
    expect(sdkFetch.mock.calls.some(([input]) => String(input).endsWith('/upload/image'))).toBe(
      false,
    )
  })
})

describe('reference inputs', () => {
  const node = (class_type: string, image = 'a.png') => ({ class_type, inputs: { image } })
  const consumer = (class_type: string, inputs: Record<string, Json>) => ({ class_type, inputs })
  const paths = (workflow: Parameters<typeof loadImageInputs>[0]) =>
    loadImageInputs(workflow).map(({ path }) => path)

  it('lists the LoadImage image inputs in node-id order', () => {
    const workflow = {
      '10': node('LoadImage'),
      '9': node('LoadImage'),
      '57:4': node('LoadImage'),
      '2': node('SaveImage'),
    }
    expect(paths(workflow)).toEqual(['9.inputs.image', '10.inputs.image', '57:4.inputs.image'])
  })

  it('ignores the other image-loading nodes', () => {
    expect(paths({ '1': node('LoadImageMask'), '2': node('LoadImageOutput') })).toEqual([])
  })

  it('reads the node id, title and saved image of each LoadImage', () => {
    expect(
      loadImageInputs({
        '1': { ...node('LoadImage', 'a.png'), _meta: { title: 'Pose' } },
        '2': { class_type: 'LoadImage', inputs: { image: ['9', 0] } },
      }),
    ).toEqual([
      { nodeId: '1', path: '1.inputs.image', title: 'Pose', image: 'a.png' },
      { nodeId: '2', path: '2.inputs.image', title: 'LoadImage', image: '' },
    ])
  })

  describe('suggestReferenceInputs', () => {
    it('selects a LoadImage that nothing consumes, or that feeds an unknown node', () => {
      expect(
        suggestReferenceInputs({
          '1': node('LoadImage'),
          '2': node('LoadImage'),
          '3': consumer('SomeCustomNode', { picture: ['2', 0] }),
        }),
      ).toEqual(['1.inputs.image', '2.inputs.image'])
    })

    it('selects the known reference consumers, through a scale and a VAE encode', () => {
      expect(
        suggestReferenceInputs({
          '1': node('LoadImage'),
          '2': node('LoadImage'),
          '3': node('LoadImage'),
          '10': consumer('FluxKontextImageScale', { image: ['1', 0] }),
          '11': consumer('VAEEncode', { pixels: ['10', 0] }),
          '12': consumer('ReferenceLatent', { latent: ['11', 0] }),
          '13': consumer('TextEncodeQwenImageEditPlus', { image1: ['2', 0] }),
          '14': consumer('FluxKontextMultiReferenceLatentMethod', { image: ['3', 0] }),
        }),
      ).toEqual(['1.inputs.image', '2.inputs.image', '3.inputs.image'])
    })

    it('de-selects ControlNet, IP-Adapter and preprocessor inputs', () => {
      expect(
        suggestReferenceInputs({
          '1': node('LoadImage'),
          '2': node('LoadImage'),
          '3': node('LoadImage'),
          '4': node('LoadImage'),
          '10': consumer('ControlNetApplyAdvanced', { image: ['1', 0] }),
          '11': consumer('IPAdapterAdvanced', { image: ['2', 0] }),
          '12': consumer('DWPreprocessor', { image: ['3', 0] }),
          '13': consumer('ControlNetApplyAdvanced', { image: ['12', 0] }),
        }),
      ).toEqual(['4.inputs.image'])
    })

    it('de-selects a path that reaches a mask or inpaint node', () => {
      expect(
        suggestReferenceInputs({
          '1': node('LoadImage'),
          '2': node('LoadImage'),
          '10': consumer('ImageToMask', { image: ['1', 0] }),
          '11': consumer('VAEEncodeForInpaint', { pixels: ['2', 0] }),
        }),
      ).toEqual([])
    })

    it('de-selects an image encoded into a sampler canvas, but not one encoded for a reference', () => {
      expect(
        suggestReferenceInputs({
          '1': node('LoadImage'),
          '2': node('LoadImage'),
          '10': consumer('VAEEncode', { pixels: ['1', 0] }),
          '11': consumer('LatentUpscaleBy', { samples: ['10', 0] }),
          '12': consumer('KSampler', { latent_image: ['11', 0] }),
          '13': consumer('VAEEncode', { pixels: ['2', 0] }),
          '14': consumer('ReferenceLatent', { latent: ['13', 0] }),
        }),
      ).toEqual(['2.inputs.image'])
    })

    it('keeps an input that feeds both a reference consumer and a sampler canvas', () => {
      expect(
        suggestReferenceInputs({
          '1': node('LoadImage'),
          '10': consumer('ImageScaleToTotalPixels', { image: ['1', 0] }),
          '11': consumer('TextEncodeQwenImageEdit', { image: ['10', 0] }),
          '12': consumer('VAEEncode', { pixels: ['10', 0] }),
          '13': consumer('KSampler', { latent_image: ['12', 0] }),
        }),
      ).toEqual(['1.inputs.image'])
    })

    it('ignores the mask output of a LoadImage node', () => {
      expect(
        suggestReferenceInputs({
          '1': node('LoadImage'),
          '10': consumer('SolidMask', { source: ['1', 1] }),
          '11': consumer('GrowMask', { mask: ['1', 1] }),
        }),
      ).toEqual(['1.inputs.image'])
    })

    it('terminates on a cycle', () => {
      expect(
        suggestReferenceInputs({
          '1': node('LoadImage'),
          '10': consumer('ImageScale', { image: ['1', 0], other: ['11', 0] }),
          '11': consumer('ImageScale', { image: ['10', 0] }),
        }),
      ).toEqual(['1.inputs.image'])
    })
  })

  describe('comfyReferenceLimit', () => {
    const workflow = {
      '1': node('LoadImage'),
      '2': node('LoadImage'),
      '10': consumer('ControlNetApplyAdvanced', { image: ['2', 0] }),
    }

    const limitOf = (customWorkflow: object, mode = ComfyMode.CustomWorkflow) =>
      comfyReferenceLimit({ mode, customWorkflow })

    it('counts the suggested inputs of a custom workflow', () => {
      expect(limitOf({ workflow })).toBe(1)
    })

    it('counts the profile selection instead when it has one', () => {
      expect(limitOf({ workflow, referenceInputPaths: ['1.inputs.image', '2.inputs.image'] })).toBe(
        2,
      )
      expect(limitOf({ workflow, referenceInputPaths: [] })).toBe(0)
    })

    it('is 0 for a custom workflow without a LoadImage node', () => {
      expect(limitOf({ workflow: { '1': node('SaveImage') } })).toBe(0)
    })

    it('is 0 for the built-in workflows, even with a workflow saved, and for a malformed one', () => {
      expect(limitOf({ workflow }, ComfyMode.BasicTxt2Img)).toBe(0)
      expect(comfyReferenceLimit(undefined)).toBe(0)
      expect(limitOf({})).toBe(0)
      expect(comfyReferenceLimit({ mode: ComfyMode.CustomWorkflow })).toBe(0)
    })
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
