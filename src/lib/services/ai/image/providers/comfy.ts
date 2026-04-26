/**
 * Comfy UI Image Provider
 *
 * Direct HTTP calls to Comfy UI API.
 *
 */

import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
  ComfySamplerInfo,
  ComfyCustomWorkflow,
} from './types'
import { ComfyApi, PromptBuilder, CallWrapper } from '@saintno/comfyui-sdk'
import BasicTxt2ImgWorkflow from './comfyWorkflows/basic-txt2img-workflow.json'
import LoraTxt2ImgWorkflow from './comfyWorkflows/lora-txt2img-workflow.json'
import UnetTxt2ImgWorkflow from './comfyWorkflows/unet-txt2img-workflow.json'
import { parseImageSize } from '$lib/utils/image'

const DEFAULT_BASE_URL = 'http://localhost:8188'

export enum ComfyMode {
  CustomWorkflow = 'custom-workflow',
  BasicTxt2Img = 'basic-txt2img',
  LoraTxt2Img = 'lora-txt2img',
  UnetTxt2Img = 'unet-txt2img',
}

export const ComfyModes: Record<ComfyMode, any> = {
  [ComfyMode.CustomWorkflow]: null,
  [ComfyMode.BasicTxt2Img]: BasicTxt2ImgWorkflow,
  [ComfyMode.LoraTxt2Img]: LoraTxt2ImgWorkflow,
  [ComfyMode.UnetTxt2Img]: UnetTxt2ImgWorkflow,
}

// Tracks which model names came from diffusion_models/, keyed by baseUrl.
// Values are Promises to prevent parallel fetches for the same baseUrl.
const unetModelNames = new Map<string, Promise<Set<string>>>()

// Cached auto-detected clip/vae names per baseUrl, populated in listModels()
const autoClipCache = new Map<string, string>()
const autoVaeCache = new Map<string, string>()

export async function fetchModelList(
  baseUrl: string,
  type: string,
  timeoutMs?: number,
): Promise<string[]> {
  const controller = new AbortController()
  const timerId = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const resp = await fetch(`${baseUrl}/models/${type}`, { signal: controller.signal })
    if (!resp.ok) return []
    return (await resp.json()) as string[]
  } catch {
    return []
  } finally {
    if (timerId !== null) clearTimeout(timerId)
  }
}

export function clearComfyCacheForUrl(baseUrl: string): void {
  const key = baseUrl.trim()
  unetModelNames.delete(key)
  autoClipCache.delete(key)
  autoVaeCache.delete(key)
}

// ---------------------------------------------------------------------------
// Custom workflow helpers
// ---------------------------------------------------------------------------

/**
 * Validates that a parsed JSON object looks like a ComfyUI API-format workflow.
 * API format: root keys are node IDs (strings), each value has `class_type` (string)
 * and `inputs` (object). Rejects UI-format exports which have array `nodes`/`links`.
 *
 * Returns an error message string, or null if valid.
 */
export function validateApiWorkflow(json: unknown): string | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return 'Workflow must be a JSON object.'
  }
  const root = json as Record<string, unknown>
  // UI-format exports contain these array fields at the root
  if (Array.isArray(root['nodes']) || Array.isArray(root['links'])) {
    return 'This looks like a ComfyUI UI-format export. Please export in API format (enable "Dev Mode" in ComfyUI settings, then use "Save (API Format)").'
  }
  const entries = Object.entries(root)
  if (entries.length === 0) {
    return 'Workflow has no nodes.'
  }
  for (const [nodeId, node] of entries) {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      return `Node "${nodeId}" is not an object.`
    }
    const n = node as Record<string, unknown>
    if (typeof n['class_type'] !== 'string' || !n['class_type']) {
      return `Node "${nodeId}" is missing a valid class_type.`
    }
    if (typeof n['inputs'] !== 'object' || n['inputs'] === null || Array.isArray(n['inputs'])) {
      return `Node "${nodeId}" has an invalid inputs field.`
    }
  }
  return null
}

type WorkflowNode = ComfyCustomWorkflow['workflow'][string]

