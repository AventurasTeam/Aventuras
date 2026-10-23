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
import * as z from 'zod'
import BasicTxt2ImgWorkflow from './comfyWorkflows/basic-txt2img-workflow.json'
import LoraTxt2ImgWorkflow from './comfyWorkflows/lora-txt2img-workflow.json'
import UnetTxt2ImgWorkflow from './comfyWorkflows/unet-txt2img-workflow.json'
import { formatImageSize, specToPixels } from '#lib/utils/image.ts'
import { isNewerVersion } from '#lib/utils/version.ts'
import { imageGetFetch } from './fetchAdapter'
import { MIN_COMFYUI_VERSION, createComfyImage, type ComfyImageOptions } from './comfyImage'
import { createImageSdkFetch, createPollImageSdkFetch, generateSdkImage } from './sdkImage'

const DEFAULT_BASE_URL = 'http://localhost:8188'

// A server that does not answer is not worth the generation's own timeout.
const PROBE_TIMEOUT_MS = 5_000
const POLL_TIMEOUT_MS = 15_000

const normalizeBaseUrl = (url: string) => url.trim().replace(/\/+$/, '')

export enum ComfyMode {
  CustomWorkflow = 'custom-workflow',
  BasicTxt2Img = 'basic-txt2img',
  LoraTxt2Img = 'lora-txt2img',
  UnetTxt2Img = 'unet-txt2img',
}

// Tracks which model names came from diffusion_models/, keyed by baseUrl.
// Values are Promises to prevent parallel fetches for the same baseUrl.
const unetModelNames = new Map<string, Promise<Set<string>>>()

// Cached auto-detected clip/vae names per baseUrl, populated in listModels()
const autoClipCache = new Map<string, string>()
const autoVaeCache = new Map<string, string>()

const SystemStats = z.object({
  system: z.object({
    os: z.string().optional().catch(undefined),
    comfyui_version: z.string().optional().catch(undefined),
  }),
})

type ServerSystem = z.infer<typeof SystemStats>['system']

// Per baseUrl, as a Promise so parallel generations share one request. A server that could not be
// asked is not cached, and its own error comes from the generation request.
const serverSystems = new Map<string, Promise<ServerSystem | undefined>>()

export async function fetchModelList(
  baseUrl: string,
  type: string,
  timeoutMs?: number,
): Promise<string[]> {
  // Tauri HTTP, not the WebView's fetch (docs/architecture/overview.md, "Local image servers").
  const resp = await imageGetFetch(`${normalizeBaseUrl(baseUrl)}/models/${type}`, undefined, {
    serviceId: 'comfy-models',
    timeoutMs,
  })
  return (await resp.json()) as string[]
}

export function clearComfyCacheForUrl(baseUrl: string): void {
  const key = normalizeBaseUrl(baseUrl)
  unetModelNames.delete(key)
  autoClipCache.delete(key)
  autoVaeCache.delete(key)
  serverSystems.delete(key)
}

async function readServerSystem(
  baseUrl: string,
  timeoutMs?: number,
): Promise<ServerSystem | undefined> {
  try {
    const response = await imageGetFetch(`${baseUrl}/system_stats`, undefined, {
      serviceId: 'comfy-system',
      timeoutMs: Math.min(timeoutMs ?? PROBE_TIMEOUT_MS, PROBE_TIMEOUT_MS),
    })
    return SystemStats.parse(await response.json()).system
  } catch {
    return undefined
  }
}

/** Throws for a server below the supported version; returns what it reports about itself. */
async function checkServer(baseUrl: string, timeoutMs?: number): Promise<ServerSystem | undefined> {
  let pending = serverSystems.get(baseUrl)
  if (!pending) {
    pending = readServerSystem(baseUrl, timeoutMs)
    serverSystems.set(baseUrl, pending)
  }
  const system = await pending
  if (!system) {
    serverSystems.delete(baseUrl)
    return undefined
  }
  const version = system.comfyui_version
  if (version && isNewerVersion(MIN_COMFYUI_VERSION, version)) {
    serverSystems.delete(baseUrl)
    throw new Error(
      `ComfyUI ${version} is older than ${MIN_COMFYUI_VERSION}, the oldest version Aventuras supports. Update ComfyUI.`,
    )
  }
  return system
}

