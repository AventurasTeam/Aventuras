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
import { endpoint } from '#lib/utils/url.ts'
import { HttpStatusError } from '#lib/utils/error.ts'
import { resolveBaseUrl } from './baseUrls'
import { imageConnectionFor, modelListKey } from './connection'
import { isNewerVersion } from '#lib/utils/version.ts'
import { imageGetFetch } from './fetchAdapter'
import { bearerHeaders, withBearerKey } from './discoveryFetch'
import { parseModelList } from './parseModelList'
import {
  MIN_COMFYUI_VERSION,
  createComfyImage,
  type ComfyImageOptions,
  type Json,
} from './comfyImage'
import { createImageSdkFetch, createPollImageSdkFetch, generateSdkImage } from './sdkImage'

// A server that does not answer is not worth the generation's own timeout.
const PROBE_TIMEOUT_MS = 5_000
const POLL_TIMEOUT_MS = 15_000

export enum ComfyMode {
  CustomWorkflow = 'custom-workflow',
  BasicTxt2Img = 'basic-txt2img',
  LoraTxt2Img = 'lora-txt2img',
  UnetTxt2Img = 'unet-txt2img',
}

// The first text encoder and VAE the server lists, for a UNet profile that names none. Keyed by
// `modelListKey`, like the model lists and capabilities, so a connection's entries drop together.
const autoClipCache = new Map<string, string>()
const autoVaeCache = new Map<string, string>()

const SystemStats = z.object({
  system: z.object({
    os: z.string().optional().catch(undefined),
    comfyui_version: z.string().optional().catch(undefined),
  }),
})

type ServerSystem = z.infer<typeof SystemStats>['system']

// Per connection, as a Promise so parallel generations share one request. A server that could not
// be asked is not cached, and its own error comes from the generation request.
const serverSystems = new Map<string, Promise<ServerSystem | undefined>>()

