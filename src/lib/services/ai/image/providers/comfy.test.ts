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
  clearComfyCache,
  comfyReferenceLimit,
  createComfyProvider,
  detectWorkflowFields,
  isWorkflowComplete,
  workflowProblems,
  pickInputs,
  workflowInputs,
  listNodes,
  loadImageInputs,
  suggestReferenceInputs,
  validateWorkflowPath,
} from './comfy'
import BasicWorkflow from './comfyWorkflows/basic-txt2img-workflow.json'
import LoraWorkflow from './comfyWorkflows/lora-txt2img-workflow.json'
import UnetWorkflow from './comfyWorkflows/unet-txt2img-workflow.json'
import type { Json } from './comfyImage'
import type { ImageGenerateOptions } from './types'
import { imageConnectionFor, modelListKey } from './connection'

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

const listKeyOf = (apiKey: string, baseUrl?: string) =>
  modelListKey(imageConnectionFor('comfyui', apiKey, baseUrl))

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

const modelRequests = () =>
  vi
    .mocked(imageGetFetch)
    .mock.calls.map(([url]) => String(url))
    .filter((url) => url.includes('/models/'))

beforeEach(() => {
  vi.clearAllMocks()
  clearComfyCache(listKeyOf(''))
  system = { ...SERVER }
  listing({})
  serve('9')
})

const listInputs = (
  graph: Parameters<typeof workflowInputs>[0],
  kind: 'string' | 'number',
  selected?: string[],
) => pickInputs(workflowInputs(graph), kind, selected)

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

  it('reads no model list when the profile names the text encoder and VAE', async () => {
    await generate(opts, { model: 'unet:flux.safetensors' })
    expect(modelRequests()).toEqual([])
  })

  it('takes the first text encoder and VAE the server lists when the profile names none', async () => {
    listing({
      text_encoders: ['clip.safetensors', 'other.safetensors'],
      vae: ['ae.safetensors', 'other.safetensors'],
    })
    await generate({ mode: ComfyMode.UnetTxt2Img }, { model: 'unet:flux.safetensors' })
    const graph = postedGraph()
    expect(graph['3'].inputs.clip_name).toBe('clip.safetensors')
    expect(graph['4'].inputs.vae_name).toBe('ae.safetensors')
  })

  it('fails when the server has no text encoder', async () => {
    await expect(
      generate({ mode: ComfyMode.UnetTxt2Img }, { model: 'unet:flux.safetensors' }),
    ).rejects.toThrow('No CLIP/text encoder model found')
  })
})

