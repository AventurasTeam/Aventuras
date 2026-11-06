/**
 * OpenAI Compatible Image Provider
 *
 * Generates through `@ai-sdk/openai-compatible` against a user-supplied base URL (LiteLLM and
 * other proxies). The key is optional. No standard says which of a proxy's models make images, so
 * models come from {baseUrl}/models and {baseUrl}/images/models, classified by whichever generic
 * field the entry carries.
 */

import * as z from 'zod'
import { pickRequestSize } from '#lib/utils/image.ts'
import { endpoint } from '#lib/utils/url.ts'
import { resolveBaseUrl } from './baseUrls'
import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { imageGetFetch } from './fetchAdapter'
import { parseModelList } from './parseModelList'
import { generateOpenAICompatibleImage } from './openaiCompatible'

// `allSettled` waits for the dedicated list, and the backfill gives `listModels` 10 s.
const DEDICATED_LIST_TIMEOUT_MS = 5_000
// A host without the route answers one of these, not a list.
const ABSENT_STATUSES = [403, 404, 405]

const optionalString = z.string().optional().catch(undefined)
const optionalStrings = z.array(z.string()).optional().catch(undefined)

// Every field is a guess at what a host calls it, so none may reject an entry.
const ModelEntry = z
  .object({
    id: optionalString,
    name: optionalString,
    display_name: optionalString,
    title: optionalString,
    model_name: optionalString,
    input_modalities: optionalStrings,
    output_modalities: optionalStrings,
    architecture: z
      .object({ input_modalities: optionalStrings, output_modalities: optionalStrings })
      .optional()
      .catch(undefined),
    endpoints: optionalStrings,
    supported_endpoints: optionalStrings,
    supported_endpoint_types: optionalStrings,
    sizes: optionalStrings,
    supported_parameters: z.object({ resolutions: optionalStrings }).optional().catch(undefined),
  })
  .refine(({ id, name }) => id || name)

type ModelEntry = z.output<typeof ModelEntry>

type Kind = 'image' | 'other' | 'unknown'

const IMAGE_PATH = /images\/(generations|edits)$/i
const EDIT_PATH = /images\/edits$/i

const hasImage = (modalities: string[] | undefined) =>
  modalities?.some((m) => m.toLowerCase() === 'image') ?? false

const outputsOf = (e: ModelEntry) => e.output_modalities ?? e.architecture?.output_modalities
const inputsOf = (e: ModelEntry) => e.input_modalities ?? e.architecture?.input_modalities
const pathsOf = (e: ModelEntry) => e.endpoints ?? e.supported_endpoints

/** The first signal an entry carries decides; an entry with none is `unknown`. */
function classify(entry: ModelEntry): Kind {
  const outputs = outputsOf(entry)
  if (outputs?.length) return hasImage(outputs) ? 'image' : 'other'

  const paths = pathsOf(entry)
  if (paths?.length) return paths.some((p) => IMAGE_PATH.test(p)) ? 'image' : 'other'

  // New API's labels, which are not paths.
  const types = entry.supported_endpoint_types
  if (types?.length) return types.some((t) => /image/i.test(t)) ? 'image' : 'other'

  return 'unknown'
}

/** Only a path list can rule editing out: input modalities and endpoint types are not exhaustive. */
function supportsEditing(entry: ModelEntry): boolean | undefined {
  const paths = pathsOf(entry)
  if (hasImage(inputsOf(entry))) return true
  if (paths?.some((p) => EDIT_PATH.test(p))) return true
  if (entry.supported_endpoint_types?.some((t) => /edit/i.test(t))) return true
  return paths?.length ? false : undefined
}

function toModelInfo(entry: ModelEntry): ImageModelInfo {
  const id = entry.id || entry.name || ''
  const resolutions = entry.sizes ?? entry.supported_parameters?.resolutions
  return {
    id,
    name: entry.name || entry.display_name || entry.title || id,
    supportsImg2Img: supportsEditing(entry),
    supportedResolutions: resolutions?.length ? resolutions : undefined,
  }
}