// ComfyUI lists a model in a subfolder with its own path separator and matches names exactly.
function toServerPath(name: string, os: string | undefined): string {
  if (os === undefined) return name
  return os === 'win32' ? name.replaceAll('/', '\\') : name.replaceAll('\\', '/')
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
  const kSamplerNodes = new Map<string, WorkflowNode>()
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
        kSamplerNodes.set(nodeId, node)
        break
      }
      case 'SaveImage': {
        saveImageCount++
        if (saveImageCount === 1) outputNodeId = nodeId
        break
      }
    }
  }

  // ── Walk back from SaveImage to find the sampler on the output branch ───
  // Object.entries() order is unrelated to graph topology, so we can't just
  // pick the first KSampler seen — in multi-stage workflows a refiner or
  // upscaler sampler may appear earlier than the one that feeds SaveImage.
  if (outputNodeId) {
    const visited = new Set<string>()
    const queue = [outputNodeId]
    while (queue.length > 0) {
      const currentId = queue.shift()!
      if (visited.has(currentId)) continue
      visited.add(currentId)
      if (kSamplerNodes.has(currentId)) {
        kSamplerNodeId = currentId
        kSamplerNode = kSamplerNodes.get(currentId)!
        seedPath = `${currentId}.inputs.seed`
        break
      }
      const n = workflow[currentId]
      if (!n) continue
      for (const input of Object.values(n.inputs)) {
        if (Array.isArray(input)) queue.push(String(input[0]))
      }
    }
  }
  // Fallback for workflows without SaveImage: use first sampler in iteration order
  if (!kSamplerNodeId && kSamplerNodes.size > 0) {
    const [id, node] = kSamplerNodes.entries().next().value as [string, WorkflowNode]
    kSamplerNodeId = id
    kSamplerNode = node
    seedPath = `${id}.inputs.seed`
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

const byNodeId = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

const imageInput = (nodeId: string) => `${nodeId}.inputs.image`

/** The `image` input of every `LoadImage` node, in node-id order. */
export function loadImageInputs(workflow: ComfyCustomWorkflow['workflow']) {
  return Object.entries(workflow)
    .filter(([, node]) => node.class_type === 'LoadImage')
    .toSorted(([a], [b]) => byNodeId(a, b))
    .map(([nodeId, node]) => ({
      nodeId,
      path: imageInput(nodeId),
      title: node._meta?.title ?? 'LoadImage',
      image: typeof node.inputs.image === 'string' ? node.inputs.image : '',
    }))
}

// Consumers that read an image as something to look at.
const REFERENCE = /ReferenceLatent|TextEncodeQwenImage|FluxKontextMultiReference/
// Consumers that treat an image as guidance or a canvas, not as a reference.
const NOT_A_REFERENCE = /ControlNet|IPAdapter|Preprocessor|Inpaint|Outpaint|Mask/i
const PASS_THROUGH = /^(Image|Latent|VAEEncode)|Resize|Scale|Crop/

interface Edge {
  to: string
  input: string
  slot: number
}

function outgoingEdges(workflow: ComfyCustomWorkflow['workflow']): Map<string, Edge[]> {
  const edges = new Map<string, Edge[]>()
  for (const [to, node] of Object.entries(workflow)) {
    for (const [input, value] of Object.entries(node.inputs)) {
      if (!Array.isArray(value) || typeof value[1] !== 'number') continue
      const from = String(value[0])
      const list = edges.get(from) ?? []
      list.push({ to, input, slot: value[1] })
      edges.set(from, list)
    }
  }
  return edges
}

/**
 * Whether the picture from a `LoadImage` node is only a guide or canvas: some path reaches a
 * ControlNet, mask, preprocessor or sampler latent, and none reaches a reference consumer.
 */
function isGuideOrCanvas(
  workflow: ComfyCustomWorkflow['workflow'],
  edges: Map<string, Edge[]>,
  loadImageId: string,
): boolean {
  const seen = new Set<string>()
  const pending = (edges.get(loadImageId) ?? []).filter((edge) => edge.slot === 0)
  let guide = false
  for (let edge = pending.pop(); edge; edge = pending.pop()) {
    if (edge.input === 'latent_image') {
      guide = true
      continue
    }
    if (seen.has(edge.to)) continue
    seen.add(edge.to)
    const classType = workflow[edge.to]?.class_type ?? ''
    if (REFERENCE.test(classType)) return false
    if (NOT_A_REFERENCE.test(classType)) guide = true
    else if (PASS_THROUGH.test(classType)) pending.push(...(edges.get(edge.to) ?? []))
  }
  return guide
}

/**
 * The `LoadImage` inputs worth pre-selecting for references: every one except those whose picture
 * only reaches a ControlNet, IP-Adapter, preprocessor, mask or an img2img sampler. Only the graph
 * is known here, not the user's intent, so the profile's own selection overrides it.
 */
export function suggestReferenceInputs(workflow: ComfyCustomWorkflow['workflow']): string[] {
  const edges = outgoingEdges(workflow)
  return loadImageInputs(workflow)
    .filter(({ nodeId }) => !isGuideOrCanvas(workflow, edges, nodeId))
    .map(({ path }) => path)
}

/** The inputs references go to: the profile's selection, else the probe's suggestion. */
export const referenceInputsOf = (customWorkflow: ComfyCustomWorkflow): string[] =>
  customWorkflow.referenceInputPaths?.toSorted(byNodeId) ??
  suggestReferenceInputs(customWorkflow.workflow)

/** The profile's custom workflow, when it is in that mode and holds a workflow object. */
function customWorkflowOf(
  providerOptions: Record<string, unknown> | undefined,
): ComfyCustomWorkflow | undefined {
  if (providerOptions?.mode !== ComfyMode.CustomWorkflow) return undefined
  const customWorkflow = providerOptions.customWorkflow as ComfyCustomWorkflow | null | undefined
  return typeof customWorkflow?.workflow === 'object' && customWorkflow.workflow !== null
    ? customWorkflow
    : undefined
}

/** How many references a ComfyUI profile uses: the number of selected `LoadImage` inputs. */
export function comfyReferenceLimit(providerOptions: Record<string, unknown> | undefined): number {
  const customWorkflow = customWorkflowOf(providerOptions)
  return customWorkflow ? referenceInputsOf(customWorkflow).length : 0
}

const KSamplerInfo = z.object({
  KSampler: z.object({
    input: z.object({
      required: z.object({
        sampler_name: z.array(z.unknown()),
        scheduler: z.array(z.unknown()),
      }),
    }),
  }),
})

const ComboConfig = z.object({ options: z.array(z.unknown()) })

const isString = (value: unknown): value is string => typeof value === 'string'

// An input is `[choices]` or, in the newer form, `['COMBO', { options: choices }]`.
function choices(input: unknown[]): string[] {
  const [list, config] = input
  if (Array.isArray(list)) return list.filter(isString)
  if (list === 'COMBO') return ComboConfig.safeParse(config).data?.options.filter(isString) ?? []
  return []
}

type TemplateInputs = NonNullable<ComfyImageOptions['inputs']>

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' ? value : fallback

export function createComfyProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = normalizeBaseUrl(config.baseUrl || DEFAULT_BASE_URL)

  // One per generation, so concurrent generations keep separate poll traces in the debug log.
  const comfyModel = (model: string) =>
    createComfyImage({
      baseURL: baseUrl,
      fetch: createImageSdkFetch('comfyui-image'),
      pollFetch: createPollImageSdkFetch('comfyui-image', POLL_TIMEOUT_MS),
    }).imageModel(model)

  // Binds baseUrl + optional timeout so internal callers don't repeat them.
  const fetchModels = (type: string) => fetchModelList(baseUrl, type, config.timeoutMs)

  return {
    id: 'comfyui',
    name: 'Comfy UI',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { prompt, spec, referenceImages, providerOptions, signal } = options
      // Strip the source-namespace prefix added by listModels() to deduplicate entries
      // (e.g. "checkpoint:model.safetensors" → "model.safetensors"). Handles both
      // prefixed IDs (new) and bare filenames (profiles saved before this change).
      const model = /^(?:checkpoint|unet):/.test(options.model)
        ? options.model.replace(/^(?:checkpoint|unet):/, '')
        : options.model

      const positiveTags = (providerOptions?.positivePrompt as string) || ''
      const negativeTags = (providerOptions?.negativePrompt as string) || ''
      const finalPositivePrompt = positiveTags ? `${prompt}, ${positiveTags}` : prompt

      const explicitMode = providerOptions?.mode as ComfyMode | undefined

      const server = await checkServer(baseUrl, config.timeoutMs)

      // -----------------------------------------------------------------------
      // Custom workflow path — only when mode is explicitly CustomWorkflow.
      // -----------------------------------------------------------------------
      const customWorkflow = customWorkflowOf(providerOptions)
      if (customWorkflow) {
        const comfyui = {
          workflow: customWorkflow.workflow,
          outputNodeId: customWorkflow.outputNodeId,
          paths: {
            positive: customWorkflow.positivePromptPath,
            seed: customWorkflow.seedPath,
            ...(customWorkflow.negativePromptPath && {
              negative: customWorkflow.negativePromptPath,
            }),
            references: referenceInputsOf(customWorkflow),
          },
          negativePrompt: negativeTags,
          referenceFolder: providerOptions?.inputReferences === true ? 'input' : 'temp',
        } satisfies ComfyImageOptions

        // No size: a custom workflow's dimensions are the user's own.
        return generateSdkImage({
          model: comfyModel(model),
          prompt: finalPositivePrompt,
          referenceImages,
          providerOptions: { comfyui },
          signal,
        })
      }
      if (explicitMode === ComfyMode.CustomWorkflow) {
        throw new Error('This ComfyUI profile has no custom workflow loaded.')
      }

      // -----------------------------------------------------------------------
      // Hardcoded workflows (basic / lora / unet).
      // -----------------------------------------------------------------------
      if (!model) {
        throw new Error('No ComfyUI model selected.')
      }

      const loraOptions = providerOptions?.lora as
        { name: string; strengthModel?: number; strengthClip?: number } | undefined

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

      const serverPath = (name: string) => toServerPath(name, server?.os)

      let template: Pick<ComfyImageOptions, 'workflow' | 'inputs' | 'outputNodeId' | 'paths'>

      if (isUnetMode) {
        // Configurable values with AuraFlow-appropriate defaults
        const step = numberOr(providerOptions?.step, 8)
        const cfg = numberOr(providerOptions?.cfg, 1)
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

        template = {
          workflow: UnetTxt2ImgWorkflow,
          inputs: [
            ['1.inputs.unet_name', serverPath(model)],
            ['1.inputs.weight_dtype', weightDtype],
            ['3.inputs.clip_name', serverPath(clipName)],
            ['3.inputs.type', clipType],
            ['4.inputs.vae_name', serverPath(vaeName)],
            ['8.inputs.steps', step],
            ['8.inputs.cfg', cfg],
            ['8.inputs.sampler_name', sampler],
            ['8.inputs.scheduler', scheduler],
            ['7.inputs.batch_size', 1],
          ],
          outputNodeId: '10',
          paths: {
            positive: '5.inputs.text',
            seed: '8.inputs.seed',
            width: '7.inputs.width',
            height: '7.inputs.height',
          },
        }
      } else {
        // Checkpoint-based workflows (basic or lora)
        const step = numberOr(providerOptions?.step, 6)
        const cfg = numberOr(providerOptions?.cfg, 1)
        const sampler = (providerOptions?.sampler as string) ?? 'dpmpp_2m_sde_gpu'
        const scheduler = (providerOptions?.scheduler as string) ?? 'sgm_uniform'

        const inputs: TemplateInputs = [
          ['4.inputs.ckpt_name', serverPath(model)],
          ['3.inputs.steps', step],
          ['3.inputs.cfg', cfg],
          ['3.inputs.sampler_name', sampler],
          ['3.inputs.scheduler', scheduler],
          ['5.inputs.batch_size', 1],
        ]
        if (isLoraMode && loraOptions) {
          inputs.push(
            ['2.inputs.lora_name', serverPath(loraOptions.name)],
            ['2.inputs.strength_model', loraOptions.strengthModel ?? 1],
            ['2.inputs.strength_clip', loraOptions.strengthClip ?? 1],
          )
        }

        template = {
          workflow: isLoraMode ? LoraTxt2ImgWorkflow : BasicTxt2ImgWorkflow,
          inputs,
          outputNodeId: '9',
          paths: {
            positive: '6.inputs.text',
            negative: '7.inputs.text',
            seed: '3.inputs.seed',
            width: '5.inputs.width',
            height: '5.inputs.height',
          },
        }
      }

      const comfyui = { ...template, negativePrompt: negativeTags } satisfies ComfyImageOptions

      return generateSdkImage({
        model: comfyModel(model),
        prompt: finalPositivePrompt,
        size: formatImageSize(specToPixels(spec)),
        providerOptions: { comfyui },
        signal,
      })
    },

    async listModels(): Promise<ImageModelInfo[]> {
      const [checkpoints, diffusionModels, textEncoders, vaeModels] = await Promise.all([
        fetchModels('checkpoints'),
        fetchModels('diffusion_models').catch(() => []),
        fetchModels('text_encoders').catch(() => []),
        fetchModels('vae').catch(() => []),
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
          costPerImage: 0,
        })

      return [
        ...checkpoints.map(toInfo('checkpoint', 'Checkpoint')),
        ...diffusionModels.map(toInfo('unet', 'Diffusion Model')),
      ]
    },

    async listLoras(): Promise<string[]> {
      try {
        return await fetchModels('loras')
      } catch {
        return []
      }
    },

    async getSamplerInfo(): Promise<ComfySamplerInfo> {
      const response = await imageGetFetch(`${baseUrl}/object_info/KSampler`, undefined, {
        serviceId: 'comfy-samplers',
        timeoutMs: config.timeoutMs,
      })
      const { sampler_name, scheduler } = KSamplerInfo.parse(await response.json()).KSampler.input
        .required
      return { samplers: choices(sampler_name), schedulers: choices(scheduler) }
    },
  }
}