/** Extracts a short preview string from a CLIPTextEncode `text` input. */
function textPreview(textInput: unknown): string {
  if (typeof textInput === 'string') {
    const trimmed = textInput.trim()
    if (!trimmed) return '(empty)'
    return trimmed.length > 60 ? trimmed.slice(0, 60) + '…' : trimmed
  }
  if (Array.isArray(textInput)) return '(connected to another node)'
  return ''
}

/**
 * Auto-detects key field paths from a ComfyUI API-format workflow.
 *
 * Strategy (in priority order):
 * 1. Find the KSampler / KSamplerAdvanced node and follow its `positive` and
 *    `negative` input links. If those links point directly to a CLIPTextEncode
 *    node, we have an unambiguous answer regardless of node titles.
 * 2. Fall back to title-based heuristics for any CLIPTextEncode nodes that
 *    are not resolved by the graph traversal:
 *    - title contains "negative" → negative candidate
 *    - otherwise → positive candidate
 *
 * Returns:
 *  - positiveNodes: candidates for positive prompt injection (≥1 triggers picker if >1)
 *  - negativeNode: resolved negative CLIPTextEncode, or null
 *  - seedPath: first KSampler seed dot-path, or null
 *  - outputNodeId: single SaveImage node ID, or null if 0 or 2+
 *  - saveImageCount: total SaveImage nodes found
 */
export function detectWorkflowFields(workflow: ComfyCustomWorkflow['workflow']): {
  positiveNodes: Array<{
    nodeId: string
    title: string
    path: string
    textPreview: string
    kSamplerSlot: string | null
  }>
  negativeNode: { nodeId: string; title: string; path: string } | null
  seedPath: string | null
  outputNodeId: string | null
  saveImageCount: number
} {
  // ── Pass 1: collect everything ──────────────────────────────────────────
  const clipNodes = new Map<
    string,
    { nodeId: string; title: string; path: string; textPreview: string }
  >()
  let kSamplerNodeId: string | null = null
  let kSamplerNode: WorkflowNode | null = null
  let seedPath: string | null = null
  let outputNodeId: string | null = null
  let saveImageCount = 0

  for (const [nodeId, node] of Object.entries(workflow) as [string, WorkflowNode][]) {
    switch (node.class_type) {
      case 'CLIPTextEncode': {
        const title = node._meta?.title ?? ''
        clipNodes.set(nodeId, {
          nodeId,
          title,
          path: `${nodeId}.inputs.text`,
          textPreview: textPreview(node.inputs.text),
        })
        break
      }
      case 'KSampler':
      case 'KSamplerAdvanced': {
        if (!kSamplerNodeId) {
          kSamplerNodeId = nodeId
          kSamplerNode = node
          seedPath = `${nodeId}.inputs.seed`
        }
        break
      }
      case 'SaveImage': {
        saveImageCount++
        if (saveImageCount === 1) outputNodeId = nodeId
        break
      }
    }
  }

  // ── Pass 2: resolve via KSampler connections ────────────────────────────
  let resolvedPositiveId: string | null = null
  let resolvedNegativeId: string | null = null
  // Maps CLIPTextEncode nodeId → the KSampler slot name it's wired to (e.g. "positive", "negative")
  const kSamplerSlotMap = new Map<string, string>()

  if (kSamplerNode) {
    for (const [slotName, link] of Object.entries(kSamplerNode.inputs)) {
      if (Array.isArray(link)) {
        const targetId = String(link[0])
        if (clipNodes.has(targetId)) {
          kSamplerSlotMap.set(targetId, slotName)
        }
      }
    }

    const positiveLink = kSamplerNode.inputs['positive']
    const negativeLink = kSamplerNode.inputs['negative']

    if (Array.isArray(positiveLink)) {
      const targetId = String(positiveLink[0])
      if (clipNodes.has(targetId)) resolvedPositiveId = targetId
    }
    if (Array.isArray(negativeLink)) {
      const targetId = String(negativeLink[0])
      if (clipNodes.has(targetId)) resolvedNegativeId = targetId
    }
  }

  // ── Pass 3: build result ────────────────────────────────────────────────
  const positiveNodes: Array<{
    nodeId: string
    title: string
    path: string
    textPreview: string
    kSamplerSlot: string | null
  }> = []
  let negativeNode: { nodeId: string; title: string; path: string } | null = null

  const withSlot = (node: {
    nodeId: string
    title: string
    path: string
    textPreview: string
  }) => ({
    ...node,
    kSamplerSlot: kSamplerSlotMap.get(node.nodeId) ?? null,
  })

  if (resolvedPositiveId && resolvedNegativeId) {
    // Both resolved via graph — perfect, no ambiguity
    positiveNodes.push(withSlot(clipNodes.get(resolvedPositiveId)!))
    const neg = clipNodes.get(resolvedNegativeId)!
    negativeNode = { nodeId: neg.nodeId, title: neg.title, path: neg.path }
  } else if (resolvedPositiveId) {
    // Positive resolved, use title heuristics for remaining nodes
    positiveNodes.push(withSlot(clipNodes.get(resolvedPositiveId)!))
    for (const [id, node] of clipNodes) {
      if (id === resolvedPositiveId) continue
      if (node.title.toLowerCase().includes('negative') && !negativeNode) {
        negativeNode = { nodeId: node.nodeId, title: node.title, path: node.path }
      }
      // Other unresolved CLIPTextEncode nodes are ignored (they may be prompt enhancers etc.)
    }
  } else {
    // No KSampler links resolved — fall back fully to title heuristics
    for (const node of clipNodes.values()) {
      if (node.title.toLowerCase().includes('negative')) {
        if (!negativeNode)
          negativeNode = { nodeId: node.nodeId, title: node.title, path: node.path }
      } else {
        positiveNodes.push(withSlot(node))
      }
    }
  }

  return { positiveNodes, negativeNode, seedPath, outputNodeId, saveImageCount }
}

