/**
 * NanoGPT Image Provider
 *
 * Direct HTTP calls to nano-gpt.com API.
 * - txt2img: POST /images/generations (JSON)
 * - img2img: Same endpoint + imageDataUrl in body
 */

import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerateOptions,
  ImageGenerateResult,
  ImageModelInfo,
} from './types'
import { imageFetch, imageGetFetch } from './fetchAdapter'
import { specToPixels, formatImageSize, specFromPixels, type ImageSpec } from '$lib/utils/image'

const DEFAULT_BASE_URL = 'https://nano-gpt.com/api/v1'
const MODELS_ENDPOINT = 'https://nano-gpt.com/api/models'

// Known img2img capable models/tags
const IMG2IMG_TAGS = new Set(['image-to-image', 'image-edit'])

export function createNanoGPTProvider(config: ImageProviderConfig): ImageProvider {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL

  return {
    id: 'nanogpt',
    name: 'NanoGPT',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, spec, modelInfo, referenceImages, signal } = options

      const body: Record<string, unknown> = {
        model,
        prompt,
        // `size`, not `width`/`height`: neither endpoint documents a width/height pair.
        size: resolveSize(spec, modelInfo?.supportedResolutions),
      }

      // img2img: pass reference as imageDataUrl
      if (referenceImages?.length) {
        body.imageDataUrl = `data:image/png;base64,${referenceImages[0]}`
      }

      const response = await imageFetch({
        url: `${baseUrl}/images/generations`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
        serviceId: 'nanogpt-image',
      })

      const data = await response.json()
      const imageData = data?.data?.[0]

      if (imageData?.b64_json) {
        return { base64: imageData.b64_json, revisedPrompt: imageData.revised_prompt }
      }
      if (imageData?.url) {
        // Fetch the image URL and convert to base64
        const imgResponse = await fetch(imageData.url)
        const blob = await imgResponse.blob()
        const buffer = await blob.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i])
        }
        const base64 = btoa(binary)
        return { base64, revisedPrompt: imageData.revised_prompt }
      }

      throw new Error('No image data in NanoGPT response')
    },

    async listModels(): Promise<ImageModelInfo[]> {
      try {
        const response = await imageGetFetch(MODELS_ENDPOINT)
        if (!response.ok) return getFallbackModels()

        const data = await response.json()
        const imageModels = data?.models?.image || {}
        const entries = Object.values(imageModels) as Array<{
          name?: string
          model?: string
          description?: string
          cost?: Record<string, number>
          resolutions?: Array<{ value: string; comment?: string }>
          tags?: string[]
          supportsMultipleImg2Img?: boolean
        }>

        if (entries.length === 0) return getFallbackModels()

        return entries.map((m) => {
          const supportsImg2Img =
            m.tags?.some((t) => IMG2IMG_TAGS.has(t)) || m.supportsMultipleImg2Img || false

          let costPerImage: number | undefined
          if (m.cost && typeof m.cost === 'object') {
            const costs = Object.values(m.cost).filter((c) => typeof c === 'number')
            if (costs.length > 0) costPerImage = costs.reduce((a, b) => a + b, 0) / costs.length
          }

          const resolutions = m.resolutions?.map((r) => r.value).filter(Boolean) ?? []

          return {
            id: m.model || m.name || '',
            name: m.name || m.model || '',
            description: m.description,
            supportsImg2Img,
            costPerImage,
            supportedResolutions: resolutions.length > 0 ? resolutions : undefined,
          }
        })
      } catch {
        return getFallbackModels()
      }
    },
  }
}

function getFallbackModels(): ImageModelInfo[] {
  return [
    {
      id: 'z-image-turbo',
      name: 'Image Turbo',
      description: 'Fast, efficient image generation',
      supportsImg2Img: false,
    },
    {
      id: 'flux-kontext',
      name: 'Flux Kontext',
      description: 'Context-aware image generation',
      supportsImg2Img: true,
    },
  ]
}

/** Symbolic values NanoGPT models use in place of dimensions, and what they mean. */
const SYMBOLIC: Record<string, { width: number; height: number }> = {
  square_hd: { width: 1024, height: 1024 },
  square: { width: 512, height: 512 },
  landscape_4_3: { width: 1024, height: 768 },
  landscape_16_9: { width: 1024, height: 576 },
  portrait_4_3: { width: 768, height: 1024 },
  portrait_16_9: { width: 576, height: 1024 },
}

const SIZE_TOKENS: Record<string, number> = { '1k': 1024, '2k': 2048, '4k': 4096, '8k': 8192 }

/** Long edge a bare `w:h` is scored at, since a ratio carries no size of its own. */
const RATIO_REFERENCE_EDGE = 1024

/**
 * The value to send as `size`.
 *
 * Models publish their own list of accepted values and they do not agree — some offer a
 * single value, many use tokens that are not dimensions at all. Picks from that list when
 * it is known, scoring orientation first and long edge second, so a model that cannot do
 * landscape returns its widest option rather than a same-pixel square. Without a list, the
 * canonical pixels go through unchanged.
 */
function resolveSize(spec: ImageSpec, options?: string[]): string {
  const want = specToPixels(spec)
  if (!options?.length) return formatImageSize(want)
  if (options.length === 1) return options[0]

  let best: string | null = null
  let bestScore = Infinity
  let firstUnreadable: string | null = null

  for (const option of options) {
    const dims = optionToPixels(option)
    if (!dims) {
      firstUnreadable ??= option
      continue
    }
    const orientationMiss = specFromPixels(dims.width, dims.height).orientation !== spec.orientation
    const edgeMiss = Math.abs(Math.max(dims.width, dims.height) - Math.max(want.width, want.height))
    const score = (orientationMiss ? 1_000_000 : 0) + edgeMiss
    if (score < bestScore) {
      bestScore = score
      best = option
    }
  }

  // `auto` and friends: usable, but only if nothing readable was on offer.
  return best ?? firstUnreadable ?? formatImageSize(want)
}

function optionToPixels(option: string): { width: number; height: number } | null {
  const value = option.trim().toLowerCase()

  const pixels = /^(\d+)\s*[x*]\s*(\d+)$/.exec(value)
  if (pixels) return { width: Number(pixels[1]), height: Number(pixels[2]) }

  const ratio = /^(\d+):(\d+)$/.exec(value)
  if (ratio) {
    const w = Number(ratio[1])
    const h = Number(ratio[2])
    const edge = RATIO_REFERENCE_EDGE
    return w >= h
      ? { width: edge, height: Math.round((edge * h) / w) }
      : { width: Math.round((edge * w) / h), height: edge }
  }

  if (value in SYMBOLIC) return SYMBOLIC[value]
  if (value in SIZE_TOKENS) return { width: SIZE_TOKENS[value], height: SIZE_TOKENS[value] }

  return null
}
