// ComfyUI's HTTP API as an AI SDK image model: queue a prepared API-format graph, poll its job
// (`/api/jobs/{id}`, ComfyUI 0.26+), download the output. Core ComfyUI pushes progress only over
// `/ws`, so a poll is the only plain-HTTP way to learn a job finished.

import * as z from 'zod'
import { APICallError, InvalidResponseDataError } from 'ai'
import type { ImageModelV4 } from '@ai-sdk/provider'
import type { Fetch } from '#lib/services/ai/sdk/providers/index.ts'
import { abortable, sleep } from '#lib/utils/async.ts'
import { errMessage } from '#lib/utils/error.ts'
import { sha256Hex } from '#lib/utils/hash.ts'
import { parseImageSize } from '#lib/utils/image.ts'
import {
  definedHeaders,
  fileBytes,
  httpError,
  inlineFile,
  parseJson,
  type ReferenceFile,
  responseExcerpt,
  unsupportedInputWarnings,
} from './imageModelUtils'

const Json = z.json()
export type Json = z.infer<typeof Json>

/** A node graph addressed by dot-paths, whose keys are node ids and input names. */
type Graph = Record<string, Json>

interface ComfyImageSettings {
  baseURL: string
  fetch: Fetch
  /** For polls and cancels, whose requests share one debug entry. */
  pollFetch: Fetch
}

// The jobs API polling and its atomic cancel arrived in 0.26.0.
export const MIN_COMFYUI_VERSION = '0.26.0'

const POLL_INTERVAL_MS = 1000
// Status checks that fail back to back before the generation does.
const MAX_POLL_FAILURES = 10
// A cancel that overtakes its own `POST /prompt` finds no job yet; the waits add up to 15.5 s.
const CANCEL_RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000]

type CancelPolicy = 'once' | 'until-found' | 'never'

const Options = z.object({
  workflow: z.record(z.string(), Json),
  outputNodeId: z.string(),
  paths: z.object({
    positive: z.string(),
    seed: z.string(),
    negative: z.string().optional(),
    width: z.string().optional(),
    height: z.string().optional(),
    /** `LoadImage` image inputs, filled in order with the uploaded reference images. */
    references: z.array(z.string()).optional(),
  }),
  /** Dot-path / value pairs written into the workflow before the prompt, seed and size. */
  inputs: z.array(z.tuple([z.string(), Json])).optional(),
  negativePrompt: z.string().optional(),
  /** Where references are uploaded; `temp` is emptied when ComfyUI restarts. */
  referenceFolder: z.enum(['input', 'temp']).default('temp'),
})

type ReferenceFolder = z.infer<typeof Options>['referenceFolder']

export type ComfyImageOptions = z.input<typeof Options>

const NodeErrors = z.record(
  z.string(),
  z.object({
    class_type: z.string().optional().catch(undefined),
    errors: z
      .array(z.object({ message: z.string() }))
      .optional()
      .catch(undefined),
    message: z.string().optional().catch(undefined),
    dependent_outputs: z.array(z.string()).optional().catch(undefined),
  }),
)

type NodeErrorEntry = [node: string, error: z.infer<typeof NodeErrors>[string]]

const QueuedPrompt = z.object({
  prompt_id: z.string(),
  node_errors: NodeErrors.optional().catch(undefined),
})

const PromptErrorBody = z.object({
  error: z
    .object({ message: z.string().optional().catch(undefined) })
    .optional()
    .catch(undefined),
  node_errors: NodeErrors.optional().catch(undefined),
})

const ImageInfo = z.object({
  filename: z.string(),
  subfolder: z.string().optional(),
  type: z.string().optional(),
})

const UPLOAD_SUBFOLDER = 'aventuras'

const UploadedImage = z.object({
  name: z.string(),
  subfolder: z.string().catch(UPLOAD_SUBFOLDER),
})

const fileExtension = (mediaType: string): string => /^image\/(\w+)/.exec(mediaType)?.[1] ?? 'png'

// A model is created per generation, so concurrent generations share their pending uploads here.
const uploadsInFlight = new Map<string, { upload: Promise<string>; signal?: AbortSignal }>()

const ExecutionError = z.object({
  node_id: z.string().optional().catch(undefined),
  node_type: z.string().optional().catch(undefined),
  exception_message: z.string().optional().catch(undefined),
})

const Job = z.object({
  status: z.string(),
  outputs: z
    .record(
      z.string(),
      z.object({ images: z.array(ImageInfo).optional().catch(undefined) }).catch({}),
    )
    .optional()
    .catch(undefined),
  execution_error: ExecutionError.optional().catch(undefined),
})