// ---------------------------------------------------------------------------
// Shared CallWrapper helper
// ---------------------------------------------------------------------------

/**
 * Builds a standardised onFailed handler for a ComfyUI CallWrapper.
 * Parses node-level validation errors from the cause object and rejects
 * the promise with a human-readable message.
 */
function buildOnFailedHandler(
  reject: (reason: Error) => void,
  label = 'ComfyUI',
): (error: Error) => void {
  return (error: Error) => {
    const cause = (error as any).cause
    console.error(`${label} generation failed:`, error.message, cause)
    let message = error.message || 'Failed to queue prompt'
    const nodeErrors = cause?.node_errors
    if (nodeErrors && Object.keys(nodeErrors).length > 0) {
      const details = Object.entries(nodeErrors)
        .map(([node, err]: [string, any]) => {
          const nodeMsgs = Array.isArray(err.errors)
            ? err.errors.map((e: any) => e.message).join(', ')
            : (err.message ?? JSON.stringify(err))
          return `Node ${node} (${err.class_type}): ${nodeMsgs}`
        })
        .join('; ')
      message = `ComfyUI Validation Error: ${details}`
    } else if (cause?.error?.message) {
      message = `ComfyUI Error: ${cause.error.message}`
    }
    reject(new Error(message))
  }
}