export function createOpenAICompatibleProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = resolveBaseUrl('openai-compatible', config.baseUrl)

  return {
    id: 'openai-compatible',
    name: 'OpenAI Compatible',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, spec, modelInfo, referenceImages, signal } = options
      if (!baseUrl) throw new Error('OpenAI-compatible provider requires a custom base URL')

      return generateOpenAICompatibleImage({
        baseUrl,
        apiKey: config.apiKey,
        serviceId: 'openai-compatible-image',
        model,
        prompt,
        size: pickRequestSize(spec, modelInfo?.supportedResolutions, modelInfo?.minPixels),
        referenceImages,
        signal,
      })
    },

    async listModels(apiKey?: string, signal?: AbortSignal): Promise<ImageModelInfo[]> {
      if (!baseUrl) return []
      return fetchImageModels(baseUrl, apiKey, signal)
    },
  }
}

/** The entries at `url`, or `undefined` when the host has no such route. */
async function fetchEntries(
  url: string,
  headers: Record<string, string> | undefined,
  options: {
    serviceId: string
    timeoutMs?: number
    allowStatuses?: number[]
    signal?: AbortSignal
  },
): Promise<ModelEntry[] | undefined> {
  const response = await imageGetFetch(url, headers, options)
  if (!response.ok) {
    await response.body?.cancel()
    return undefined
  }
  return parseModelList(await response.json(), ModelEntry, url)
}

async function fetchImageModels(
  baseUrl: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<ImageModelInfo[]> {
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined

  const [general, dedicated] = await Promise.allSettled([
    fetchEntries(endpoint(baseUrl, 'models'), headers, {
      serviceId: 'openai-compatible-image-models',
      signal,
    }),
    fetchEntries(endpoint(baseUrl, 'images/models'), headers, {
      serviceId: 'openai-compatible-image-models',
      timeoutMs: DEDICATED_LIST_TIMEOUT_MS,
      allowStatuses: ABSENT_STATUSES,
      signal,
    }),
  ])

  const images = pickImageModels(
    general.status === 'fulfilled' ? (general.value ?? []) : [],
    dedicated.status === 'fulfilled' ? (dedicated.value ?? []) : [],
  )
  if (images.length) return images

  if (general.status === 'rejected') throw general.reason
  const entries = general.value ?? []

  // The host classifies its models and has no image ones; one that does not lists them all.
  return entries.some((e) => classify(e) === 'other') ? [] : entries.map(toModelInfo)
}

const identifiersOf = (e: ModelEntry) => [e.id, e.name, e.model_name].flatMap((k) => (k ? [k] : []))

/**
 * A `/models` entry is an image model if it classifies as one or the dedicated list names it by id
 * or name. Some hosts key the dedicated list by an id `/images/generations` does not take, so a
 * match keeps the general entry's id. A dedicated entry matching nothing counts only if it classifies.
 */
function pickImageModels(general: ModelEntry[], dedicated: ModelEntry[]): ImageModelInfo[] {
  const byIdentifier = new Map(
    dedicated.flatMap((e) => identifiersOf(e).map((k) => [k, e] as const)),
  )
  const matched = new Set<ModelEntry>()
  const images: ImageModelInfo[] = []

  for (const entry of general) {
    const hit = identifiersOf(entry)
      .map((k) => byIdentifier.get(k))
      .find((e) => e !== undefined)
    if (hit) {
      matched.add(hit)
      images.push(mergeInfo(toModelInfo(entry), toModelInfo(hit)))
    } else if (classify(entry) === 'image') {
      images.push(toModelInfo(entry))
    }
  }

  for (const entry of dedicated) {
    if (!matched.has(entry) && classify(entry) === 'image') images.push(toModelInfo(entry))
  }
  return images
}

/** The dedicated list's capabilities win where it states them; the id and name stay the general entry's. */
const mergeInfo = (general: ImageModelInfo, dedicated: ImageModelInfo): ImageModelInfo => ({
  ...general,
  supportsImg2Img: dedicated.supportsImg2Img ?? general.supportsImg2Img,
  supportedResolutions: dedicated.supportedResolutions ?? general.supportedResolutions,
})