type Job = z.infer<typeof Job>

const FINISHED_STATUSES = new Set(['completed', 'failed', 'cancelled'])

const Cancelled = z.object({ cancelled: z.boolean() })

// Other 4xx are the server or a proxy refusing the check, which no retry changes.
const RETRYABLE_CLIENT_STATUSES = new Set([408, 429])

class JobGoneError extends Error {
  constructor(firstPoll: boolean) {
    super(
      firstPoll
        ? `ComfyUI has no status endpoint for this job; the server may be older than ${MIN_COMFYUI_VERSION}, the oldest version Aventuras supports`
        : 'ComfyUI no longer has this job (server restarted or queue cleared)',
    )
  }
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const isGraph = (value: unknown): value is Graph =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function assign(node: Graph, keys: string[], value: Json): Graph {
  const [key, ...rest] = keys
  if (rest.length === 0) return { ...node, [key]: value }
  const next = Object.hasOwn(node, key) ? node[key] : undefined
  return { ...node, [key]: assign(isGraph(next) ? next : {}, rest, value) }
}

/**
 * Returns `graph` with `value` at a dot-path such as `57:27.inputs.text`, creating missing levels.
 * Only the objects along the path are copied.
 */
export function setGraphInput(graph: Graph, path: string, value: Json): Graph {
  const keys = path.split('.')
  if (keys.some((key) => FORBIDDEN_KEYS.has(key))) {
    throw new Error(`Invalid workflow path: ${path}`)
  }
  return assign(graph, keys, value)
}

function randomSeed(): number {
  return Number(crypto.getRandomValues(new BigUint64Array(1))[0] % BigInt(Number.MAX_SAFE_INTEGER))
}

const nodeRef = (id: string, classType?: string) => (classType ? `${id} (${classType})` : id)

function describeNodeErrors(entries: NodeErrorEntry[]): string {
  return entries
    .map(([node, error]) => {
      const messages = error.errors?.map((e) => e.message).join(', ') || error.message || 'invalid'
      return `Node ${nodeRef(node, error.class_type)}: ${messages}`
    })
    .join('; ')
}

function describeFailure(parsed: unknown, text: string, status: number): string {
  const body = PromptErrorBody.safeParse(parsed)
  if (body.success) {
    const nodeErrors = Object.entries(body.data.node_errors ?? {})
    if (nodeErrors.length > 0) {
      return `ComfyUI Validation Error: ${describeNodeErrors(nodeErrors)}`
    }
    if (body.data.error?.message) return `ComfyUI Error: ${body.data.error.message}`
  }
  return `ComfyUI Error: ${responseExcerpt(text, status)}`
}

function executionFailure(error: Job['execution_error']): Error {
  const where = error?.node_id
    ? `Node ${nodeRef(error.node_id, error.node_type)}`
    : error?.node_type
  const detail = [where, error?.exception_message?.trim()].filter(Boolean).join(': ')
  return new Error(`ComfyUI Error: ${detail || 'execution failed'}`)
}

const GraphNode = z.object({ class_type: z.string() })

function missingOutputFailure(graph: Graph, outputNodeId: string, job: Job): Error {
  const classType = GraphNode.safeParse(graph[outputNodeId]).data?.class_type
  const others = Object.entries(job.outputs ?? {})
    .filter(([node, output]) => node !== outputNodeId && output.images?.length)
    .map(([node]) => node)
  const found = others.length > 0 ? `; images came from node ${others.join(', ')}` : ''
  return new Error(
    `ComfyUI Error: output node ${nodeRef(outputNodeId, classType)} produced no image${found}`,
  )
}

export function createComfyImage(settings: ComfyImageSettings) {
  const baseURL = settings.baseURL.replace(/\/+$/, '')
  const jobUrl = (id: string) => `${baseURL}/api/jobs/${encodeURIComponent(id)}`

  async function failure(response: Response, url: string, body?: unknown) {
    const text = await response.text()
    return httpError({
      response,
      text,
      url,
      message: describeFailure(parseJson(text), text, response.status),
      requestBodyValues: body,
    })
  }

  async function postReference(
    form: FormData,
    folder: ReferenceFolder,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<string> {
    const url = `${baseURL}/upload/image`
    const response = await settings.fetch(url, { method: 'POST', headers, body: form, signal })
    const text = await response.text()
    if (!response.ok) {
      throw httpError({
        response,
        text,
        url,
        message: `ComfyUI Error: reference upload failed: ${responseExcerpt(text, response.status)}`,
      })
    }
    const uploaded = UploadedImage.safeParse(parseJson(text))
    if (!uploaded.success) {
      throw new InvalidResponseDataError({
        data: text.slice(0, 200),
        message: `ComfyUI returned an unreadable upload response: ${responseExcerpt(text, response.status)}`,
      })
    }
    const { name, subfolder } = uploaded.data
    const path = subfolder ? `${subfolder}/${name}` : name
    return folder === 'temp' ? `${path} [temp]` : path
  }

  /** Puts a reference in the server's upload folder; returns the name a `LoadImage` node takes. */
  async function uploadReference(
    file: ReferenceFile,
    folder: ReferenceFolder,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<string> {
    const inline = inlineFile(file, 'ComfyUI')
    const bytes = fileBytes(inline)
    // Names come from the bytes, so ComfyUI stores an identical upload once.
    const fileName = `aventuras-${(await sha256Hex(bytes)).slice(0, 16)}.${fileExtension(inline.mediaType)}`
    const key = `${baseURL}|${folder}|${fileName}`

    // An upload whose owner aborted says nothing about this caller's, so it is redone.
    for (let shared = uploadsInFlight.get(key); shared; shared = uploadsInFlight.get(key)) {
      try {
        return await abortable(shared.upload, signal)
      } catch (error) {
        if (signal?.aborted || !shared.signal?.aborted) throw error
      }
    }

    const form = new FormData()
    form.append('image', new Blob([bytes], { type: inline.mediaType }), fileName)
    form.append('type', folder)
    form.append('subfolder', UPLOAD_SUBFOLDER)

    const upload = postReference(form, folder, headers, signal).finally(() =>
      uploadsInFlight.delete(key),
    )
    uploadsInFlight.set(key, { upload, signal })
    return upload
  }

  async function readJob(id: string, firstPoll: boolean, signal?: AbortSignal): Promise<Job> {
    const url = jobUrl(id)
    const response = await settings.pollFetch(url, { signal })
    if (response.status === 404) {
      await response.body?.cancel()
      throw new JobGoneError(firstPoll)
    }
    if (!response.ok) throw await failure(response, url)
    const text = await response.text()
    const job = Job.safeParse(parseJson(text))
    if (!job.success) {
      throw new InvalidResponseDataError({
        data: text.slice(0, 200),
        message: `ComfyUI returned an unreadable job status: ${responseExcerpt(text, response.status)}`,
      })
    }
    return job.data
  }

  async function waitForJob(id: string, signal?: AbortSignal): Promise<Job> {
    let failures = 0
    for (let poll = 0; ; poll++) {
      try {
        const job = await readJob(id, poll === 0, signal)
        failures = 0
        if (FINISHED_STATUSES.has(job.status)) return job
      } catch (error) {
        if (signal?.aborted || error instanceof JobGoneError) throw error
        if (InvalidResponseDataError.isInstance(error)) throw error
        if (
          APICallError.isInstance(error) &&
          error.statusCode !== undefined &&
          error.statusCode >= 400 &&
          error.statusCode < 500 &&
          !RETRYABLE_CLIENT_STATUSES.has(error.statusCode)
        ) {
          throw error
        }
        // A plain Error here and for /view: the 429 middleware would otherwise queue the job again.
        if (++failures >= MAX_POLL_FAILURES) {
          throw new Error(`ComfyUI stopped answering status checks: ${errMessage(error)}`, {
            cause: error,
          })
        }
      }
      await sleep(POLL_INTERVAL_MS, signal)
    }
  }

  // The caller's signal may have fired already, and a guard built on it would abort at once.
  async function cancelJob(id: string): Promise<boolean> {
    try {
      const response = await settings.pollFetch(`${jobUrl(id)}/cancel`, { method: 'POST' })
      return Cancelled.safeParse(parseJson(await response.text())).data?.cancelled ?? false
    } catch {
      // Nothing more to do for a job the server cannot be asked about.
      return false
    }
  }

  // Without an answer to the POST the job may still be on its way to the queue, so a cancel that
  // finds nothing is retried.
  async function abandon(id: string, cancel: CancelPolicy): Promise<void> {
    if (cancel === 'never') return
    const delays = cancel === 'once' ? [] : CANCEL_RETRY_DELAYS_MS
    for (let attempt = 0; ; attempt++) {
      if (await cancelJob(id)) return
      if (attempt >= delays.length) return
      await sleep(delays[attempt])
    }
  }

  return {
    imageModel(modelId: string): ImageModelV4 {
      return {
        specificationVersion: 'v4',
        provider: 'comfyui.image',
        modelId,
        maxImagesPerCall: 1,
        supportsFileInputs: true,
        supportsMaskInputs: false,

        async doGenerate({
          prompt,
          size,
          aspectRatio,
          seed,
          files,
          mask,
          providerOptions,
          abortSignal,
          headers,
        }) {
          const parsedOptions = Options.safeParse(providerOptions?.comfyui)
          if (!parsedOptions.success) {
            throw new Error(
              `ComfyUI image generation has invalid provider options:\n${z.prettifyError(parsedOptions.error)}`,
            )
          }
          const { workflow, outputNodeId, paths, inputs, negativePrompt, referenceFolder } =
            parsedOptions.data
          if (prompt === undefined) throw new Error('ComfyUI image generation needs a text prompt.')

          const warnings = unsupportedInputWarnings({ aspectRatio, mask })

          let graph: Graph = workflow
          for (const [path, value] of inputs ?? []) graph = setGraphInput(graph, path, value)
          graph = setGraphInput(graph, paths.positive, prompt)
          if (paths.negative) graph = setGraphInput(graph, paths.negative, negativePrompt ?? '')
          graph = setGraphInput(graph, paths.seed, seed ?? randomSeed())

          const dimensions = parseImageSize(size)
          if (dimensions && paths.width && paths.height) {
            graph = setGraphInput(graph, paths.width, dimensions.width)
            graph = setGraphInput(graph, paths.height, dimensions.height)
          } else if (size) {
            warnings.push({ type: 'unsupported', feature: 'size' })
          }

          const referencePaths = paths.references ?? []
          if (files?.length && referencePaths.length === 0) {
            warnings.push({ type: 'unsupported', feature: 'files' })
          } else if (files?.length) {
            const uploadHeaders = definedHeaders(headers)
            const names = await Promise.all(
              files
                .slice(0, referencePaths.length)
                .map((file) => uploadReference(file, referenceFolder, uploadHeaders, abortSignal)),
            )
            for (const [index, name] of names.entries()) {
              graph = setGraphInput(graph, referencePaths[index], name)
            }
            if (files.length > referencePaths.length) {
              warnings.push({
                type: 'other',
                message: `The workflow has ${referencePaths.length} reference input(s); ${files.length - referencePaths.length} reference image(s) were not used.`,
              })
            }
          }

          // The server adopts this id, which lets a cancel during the POST still find the job.
          const clientId = crypto.randomUUID()
          let promptId: string = clientId
          let cancel: CancelPolicy = 'never'

          try {
            const body = { prompt: graph, prompt_id: clientId }
            const queueUrl = `${baseURL}/prompt`
            abortSignal?.throwIfAborted()
            cancel = 'until-found'
            const queued = await settings.fetch(queueUrl, {
              method: 'POST',
              headers: { ...definedHeaders(headers), 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              signal: abortSignal,
            })
            if (!queued.ok) {
              cancel = 'never'
              throw await failure(queued, queueUrl, body)
            }
            const accepted = QueuedPrompt.parse(await queued.json())
            promptId = accepted.prompt_id
            cancel = 'once'

            // A 200 can still carry errors for the outputs the server dropped from the run.
            const nodeErrors = Object.entries(accepted.node_errors ?? {})
            const blocking = nodeErrors.filter(([, e]) =>
              e.dependent_outputs?.includes(outputNodeId),
            )
            if (blocking.length > 0) {
              throw new Error(`ComfyUI Validation Error: ${describeNodeErrors(blocking)}`)
            }
            if (nodeErrors.length > 0) {
              warnings.push({
                type: 'other',
                message: `ComfyUI skipped part of the workflow: ${describeNodeErrors(nodeErrors)}`,
              })
            }

            const job = await waitForJob(promptId, abortSignal)
            cancel = 'never'
            if (job.status === 'failed') throw executionFailure(job.execution_error)
            if (job.status === 'cancelled') throw new Error('ComfyUI execution was interrupted')

            const image = job.outputs?.[outputNodeId]?.images?.[0]
            if (!image) throw missingOutputFailure(graph, outputNodeId, job)

            const viewUrl = `${baseURL}/view?${new URLSearchParams({
              filename: image.filename,
              subfolder: image.subfolder ?? '',
              type: image.type ?? 'output',
            })}`
            const view = await settings.fetch(viewUrl, { signal: abortSignal })
            if (!view.ok) throw new Error(`ComfyUI image download failed: HTTP ${view.status}`)

            return {
              images: [new Uint8Array(await view.arrayBuffer())],
              warnings,
              response: {
                timestamp: new Date(),
                modelId,
                headers: Object.fromEntries(view.headers),
              },
            }
          } catch (error) {
            void abandon(promptId, cancel)
            throw error
          }
        },
      }
    },
  }
}