export async function fetchModelList(
  baseUrl: string | undefined,
  apiKey: string,
  type: string,
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<string[]> {
  // Tauri HTTP, not the WebView's fetch (docs/architecture/overview.md, "Local image servers").
  const resp = await imageGetFetch(
    endpoint(resolveBaseUrl('comfyui', baseUrl), `models/${type}`),
    bearerHeaders(apiKey),
    {
      serviceId: 'comfy-models',
      timeoutMs,
      signal,
    },
  )
  return parseModelList(await resp.json(), z.string(), `ComfyUI /models/${type}`)
}

/** Drops what is cached for a `modelListKey`. */
export function clearComfyCache(listKey: string): void {
  autoClipCache.delete(listKey)
  autoVaeCache.delete(listKey)
  serverSystems.delete(listKey)
}

async function readServerSystem(
  baseUrl: string,
  apiKey: string,
  timeoutMs?: number,
): Promise<ServerSystem | undefined> {
  try {
    const response = await imageGetFetch(endpoint(baseUrl, 'system_stats'), bearerHeaders(apiKey), {
      serviceId: 'comfy-system',
      timeoutMs: Math.min(timeoutMs ?? PROBE_TIMEOUT_MS, PROBE_TIMEOUT_MS),
    })
    return SystemStats.parse(await response.json()).system
  } catch {
    return undefined
  }
}

/** Throws for a server below the supported version; returns what it reports about itself. */
async function checkServer(
  listKey: string,
  baseUrl: string,
  apiKey: string,
  timeoutMs?: number,
): Promise<ServerSystem | undefined> {
  let pending = serverSystems.get(listKey)
  if (!pending) {
    pending = readServerSystem(baseUrl, apiKey, timeoutMs)
    serverSystems.set(listKey, pending)
  }
  const system = await pending
  if (!system) {
    serverSystems.delete(listKey)
    return undefined
  }
  const version = system.comfyui_version
  if (version && isNewerVersion(MIN_COMFYUI_VERSION, version)) {
    serverSystems.delete(listKey)
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

type Workflow = ComfyCustomWorkflow['workflow']
type WorkflowNode = Workflow[string]

/** A `[nodeId, slot]` input: the node it comes from and which of its outputs. */
const parseLink = (value: Json | undefined): { from: string; slot: number } | undefined =>
  Array.isArray(value) && typeof value[1] === 'number'
    ? { from: String(value[0]), slot: value[1] }
    : undefined

const linkTarget = (value: Json | undefined): string | undefined => parseLink(value)?.from

const inputPath = (nodeId: string, name: string) => `${nodeId}.inputs.${name}`

const nodeTitle = (node: WorkflowNode) => node._meta?.title ?? node.class_type

const nodeIdCollator = new Intl.Collator(undefined, { numeric: true })
const byNodeId = nodeIdCollator.compare

const preferredFirst = <T>(items: T[], isPreferred: (item: T) => boolean): T[] => [
  ...items.filter(isPreferred),
  ...items.filter((item) => !isPreferred(item)),
]

// A sampler takes a latent and either conditioning or a guider; matching the shape finds custom
// samplers too.
const isSampler = (node: WorkflowNode) =>
  linkTarget(node.inputs.latent_image) !== undefined &&
  (linkTarget(node.inputs.positive) !== undefined || linkTarget(node.inputs.guider) !== undefined)

// Never a prompt: a zeroed-out conditioning has no text of its own, and a loader's inputs are
// file names.
const NOT_A_PROMPT_NODE = /ConditioningZeroOut|Loader/

// `system_prompt` is a fixed choice on `CLIPTextEncodeLumina2`, next to its `user_prompt`.
const isTextInputName = (name: string) =>
  name !== 'system_prompt' && /text|prompt|^clip_[lg]$|t5xxl|llama|qwen/.test(name)

const SEED_INPUT_NAMES = ['seed', 'noise_seed']

const numberInput = (node: WorkflowNode, names: readonly string[]) =>
  names.find((name) => typeof node.inputs[name] === 'number')

interface WalkOptions {
  /** A node it rejects is skipped, and so is what only it leads to. */
  prune?: (node: WorkflowNode) => boolean
  /** The inputs to follow from a node; all of them by default. */
  follow?: (node: WorkflowNode) => Json[]
}

/** Breadth-first from `startId` against the links. */
function* upstream(
  workflow: Workflow,
  startId: string,
  { prune, follow = (node) => Object.values(node.inputs) }: WalkOptions = {},
): Generator<[string, WorkflowNode]> {
  const seen = new Set<string>()
  const queue = [startId]
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (seen.has(id)) continue
    seen.add(id)
    const node = workflow[id]
    if (!node || prune?.(node)) continue
    yield [id, node]
    for (const input of follow(node)) {
      const target = linkTarget(input)
      if (target !== undefined) queue.push(target)
    }
  }
}

function firstUpstream(
  workflow: Workflow,
  startId: string,
  matches: (node: WorkflowNode) => boolean,
): [string, WorkflowNode] | undefined {
  for (const entry of upstream(workflow, startId)) {
    if (matches(entry[1])) return entry
  }
  return undefined
}

// The number a seed link stands for: a seed-named input or a primitive's `value`, else the only
// number the source has. Anything looser would pick an arbitrary widget.
function sourceSeedInput(node: WorkflowNode): string | undefined {
  const named = numberInput(node, [...SEED_INPUT_NAMES, 'value'])
  if (named) return named
  const numbers = Object.entries(node.inputs).filter(([, value]) => typeof value === 'number')
  return numbers.length === 1 ? numbers[0][0] : undefined
}

/** The seed input of node `id`, or of the node its seed input is linked from. */
function seedPathOf(workflow: Workflow, id: string): string | undefined {
  const node = workflow[id]
  if (!node) return undefined
  const name = numberInput(node, SEED_INPUT_NAMES)
  if (name) return inputPath(id, name)
  for (const input of SEED_INPUT_NAMES) {
    const sourceId = linkTarget(node.inputs[input])
    const source = sourceId ? workflow[sourceId] : undefined
    const sourceName = source && sourceSeedInput(source)
    if (sourceId && sourceName) return inputPath(sourceId, sourceName)
  }
  return undefined
}

function detectSeedPath(workflow: Workflow, samplerId: string | undefined, rootId: string | null) {
  const sampler = samplerId ? workflow[samplerId] : undefined
  // `SamplerCustomAdvanced` takes its seed from the noise node it links.
  const noiseId = linkTarget(sampler?.inputs.noise)
  for (const id of [samplerId, noiseId]) {
    const path = id && seedPathOf(workflow, id)
    if (path) return path
  }
  if (!rootId) return null
  for (const [id] of upstream(workflow, rootId)) {
    const path = seedPathOf(workflow, id)
    if (path) return path
  }
  return null
}

// A string primitive's own input is `value` or `string`; any other string widget on a node (a
// delimiter, a model name) is not the text a link carries.
const isLinkedTextInputName = (name: string) =>
  isTextInputName(name) || name === 'value' || name === 'string'

/**
 * The text inputs of one node that take a prompt. An input linked from another node (a string
 * primitive, a wildcard node) is followed to the text input of its source, unless the source is
 * a loader.
 */
function textInputPaths(workflow: Workflow, nodeId: string): string[] {
  const paths = new Set<string>()
  for (const [name, value] of Object.entries(workflow[nodeId].inputs)) {
    if (!isTextInputName(name)) continue
    if (typeof value === 'string') {
      paths.add(inputPath(nodeId, name))
      continue
    }
    const sourceId = linkTarget(value)
    const source = sourceId ? workflow[sourceId] : undefined
    if (!sourceId || !source || NOT_A_PROMPT_NODE.test(source.class_type)) continue
    const sourceName = Object.entries(source.inputs).find(
      ([inputName, v]) => typeof v === 'string' && isLinkedTextInputName(inputName),
    )?.[0]
    if (sourceName) paths.add(inputPath(sourceId, sourceName))
  }
  return [...paths]
}

/** The `text` input of the first `CLIPTextEncode` whose title says it is `role`, if unlinked. */
function titledEncoderPath(workflow: Workflow, role: RegExp): string | undefined {
  const id = Object.keys(workflow)
    .toSorted(byNodeId)
    .find((nodeId) => {
      const node = workflow[nodeId]
      return (
        node.class_type === 'CLIPTextEncode' &&
        typeof node.inputs.text === 'string' &&
        role.test(nodeTitle(node))
      )
    })
  return id === undefined ? undefined : inputPath(id, 'text')
}

/**
 * The text inputs of the nearest encoder upstream of `startId`. A node that takes both a
 * positive and a negative conditioning (ControlNet, inpaint) is followed through its own slot.
 */
function nearestTextInputs(
  workflow: Workflow,
  startId: string | undefined,
  slot: 'positive' | 'negative',
): string[] {
  if (!startId) return []
  const follow = (node: WorkflowNode) =>
    linkTarget(node.inputs[slot]) === undefined ? Object.values(node.inputs) : [node.inputs[slot]]
  for (const [id] of upstream(workflow, startId, {
    prune: (node) => NOT_A_PROMPT_NODE.test(node.class_type),
    follow,
  })) {
    const paths = textInputPaths(workflow, id)
    if (paths.length > 0) return paths
  }
  return []
}

/**
 * Suggests where a workflow's prompt, negative, seed and output go; what the graph does not
 * settle comes back unset. How it reads the graph: docs/architecture/overview.md.
 */
export function detectWorkflowFields(
  workflow: Workflow,
): Pick<
  ComfyCustomWorkflow,
  'positivePromptPaths' | 'negativePromptPaths' | 'seedPath' | 'outputNodeId'
> {
  const saveImages = Object.keys(workflow).filter((id) => workflow[id].class_type === 'SaveImage')
  const outputNodeId = saveImages.length === 1 ? saveImages[0] : null

  const sampler = outputNodeId
    ? firstUpstream(workflow, outputNodeId, isSampler)
    : Object.entries(workflow).find(([, node]) => isSampler(node))
  const [samplerId, samplerNode] = sampler ?? ([undefined, undefined] as const)

  const guider = linkTarget(samplerNode?.inputs.guider)
  const guiderInputs = guider ? workflow[guider]?.inputs : undefined
  const conditioning = (slot: 'positive' | 'negative') =>
    linkTarget(samplerNode?.inputs[slot]) ??
    linkTarget(guiderInputs?.[slot]) ??
    (slot === 'positive' ? linkTarget(guiderInputs?.conditioning) : undefined)

  // With no sampler to follow, an encoder titled for its role is all there is.
  const promptPaths = (slot: 'positive' | 'negative', title: RegExp) => {
    if (samplerId !== undefined) return nearestTextInputs(workflow, conditioning(slot), slot)
    const path = titledEncoderPath(workflow, title)
    return path ? [path] : []
  }
  const positivePromptPaths = promptPaths('positive', /positive/i)
  // A negative that leads back to the positive encoder is no negative.
  const negativePromptPaths = promptPaths('negative', /negative/i).filter(
    (path) => !positivePromptPaths.includes(path),
  )

  return {
    positivePromptPaths,
    negativePromptPaths,
    seedPath: detectSeedPath(workflow, samplerId, outputNodeId),
    outputNodeId,
  }
}

export interface WorkflowInput {
  nodeId: string
  title: string
  name: string
  /** Dot-path, e.g. `57:27.inputs.text`. */
  path: string
  /** Null for an input another node feeds. */
  value: string | number | null
}

/**
 * Every string, number or linked input of a workflow, in node-id order. It depends on the graph
 * alone, so a picker computes it once per workflow and narrows it with `pickInputs`.
 */
export function workflowInputs(workflow: Workflow): WorkflowInput[] {
  return Object.keys(workflow)
    .toSorted(byNodeId)
    .flatMap((nodeId) =>
      Object.entries(workflow[nodeId].inputs).flatMap(([name, value]) =>
        typeof value === 'string' || typeof value === 'number' || linkTarget(value) !== undefined
          ? [
              {
                nodeId,
                title: nodeTitle(workflow[nodeId]),
                name,
                path: inputPath(nodeId, name),
                value: typeof value === 'string' || typeof value === 'number' ? value : null,
              },
            ]
          : [],
      ),
    )
}

/**
 * The unlinked string or number inputs for a picker, and any `selected` path whose input is
 * linked, so a stored choice never goes missing from its picker. The ones likely to be wanted
 * (text inputs, seed inputs) come first.
 */
export function pickInputs(
  inputs: WorkflowInput[],
  kind: 'string' | 'number',
  selected: readonly string[] = [],
): WorkflowInput[] {
  const wanted =
    kind === 'string' ? isTextInputName : (name: string) => SEED_INPUT_NAMES.includes(name)
  return preferredFirst(
    inputs.filter(
      (input) =>
        typeof input.value === kind || (input.value === null && selected.includes(input.path)),
    ),
    (input) => wanted(input.name),
  )
}

/** Every node of a workflow for the output picker, in node-id order, saving nodes first. */
export function listNodes(workflow: Workflow) {
  const nodes = Object.keys(workflow)
    .toSorted(byNodeId)
    .map((nodeId) => ({
      nodeId,
      title: nodeTitle(workflow[nodeId]),
      classType: workflow[nodeId].class_type,
    }))
  return preferredFirst(nodes, (node) => /Save|Preview/.test(node.classType))
}

/** Whether `path` names an input the workflow has. `setGraphInput` would create one it lacks. */
export function validateWorkflowPath(workflow: Workflow, path: string): boolean {
  const [nodeId, inputs, name, ...rest] = path.split('.')
  return (
    rest.length === 0 &&
    inputs === 'inputs' &&
    name !== undefined &&
    Object.hasOwn(workflow, nodeId) &&
    Object.hasOwn(workflow[nodeId].inputs, name)
  )
}

/** What stops a custom workflow from generating, as sentences for the user; empty when complete. */
export function workflowProblems(customWorkflow: ComfyCustomWorkflow): string[] {
  const { workflow, positivePromptPaths, negativePromptPaths, seedPath, outputNodeId } =
    customWorkflow
  const problems: string[] = []
  if (positivePromptPaths.length === 0) problems.push('Choose a prompt input.')
  const paths = [...positivePromptPaths, ...negativePromptPaths, ...(seedPath ? [seedPath] : [])]
  if (!paths.every((path) => validateWorkflowPath(workflow, path))) {
    problems.push('A selected input is not in this workflow.')
  }
  if (outputNodeId === null) problems.push('Choose an output node.')
  else if (!Object.hasOwn(workflow, outputNodeId)) {
    problems.push('The output node is not in this workflow.')
  }
  return problems
}

/** Whether a custom workflow has what generation needs: a prompt input and an output node. */
export const isWorkflowComplete = (
  customWorkflow: ComfyCustomWorkflow,
): customWorkflow is ComfyCustomWorkflow & { outputNodeId: string } =>
  workflowProblems(customWorkflow).length === 0

const imageInput = (nodeId: string) => inputPath(nodeId, 'image')

/** The `image` input of every `LoadImage` node, in node-id order. */
export function loadImageInputs(workflow: Workflow) {
  return Object.entries(workflow)
    .filter(([, node]) => node.class_type === 'LoadImage')
    .toSorted(([a], [b]) => byNodeId(a, b))
    .map(([nodeId, node]) => ({
      nodeId,
      path: imageInput(nodeId),
      title: nodeTitle(node),
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

function outgoingEdges(workflow: Workflow): Map<string, Edge[]> {
  const edges = new Map<string, Edge[]>()
  for (const [to, node] of Object.entries(workflow)) {
    for (const [input, value] of Object.entries(node.inputs)) {
      const link = parseLink(value)
      if (!link) continue
      const list = edges.get(link.from) ?? []
      list.push({ to, input, slot: link.slot })
      edges.set(link.from, list)
    }
  }
  return edges
}

/**
 * Whether the picture from a `LoadImage` node is only a guide or canvas: some path reaches a
 * ControlNet, mask, preprocessor or sampler latent, and none reaches a reference consumer.
 */
function isGuideOrCanvas(
  workflow: Workflow,
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
export function suggestReferenceInputs(workflow: Workflow): string[] {
  const edges = outgoingEdges(workflow)
  return loadImageInputs(workflow)
    .filter(({ nodeId }) => !isGuideOrCanvas(workflow, edges, nodeId))
    .map(({ path }) => path)
}

/** The inputs references go to: the profile's selection, else the probe's suggestion. */
export const referenceInputsOf = (
  customWorkflow: Pick<ComfyCustomWorkflow, 'workflow' | 'referenceInputPaths'>,
): string[] =>
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

/** A custom workflow names its own checkpoints, so only the built-in workflows read the model. */
export const comfyNeedsModel = (providerOptions: Record<string, unknown> | undefined): boolean =>
  providerOptions?.mode !== ComfyMode.CustomWorkflow

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

const CLIPLoaderInfo = z.object({
  CLIPLoader: z.object({
    input: z.object({
      required: z.object({ type: z.array(z.unknown()) }),
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

export const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' ? value : fallback

export function createComfyProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = resolveBaseUrl('comfyui', config.baseUrl)
  const listKey = modelListKey(imageConnectionFor('comfyui', config.apiKey, config.baseUrl))

  // One per generation, so concurrent generations keep separate poll traces in the debug log.
  const comfyModel = (model: string) =>
    createComfyImage({
      baseURL: baseUrl,
      fetch: withBearerKey(createImageSdkFetch('comfyui-image'), config.apiKey),
      pollFetch: withBearerKey(
        createPollImageSdkFetch('comfyui-image', POLL_TIMEOUT_MS),
        config.apiKey,
      ),
    }).imageModel(model)

  // Binds baseUrl + optional timeout so internal callers don't repeat them.
  const fetchModels = (type: string, signal?: AbortSignal) =>
    fetchModelList(baseUrl, config.apiKey, type, config.timeoutMs, signal)

  async function readObjectInfo<T extends z.ZodType>(
    node: string,
    schema: T,
    serviceId: string,
    signal?: AbortSignal,
  ): Promise<z.output<T>> {
    const response = await imageGetFetch(
      endpoint(baseUrl, `object_info/${node}`),
      bearerHeaders(config.apiKey),
      {
        serviceId,
        timeoutMs: config.timeoutMs,
        signal,
      },
    )
    const info = schema.safeParse(await response.json())
    if (!info.success) {
      throw new Error(
        `ComfyUI sent an unreadable /object_info/${node} reply\n${z.prettifyError(info.error)}`,
      )
    }
    return info.data
  }

  return {
    id: 'comfyui',
    name: 'Comfy UI',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { prompt, spec, referenceImages, providerOptions, signal } = options
      // Strip the source-namespace prefix added by listModels() to deduplicate entries
      // (e.g. "checkpoint:model.safetensors" → "model.safetensors"). Handles both
      // prefixed IDs (new) and bare filenames (profiles saved before this change).
      const prefixed = /^(checkpoint|unet):/.exec(options.model)
      const model = prefixed ? options.model.slice(prefixed[0].length) : options.model

      const positiveTags = (providerOptions?.positivePrompt as string) || ''
      const negativeTags = (providerOptions?.negativePrompt as string) || ''
      const finalPositivePrompt = positiveTags ? `${prompt}, ${positiveTags}` : prompt

      const explicitMode = providerOptions?.mode as ComfyMode | undefined

      const server = await checkServer(listKey, baseUrl, config.apiKey, config.timeoutMs)

      // -----------------------------------------------------------------------
      // Custom workflow path — only when mode is explicitly CustomWorkflow.
      // -----------------------------------------------------------------------
      const customWorkflow = customWorkflowOf(providerOptions)
      if (customWorkflow) {
        if (!isWorkflowComplete(customWorkflow)) {
          throw new Error('This ComfyUI profile has no complete custom workflow.')
        }
        const comfyui = {
          workflow: customWorkflow.workflow,
          outputNodeId: customWorkflow.outputNodeId,
          paths: {
            positive: customWorkflow.positivePromptPaths,
            ...(customWorkflow.seedPath && { seed: customWorkflow.seedPath }),
            ...(customWorkflow.negativePromptPaths.length > 0 && {
              negative: customWorkflow.negativePromptPaths,
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

      // An explicit mode wins; without one, the LoRA option and then the id's source prefix decide.
      const isLoraMode = explicitMode === ComfyMode.LoraTxt2Img || (!explicitMode && !!loraOptions)
      const isUnetMode =
        explicitMode === ComfyMode.UnetTxt2Img ||
        (!explicitMode && !isLoraMode && prefixed?.[1] === 'unet')

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

        let clipName = (providerOptions?.clipName as string) || autoClipCache.get(listKey) || ''
        let vaeName = (providerOptions?.vaeName as string) || autoVaeCache.get(listKey) || ''
        const [clips, vaes] = await Promise.all([
          clipName ? [] : fetchModels('text_encoders', signal),
          vaeName ? [] : fetchModels('vae', signal),
        ])
        if (!clipName) {
          clipName = clips[0] || ''
          if (clipName) autoClipCache.set(listKey, clipName)
        }
        if (!vaeName) {
          vaeName = vaes[0] || ''
          if (vaeName) autoVaeCache.set(listKey, vaeName)
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
            positive: ['5.inputs.text'],
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
            positive: ['6.inputs.text'],
            negative: ['7.inputs.text'],
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

    async listModels(signal?: AbortSignal): Promise<ImageModelInfo[]> {
      const [checkpoints, diffusionModels] = await Promise.all([
        fetchModels('checkpoints', signal),
        // A server older than the folder answers 404; any other failure is the picker's to report.
        fetchModels('diffusion_models', signal).catch((error: unknown) => {
          if (error instanceof HttpStatusError && error.status === 404) return []
          throw error
        }),
      ])

      const toInfo =
        (prefix: string, description: string) =>
        (m: string): ImageModelInfo => ({
          id: `${prefix}:${m}`,
          name: m,
          description,
        })

      return [
        ...checkpoints.map(toInfo('checkpoint', 'Checkpoint')),
        ...diffusionModels.map(toInfo('unet', 'Diffusion Model')),
      ]
    },

    async listLoras(signal?: AbortSignal): Promise<string[]> {
      return fetchModels('loras', signal)
    },

    async getSamplerInfo(signal?: AbortSignal): Promise<ComfySamplerInfo> {
      const info = await readObjectInfo('KSampler', KSamplerInfo, 'comfy-samplers', signal)
      const { sampler_name, scheduler } = info.KSampler.input.required
      return { samplers: choices(sampler_name), schedulers: choices(scheduler) }
    },

    async listClipTypes(signal?: AbortSignal): Promise<string[]> {
      const info = await readObjectInfo('CLIPLoader', CLIPLoaderInfo, 'comfy-clip-types', signal)
      return choices(info.CLIPLoader.input.required.type)
    },
  }
}