describe('workflow selection', () => {
  it('picks the UNet workflow from the id prefix when no mode is set', async () => {
    serve('10')
    listing({ text_encoders: ['clip.safetensors'], vae: ['ae.safetensors'] })
    await generate({}, { model: 'unet:flux.safetensors' })
    const graph = postedGraph()
    expect(graph['1'].inputs.unet_name).toBe('flux.safetensors')
    expect(modelRequests().some((url) => url.endsWith('/models/diffusion_models'))).toBe(false)
  })

  it('picks the checkpoint workflow for a bare id when no mode is set', async () => {
    serve('9')
    await generate({}, { model: 'sd15.safetensors' })
    const graph = postedGraph()
    expect(graph['4'].inputs.ckpt_name).toBe('sd15.safetensors')
    expect(modelRequests()).toEqual([])
  })

  it('keeps a checkpoint-prefixed id on the checkpoint workflow even if a diffusion model shares its name', async () => {
    listing({ diffusion_models: ['m.safetensors'] })
    serve('9')
    await generate({}, { model: 'checkpoint:m.safetensors' })
    expect(postedGraph()['4'].inputs.ckpt_name).toBe('m.safetensors')
    expect(modelRequests()).toEqual([])
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
    positivePromptPaths: ['57:27.inputs.text'],
    seedPath: '57:3.inputs.seed',
    outputNodeId: '60',
    negativePromptPaths: ['57:28.inputs.text'],
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
        customWorkflow: custom({ negativePromptPaths: [] }),
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

  describe('API key', () => {
    const authorizations = () =>
      sdkFetch.mock.calls.map(([, init]) => new Headers(init?.headers).get('Authorization'))

    it('goes to every generation request, uploads and downloads included', async () => {
      await createComfyProvider({ apiKey: 'k' }).generate(
        options({
          model: '',
          referenceImages: ['iVBORw0KGgo='],
          providerOptions: {
            mode: ComfyMode.CustomWorkflow,
            customWorkflow: custom({ workflow: withLoad }),
            inputReferences: true,
          },
        }),
      )
      const paths = sdkFetch.mock.calls.map(([input]) => new URL(input).pathname)
      expect(paths).toEqual(expect.arrayContaining(['/upload/image', '/prompt', '/view']))
      expect(authorizations().every((value) => value === 'Bearer k')).toBe(true)
    })

    it('is not sent when empty', async () => {
      await generate({ mode: ComfyMode.CustomWorkflow, customWorkflow: custom() }, { model: '' })
      expect(sdkFetch).toHaveBeenCalled()
      expect(authorizations().every((value) => value === null)).toBe(true)
    })
  })

  it('refuses custom-workflow mode without a workflow instead of drawing another one', async () => {
    await expect(generate({ mode: ComfyMode.CustomWorkflow }, { model: '' })).rejects.toThrow(
      'no custom workflow',
    )
  })

  it.each([
    ['no prompt input', { positivePromptPaths: [] }],
    ['no output node', { outputNodeId: null }],
    ['a prompt input the workflow lacks', { positivePromptPaths: ['1.inputs.text'] }],
  ])('refuses a workflow with %s', async (_name, over) => {
    await expect(
      generate({ mode: ComfyMode.CustomWorkflow, customWorkflow: custom(over) }, { model: '' }),
    ).rejects.toThrow('no complete custom workflow')
  })

  it('writes into every prompt input and leaves the seed alone without a seed path', async () => {
    serve('9')
    const encoders = {
      '1': { class_type: 'CLIPTextEncodeFlux', inputs: { clip_l: '', t5xxl: '' } },
      '2': { class_type: 'RandomNoise', inputs: { noise_seed: 5 } },
      '9': { class_type: 'SaveImage', inputs: {} },
    }
    await generate(
      {
        mode: ComfyMode.CustomWorkflow,
        customWorkflow: {
          workflow: encoders,
          positivePromptPaths: ['1.inputs.clip_l', '1.inputs.t5xxl'],
          seedPath: null,
          outputNodeId: '9',
          negativePromptPaths: [],
        },
      },
      { model: '' },
    )
    const graph = postedGraph()
    expect(graph['1'].inputs).toEqual({ clip_l: 'a castle', t5xxl: 'a castle' })
    expect(graph['2'].inputs.noise_seed).toBe(5)
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

describe('connection cache', () => {
  const unet = { mode: ComfyMode.UnetTxt2Img }
  const generateAs = (apiKey: string, baseUrl = 'http://localhost:8188') =>
    createComfyProvider({ apiKey, baseUrl }).generate(
      options({ model: 'unet:flux.safetensors', providerOptions: unet }),
    )

  beforeEach(() => {
    for (const key of ['k1', 'k2']) clearComfyCache(listKeyOf(key, 'http://localhost:8188'))
    listing({ text_encoders: ['clip.safetensors'], vae: ['ae.safetensors'] })
    serve('10')
  })

  it('clears what is cached for a connection, and only that one', async () => {
    const baseUrl = 'http://localhost:8188/'
    await generateAs('k1', baseUrl)
    await generateAs('k2', baseUrl)
    clearComfyCache(listKeyOf('k1', baseUrl))
    await generateAs('k1', baseUrl)
    await generateAs('k2', baseUrl)
    expect(statsRequests()).toHaveLength(3)
  })

  it('keeps a text encoder and VAE picked for one API key from another key at the same URL', async () => {
    listing({ text_encoders: ['one.safetensors'], vae: ['one-ae.safetensors'] })
    await generateAs('k1')
    expect(postedGraph()['3'].inputs.clip_name).toBe('one.safetensors')

    listing({ text_encoders: ['two.safetensors'], vae: ['two-ae.safetensors'] })
    sdkFetch.mockClear()
    await generateAs('k2')
    const graph = postedGraph()
    expect(graph['3'].inputs.clip_name).toBe('two.safetensors')
    expect(graph['4'].inputs.vae_name).toBe('two-ae.safetensors')
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

describe('detectWorkflowFields', () => {
  type Workflow = Parameters<typeof detectWorkflowFields>[0]
  const node = (class_type: string, inputs: Record<string, Json>, title?: string) => ({
    class_type,
    inputs,
    ...(title && { _meta: { title } }),
  })

  it('finds the prompt, negative, seed and output of a plain graph', () => {
    const workflow: Workflow = {
      '3': node('KSampler', {
        seed: 1,
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      }),
      '6': node('CLIPTextEncode', { text: 'a', clip: ['4', 1] }),
      '7': node('CLIPTextEncode', { text: 'b', clip: ['4', 1] }),
      '4': node('CheckpointLoaderSimple', { ckpt_name: 'm.safetensors' }),
      '8': node('VAEDecode', { samples: ['3', 0] }),
      '9': node('SaveImage', { images: ['8', 0] }),
    }
    expect(detectWorkflowFields(workflow)).toEqual({
      positivePromptPaths: ['6.inputs.text'],
      negativePromptPaths: ['7.inputs.text'],
      seedPath: '3.inputs.seed',
      outputNodeId: '9',
    })
  })

  it('uses noise_seed for KSamplerAdvanced', () => {
    const workflow: Workflow = {
      '3': node('KSamplerAdvanced', {
        noise_seed: 1,
        positive: ['6', 0],
        latent_image: ['5', 0],
      }),
      '6': node('CLIPTextEncode', { text: 'a' }),
      '9': node('SaveImage', { images: ['3', 0] }),
    }
    expect(detectWorkflowFields(workflow).seedPath).toBe('3.inputs.noise_seed')
  })

  it('finds a Flux graph through its guider, with the seed on the noise node', () => {
    const workflow: Workflow = {
      '1': node('CLIPTextEncodeFlux', { clip_l: '', t5xxl: '', guidance: 3.5 }),
      '2': node('FluxGuidance', { conditioning: ['1', 0], guidance: 3.5 }),
      '3': node('BasicGuider', { conditioning: ['2', 0], model: ['10', 0] }),
      '4': node('RandomNoise', { noise_seed: 7 }),
      '5': node('SamplerCustomAdvanced', {
        noise: ['4', 0],
        guider: ['3', 0],
        sampler: ['11', 0],
        latent_image: ['12', 0],
      }),
      '10': node('UNETLoader', { unet_name: 'flux.safetensors' }),
      '11': node('KSamplerSelect', { sampler_name: 'euler' }),
      '12': node('EmptySD3LatentImage', { width: 1024, height: 1024 }),
      '13': node('VAEDecode', { samples: ['5', 0] }),
      '14': node('SaveImage', { images: ['13', 0] }),
    }
    expect(detectWorkflowFields(workflow)).toEqual({
      positivePromptPaths: ['1.inputs.clip_l', '1.inputs.t5xxl'],
      negativePromptPaths: [],
      seedPath: '4.inputs.noise_seed',
      outputNodeId: '14',
    })
  })

  it('follows a prompt input linked from a string node to that node', () => {
    const workflow: Workflow = {
      '1': node('CLIPTextEncode', { text: ['2', 0] }),
      '2': node('PrimitiveString', { value: 'a castle' }),
      '3': node('KSampler', { seed: 1, positive: ['1', 0], latent_image: ['5', 0] }),
      '9': node('SaveImage', { images: ['3', 0] }),
    }
    expect(detectWorkflowFields(workflow).positivePromptPaths).toEqual(['2.inputs.value'])
  })

  it('does not take a non-text widget of the node a prompt input links to', () => {
    const workflow: Workflow = {
      '1': node('CLIPTextEncode', { text: ['2', 0] }),
      '2': node('StringConcatenate', {
        string_a: ['4', 0],
        string_b: ['5', 0],
        delimiter: ', ',
      }),
      '3': node('KSampler', { seed: 1, positive: ['1', 0], latent_image: ['6', 0] }),
      '9': node('SaveImage', { images: ['3', 0] }),
    }
    expect(detectWorkflowFields(workflow).positivePromptPaths).toEqual([])
  })

  it('does not follow a prompt input into a loader', () => {
    const workflow: Workflow = {
      '1': node('CLIPTextEncode', { text: ['2', 0] }),
      '2': node('TextFileLoader', { text_file: 'notes.txt' }),
      '3': node('KSampler', { seed: 1, positive: ['1', 0], latent_image: ['6', 0] }),
      '9': node('SaveImage', { images: ['3', 0] }),
    }
    expect(detectWorkflowFields(workflow).positivePromptPaths).toEqual([])
  })

  it('does not take the system prompt of a Lumina2 encoder', () => {
    const workflow: Workflow = {
      '1': node('CLIPTextEncodeLumina2', { system_prompt: 'superior', user_prompt: '' }),
      '3': node('KSampler', { seed: 1, positive: ['1', 0], latent_image: ['5', 0] }),
      '9': node('SaveImage', { images: ['3', 0] }),
    }
    expect(detectWorkflowFields(workflow).positivePromptPaths).toEqual(['1.inputs.user_prompt'])
  })

  it('follows each conditioning through a node that takes both a positive and a negative', () => {
    const workflow: Workflow = {
      '1': node('CLIPTextEncode', { text: 'a' }),
      '2': node('CLIPTextEncode', { text: 'b' }),
      '3': node('ControlNetApplyAdvanced', { negative: ['2', 0], positive: ['1', 0] }),
      '4': node('KSampler', {
        seed: 1,
        positive: ['3', 0],
        negative: ['3', 1],
        latent_image: ['5', 0],
      }),
      '9': node('SaveImage', { images: ['4', 0] }),
    }
    const detected = detectWorkflowFields(workflow)
    expect(detected.positivePromptPaths).toEqual(['1.inputs.text'])
    expect(detected.negativePromptPaths).toEqual(['2.inputs.text'])
  })

  it('finds no negative behind a zeroed-out conditioning', () => {
    const detected = detectWorkflowFields(UnetWorkflow as unknown as Workflow)
    expect(detected.positivePromptPaths).toEqual(['5.inputs.text'])
    expect(detected.negativePromptPaths).toEqual([])
    expect(detected.seedPath).toBe('8.inputs.seed')
    expect(detected.outputNodeId).toBe('10')
  })

  it('leaves the output unset without exactly one SaveImage', () => {
    const none: Workflow = { '1': node('CLIPTextEncode', { text: '' }) }
    const two: Workflow = {
      '1': node('SaveImage', { images: ['3', 0] }),
      '2': node('SaveImage', { images: ['3', 0] }),
    }
    expect(detectWorkflowFields(none).outputNodeId).toBeNull()
    expect(detectWorkflowFields(two).outputNodeId).toBeNull()
  })

  it('falls back to encoder titles that name their role when no sampler is found', () => {
    const workflow: Workflow = {
      '1': node('CLIPTextEncode', { text: '' }, 'Positive prompt'),
      '2': node('CLIPTextEncode', { text: '' }, 'Negative'),
      '9': node('SaveImage', {}),
    }
    expect(detectWorkflowFields(workflow)).toEqual({
      positivePromptPaths: ['1.inputs.text'],
      negativePromptPaths: ['2.inputs.text'],
      seedPath: null,
      outputNodeId: '9',
    })
  })

  it('does not guess a prompt from encoders whose titles name no role', () => {
    const workflow: Workflow = {
      '1': node('CLIPTextEncode', { text: '' }, 'CLIP Text Encode (Prompt)'),
      '2': node('CLIPTextEncode', { text: '' }, 'CLIP Text Encode (Prompt)'),
      '9': node('SaveImage', {}),
    }
    expect(detectWorkflowFields(workflow).positivePromptPaths).toEqual([])
  })

  it('skips a titled encoder whose text another node feeds', () => {
    const workflow: Workflow = {
      '1': node('CLIPTextEncode', { text: ['2', 0] }, 'Positive'),
      '2': node('PrimitiveString', { value: 'a' }),
      '9': node('SaveImage', {}),
    }
    expect(detectWorkflowFields(workflow).positivePromptPaths).toEqual([])
  })

  it('leaves a negative unset when the sampler settled none, whatever an encoder is titled', () => {
    const workflow: Workflow = {
      '1': node('CLIPTextEncode', { text: '' }),
      '2': node('CLIPTextEncode', { text: '' }, 'Negative'),
      '3': node('KSampler', { seed: 1, positive: ['1', 0], latent_image: ['5', 0] }),
      '9': node('SaveImage', { images: ['3', 0] }),
    }
    const detected = detectWorkflowFields(workflow)
    expect(detected.positivePromptPaths).toEqual(['1.inputs.text'])
    expect(detected.negativePromptPaths).toEqual([])
  })

  it('takes every text input of a negative encoder', () => {
    const workflow: Workflow = {
      '1': node('CLIPTextEncodeSDXL', { text_g: '', text_l: '' }),
      '2': node('CLIPTextEncodeSDXL', { text_g: '', text_l: '' }),
      '3': node('KSampler', {
        seed: 1,
        positive: ['1', 0],
        negative: ['2', 0],
        latent_image: ['5', 0],
      }),
      '9': node('SaveImage', { images: ['3', 0] }),
    }
    expect(detectWorkflowFields(workflow).negativePromptPaths).toEqual([
      '2.inputs.text_g',
      '2.inputs.text_l',
    ])
  })

  it('follows a seed linked from a primitive to that node', () => {
    const workflow: Workflow = {
      '3': node('KSampler', { seed: ['12', 0], positive: ['1', 0], latent_image: ['5', 0] }),
      '12': node('PrimitiveInt', { value: 5 }),
      '9': node('SaveImage', { images: ['3', 0] }),
    }
    expect(detectWorkflowFields(workflow).seedPath).toBe('12.inputs.value')
  })

  it('leaves a linked seed unset when its source has no clear seed input', () => {
    const workflow: Workflow = {
      '3': node('KSampler', { seed: ['12', 0], positive: ['1', 0], latent_image: ['5', 0] }),
      '12': node('SomeMath', { a: 1, b: 2 }),
      '9': node('SaveImage', { images: ['3', 0] }),
    }
    expect(detectWorkflowFields(workflow).seedPath).toBeNull()
  })

  it('suggests nothing for a graph it does not recognise, without throwing', () => {
    const workflow: Workflow = { '1': node('MyCustomNode', { strength: 1 }) }
    expect(detectWorkflowFields(workflow)).toEqual({
      positivePromptPaths: [],
      negativePromptPaths: [],
      seedPath: null,
      outputNodeId: null,
    })
  })

  it('terminates on a cycle', () => {
    const workflow: Workflow = {
      '1': node('KSampler', { seed: 1, positive: ['2', 0], latent_image: ['2', 0] }),
      '2': node('ConditioningCombine', { conditioning_1: ['1', 0] }),
      '9': node('SaveImage', { images: ['1', 0] }),
    }
    expect(() => detectWorkflowFields(workflow)).not.toThrow()
  })
})

describe('workflow inputs', () => {
  const workflow = {
    '10': { class_type: 'KSampler', inputs: { seed: 1, steps: 20, positive: ['2', 0] } },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'a', clip: ['4', 1] },
      _meta: { title: 'Prompt' },
    },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'x' } },
  }

  it('lists the string inputs in node-id order, text inputs first', () => {
    expect(listInputs(workflow, 'string').map((i) => i.path)).toEqual([
      '2.inputs.text',
      '9.inputs.filename_prefix',
    ])
  })

  it('lists the number inputs, seed inputs first, and names a node by its title or class', () => {
    const inputs = listInputs(workflow, 'number')
    expect(inputs.map((i) => i.path)).toEqual(['10.inputs.seed', '10.inputs.steps'])
    expect(listInputs(workflow, 'string')[0].title).toBe('Prompt')
    expect(inputs[0].title).toBe('KSampler')
  })

  it('lists a selected path whose input is linked, marked with a null value', () => {
    const linked = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: ['2', 0] } },
      '2': { class_type: 'PrimitiveString', inputs: { value: 'a' } },
    }
    expect(listInputs(linked, 'string').map((i) => i.path)).toEqual(['2.inputs.value'])
    const inputs = listInputs(linked, 'string', ['1.inputs.text'])
    expect(inputs.map((i) => [i.path, i.value])).toEqual([
      ['1.inputs.text', null],
      ['2.inputs.value', 'a'],
    ])
  })

  it('lists the saving nodes first', () => {
    expect(listNodes(workflow).map((n) => n.nodeId)).toEqual(['9', '2', '10'])
  })

  it.each([
    ['2.inputs.text', true],
    ['2.inputs.missing', false],
    ['3.inputs.text', false],
    ['2.text', false],
    ['2.inputs.text.extra', false],
    ['__proto__.inputs.text', false],
  ])('validates the path %s as %s', (path, valid) => {
    expect(validateWorkflowPath(workflow, path)).toBe(valid)
  })

  it('treats a workflow as complete only with a valid prompt input and an output node', () => {
    const complete = {
      workflow,
      positivePromptPaths: ['2.inputs.text'],
      seedPath: '10.inputs.seed',
      outputNodeId: '9',
      negativePromptPaths: [],
    }
    expect(isWorkflowComplete(complete)).toBe(true)
    expect(isWorkflowComplete({ ...complete, positivePromptPaths: [] })).toBe(false)
    expect(isWorkflowComplete({ ...complete, outputNodeId: null })).toBe(false)
    expect(isWorkflowComplete({ ...complete, outputNodeId: '1' })).toBe(false)
    expect(isWorkflowComplete({ ...complete, seedPath: '10.inputs.gone' })).toBe(false)
    expect(isWorkflowComplete({ ...complete, seedPath: null })).toBe(true)
  })

  it('says what is missing from an incomplete workflow', () => {
    const complete = {
      workflow,
      positivePromptPaths: ['2.inputs.text'],
      seedPath: null,
      outputNodeId: '9',
      negativePromptPaths: [],
    }
    expect(workflowProblems(complete)).toEqual([])
    expect(workflowProblems({ ...complete, positivePromptPaths: [], outputNodeId: null })).toEqual([
      'Choose a prompt input.',
      'Choose an output node.',
    ])
    expect(workflowProblems({ ...complete, negativePromptPaths: ['2.inputs.gone'] })).toEqual([
      'A selected input is not in this workflow.',
    ])
    expect(workflowProblems({ ...complete, outputNodeId: '1' })).toEqual([
      'The output node is not in this workflow.',
    ])
  })
})