export function createComfyProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).trim()

  const api = new ComfyApi(baseUrl).init()

  // Binds baseUrl + optional timeout so internal callers don't repeat them.
  const fetchModels = (type: string) => fetchModelList(baseUrl, type, config.timeoutMs)

  return {
    id: 'comfyui',
    name: 'Comfy UI',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { prompt, size, providerOptions } = options
      // Strip the source-namespace prefix added by listModels() to deduplicate entries
      // (e.g. "checkpoint:model.safetensors" → "model.safetensors"). Handles both
      // prefixed IDs (new) and bare filenames (profiles saved before this change).
      const model = /^(?:checkpoint|unet):/.test(options.model)
        ? options.model.replace(/^(?:checkpoint|unet):/, '')
        : options.model

      const positiveTags = (providerOptions?.positivePrompt as string) || ''
      const negativeTags = (providerOptions?.negativePrompt as string) || ''
      const finalPositivePrompt = positiveTags ? `${prompt}, ${positiveTags}` : prompt
      const finalNegativePrompt = negativeTags
      const seed = Number(
        crypto.getRandomValues(new BigUint64Array(1))[0] % BigInt(Number.MAX_SAFE_INTEGER),
      )

      const explicitMode = providerOptions?.mode as ComfyMode | undefined

      // -----------------------------------------------------------------------
      // Custom workflow path — only when mode is explicitly CustomWorkflow.
      // -----------------------------------------------------------------------
      const rawCustomWorkflow = providerOptions?.customWorkflow as ComfyCustomWorkflow | undefined
      if (rawCustomWorkflow && explicitMode === ComfyMode.CustomWorkflow) {
        // PromptBuilder uses structuredClone() internally. Svelte $state wraps objects
        // in Proxy, which structuredClone() cannot clone (DataCloneError). A JSON
        // round-trip produces a plain, cloneable copy before passing to the SDK.
        const customWorkflow: ComfyCustomWorkflow = JSON.parse(JSON.stringify(rawCustomWorkflow))

        const inputKeys: string[] = ['positive', 'seed']
        const hasNegative = !!customWorkflow.negativePromptPath
        if (hasNegative) inputKeys.push('negative')

        let builder = new PromptBuilder(customWorkflow.workflow as any, inputKeys, ['images'])
          .setInputNode('positive', customWorkflow.positivePromptPath)
          .setInputNode('seed', customWorkflow.seedPath)
          .setOutputNode('images', customWorkflow.outputNodeId)
          .input('positive', finalPositivePrompt)
          .input('seed', seed)

        if (hasNegative) {
          builder = builder
            .setInputNode('negative', customWorkflow.negativePromptPath!)
            .input('negative', finalNegativePrompt)
        }

        return new Promise((resolve, reject) => {
          new CallWrapper(api, builder)
            .onFinished(async (data) => {
              try {
                const imageInfos = data.images?.images || []
                if (imageInfos.length === 0) {
                  return reject(new Error('ComfyUI produced no images'))
                }
                const blob = await api.getImage(imageInfos[0])
                const base64 = await blobToBase64(blob)
                resolve({ base64 })
              } catch (error) {
                console.error('Failed to process ComfyUI custom workflow output:', error)
                reject(new Error(`Failed to process image output: ${error}`))
              }
            })
            .onFailed(buildOnFailedHandler(reject, 'ComfyUI custom workflow'))
            .run()
        })
      }

      // -----------------------------------------------------------------------
      // Hardcoded workflows (basic / lora / unet) — unchanged.
      // -----------------------------------------------------------------------
      if (!model) {
        throw new Error('No ComfyUI model selected.')
      }

      const sizeToUse = parseImageSize(size)

      const loraOptions = providerOptions?.lora as
        | { name: string; strengthModel?: number; strengthClip?: number }
        | undefined

      // Explicit mode always wins. Auto-detection only runs when no mode is set.
      const hasExplicitOverride = !!explicitMode
      const isLoraMode =
        explicitMode === ComfyMode.LoraTxt2Img || (!hasExplicitOverride && !!loraOptions)

      // Only fetch diffusion_models when auto-detection is needed; explicit basic/lora
      // overrides skip it entirely to avoid an unnecessary network round-trip.
      const needsUnetDetection = !hasExplicitOverride || explicitMode === ComfyMode.UnetTxt2Img
      let unetNames = new Set<string>()
      if (needsUnetDetection) {
        if (!unetModelNames.has(baseUrl)) {
          const p = fetchModels('diffusion_models')
            .then((m) => new Set(m))
            .catch((err) => {
              unetModelNames.delete(baseUrl)
              throw err
            })
          unetModelNames.set(baseUrl, p)
        }
        unetNames = await unetModelNames.get(baseUrl)!
      }

      const isUnetMode =
        explicitMode === ComfyMode.UnetTxt2Img ||
        (!hasExplicitOverride && !isLoraMode && unetNames.has(model))

      let workflow: any

      if (isUnetMode) {
        // Configurable values with AuraFlow-appropriate defaults
        const step = providerOptions?.step ?? 8
        const cfg = providerOptions?.cfg ?? 1
        const sampler = (providerOptions?.sampler as string) ?? 'res_multistep'
        const scheduler = (providerOptions?.scheduler as string) ?? 'simple'
        const clipType = (providerOptions?.clipType as string) || 'lumina2'
        const weightDtype = (providerOptions?.weightDtype as string) || 'default'

        let clipName = (providerOptions?.clipName as string) || autoClipCache.get(baseUrl) || ''
        if (!clipName) {
          const clips = await fetchModels('text_encoders')
          clipName = clips[0] || ''
          if (clipName) autoClipCache.set(baseUrl, clipName)
        }

        let vaeName = (providerOptions?.vaeName as string) || autoVaeCache.get(baseUrl) || ''
        if (!vaeName) {
          const vaes = await fetchModels('vae')
          vaeName = vaes[0] || ''
          if (vaeName) autoVaeCache.set(baseUrl, vaeName)
        }

        if (!clipName) throw new Error('No CLIP/text encoder model found in ComfyUI.')
        if (!vaeName) throw new Error('No VAE model found in ComfyUI.')

        const inputKeys = [
          'unet_name',
          'weight_dtype',
          'clip_name',
          'clip_type',
          'vae_name',
          'positive',
          'seed',
          'batch',
          'step',
          'cfg',
          'sampler',
          'scheduler',
          'width',
          'height',
        ]

        workflow = new PromptBuilder(JSON.parse(JSON.stringify(UnetTxt2ImgWorkflow)), inputKeys, [
          'images',
        ])
          .setInputNode('unet_name', '1.inputs.unet_name')
          .setInputNode('weight_dtype', '1.inputs.weight_dtype')
          .setInputNode('clip_name', '3.inputs.clip_name')
          .setInputNode('clip_type', '3.inputs.type')
          .setInputNode('vae_name', '4.inputs.vae_name')
          .setInputNode('positive', '5.inputs.text')
          .setInputNode('batch', '7.inputs.batch_size')
          .setInputNode('width', '7.inputs.width')
          .setInputNode('height', '7.inputs.height')
          .setInputNode('seed', '8.inputs.seed')
          .setInputNode('step', '8.inputs.steps')
          .setInputNode('cfg', '8.inputs.cfg')
          .setInputNode('sampler', '8.inputs.sampler_name')
          .setInputNode('scheduler', '8.inputs.scheduler')
          .setOutputNode('images', '10')
          .input('unet_name', model, api.osType)
          .input('weight_dtype', weightDtype)
          .input('clip_name', clipName, api.osType)
          .input('clip_type', clipType)
          .input('vae_name', vaeName, api.osType)
          .input('positive', finalPositivePrompt)
          .input('seed', seed)
          .input('step', step)
          .input('cfg', cfg)
          .input<string>('sampler', sampler)
          .input<string>('scheduler', scheduler)
          .input('width', sizeToUse.width)
          .input('height', sizeToUse.height)
          .input('batch', 1)
      } else {
        // Checkpoint-based workflows (basic or lora)
        const step = providerOptions?.step ?? 6
        const cfg = providerOptions?.cfg ?? 1
        const sampler = (providerOptions?.sampler as string) ?? 'dpmpp_2m_sde_gpu'
        const scheduler = (providerOptions?.scheduler as string) ?? 'sgm_uniform'

        const inputKeys = [
          'positive',
          'negative',
          'checkpoint',
          'seed',
          'batch',
          'step',
          'cfg',
          'sampler',
          'scheduler',
          'width',
          'height',
        ]

        if (isLoraMode) {
          inputKeys.push('lora_name', 'lora_strength_model', 'lora_strength_clip')
        }

        // JSON round-trip ensures PromptBuilder receives a plain, unshared object.
        // The imported JSON modules are singletons — if the SDK mutates the object
        // before or after cloning, it would corrupt all subsequent calls.
        const workflowBase = JSON.parse(
          JSON.stringify(isLoraMode ? LoraTxt2ImgWorkflow : BasicTxt2ImgWorkflow),
        )

        let builder = new PromptBuilder(workflowBase, inputKeys, ['images'])
          .setInputNode('checkpoint', '4.inputs.ckpt_name')
          .setInputNode('seed', '3.inputs.seed')
          .setInputNode('batch', '5.inputs.batch_size')
          .setInputNode('negative', '7.inputs.text')
          .setInputNode('positive', '6.inputs.text')
          .setInputNode('cfg', '3.inputs.cfg')
          .setInputNode('sampler', '3.inputs.sampler_name')
          .setInputNode('scheduler', '3.inputs.scheduler')
          .setInputNode('step', '3.inputs.steps')
          .setInputNode('width', '5.inputs.width')
          .setInputNode('height', '5.inputs.height')
          .setOutputNode('images', '9')
          .input('checkpoint', model, api.osType)
          .input('seed', seed)
          .input('step', step)
          .input('cfg', cfg)
          .input<string>('sampler', sampler)
          .input<string>('scheduler', scheduler)
          .input('width', sizeToUse.width)
          .input('height', sizeToUse.height)
          .input('batch', 1)
          .input('positive', finalPositivePrompt)
          .input('negative', finalNegativePrompt)

        if (isLoraMode && loraOptions) {
          builder = builder
            .setInputNode('lora_name', '2.inputs.lora_name')
            .setInputNode('lora_strength_model', '2.inputs.strength_model')
            .setInputNode('lora_strength_clip', '2.inputs.strength_clip')
            .input('lora_name', loraOptions.name, api.osType)
            .input('lora_strength_model', loraOptions.strengthModel ?? 1)
            .input('lora_strength_clip', loraOptions.strengthClip ?? 1)
        }

        workflow = builder
      }

      return new Promise((resolve, reject) => {
        new CallWrapper(api, workflow)
          .onFinished(async (data) => {
            try {
              const imageInfos = data.images?.images || []
              if (imageInfos.length === 0) {
                return reject(new Error('ComfyUI produced no images'))
              }

              const blob = await api.getImage(imageInfos[0])
              const base64 = await blobToBase64(blob)

              resolve({ base64 })
            } catch (error) {
              console.error('Failed to process ComfyUI output:', error)
              reject(new Error(`Failed to process image output: ${error}`))
            }
          })
          .onFailed(buildOnFailedHandler(reject))
          .run()
      })
    },

    async listModels(): Promise<ImageModelInfo[]> {
      try {
        const [checkpoints, diffusionModels, textEncoders, vaeModels] = await Promise.all([
          api.getCheckpoints().catch(() => [] as string[]),
          fetchModels('diffusion_models'),
          fetchModels('text_encoders'),
          fetchModels('vae'),
        ])

        // Cache auto-detected clip/vae for this baseUrl
        if (textEncoders[0]) autoClipCache.set(baseUrl, textEncoders[0])
        if (vaeModels[0]) autoVaeCache.set(baseUrl, vaeModels[0])

        // Track which models require the unet workflow (keyed per baseUrl, resolved Promise)
        unetModelNames.set(baseUrl, Promise.resolve(new Set(diffusionModels)))

        const toInfo =
          (prefix: string, description: string) =>
          (m: string): ImageModelInfo => ({
            id: `${prefix}:${m}`,
            name: m,
            description,
            supportsSizes: [],
            supportsImg2Img: false,
            costPerImage: 0,
          })

        return [
          ...checkpoints.map(toInfo('checkpoint', 'Checkpoint')),
          ...diffusionModels.map(toInfo('unet', 'Diffusion Model')),
        ]
      } catch {
        return []
      }
    },

    async listLoras(): Promise<string[]> {
      try {
        return await api.getLoras()
      } catch {
        return []
      }
    },

    async getSamplerInfo(): Promise<ComfySamplerInfo> {
      const sampler = await api.getSamplerInfo()
      const samplerList = sampler.sampler?.[0]
      const schedulerList = sampler.scheduler?.[0]

      return {
        samplers: Array.isArray(samplerList)
          ? samplerList
          : typeof samplerList === 'string'
            ? [samplerList]
            : [],
        schedulers: Array.isArray(schedulerList)
          ? schedulerList
          : typeof schedulerList === 'string'
            ? [schedulerList]
            : [],
      }
    },
  }
}

/**
 * Converts a Blob to a base64 string (raw, no data URL prefix).
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
