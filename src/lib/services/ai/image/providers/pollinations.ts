/**
 * Pollinations Image Provider
 *
 * Generates through the OpenAI Compatible SDK path against gen.pollinations.ai/v1; models come
 * from Pollinations' own catalogue at /image/models.
 */

import * as z from 'zod'
import type { ImageModelCapabilities } from '#lib/types/index.ts'
import { specToPixels, formatImageSize } from '#lib/utils/image.ts'
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

const GENERATION_BASE_URL = 'https://gen.pollinations.ai/v1'
const MODELS_ENDPOINT = 'https://gen.pollinations.ai/image/models'

const optionalString = z.string().optional().catch(undefined)
const optionalStrings = z.array(z.string()).optional().catch(undefined)

const PollinationsModel = z.object({
  name: z.string(),
  title: optionalString,
  description: optionalString,
  community: z.boolean().optional().catch(undefined),
  aliases: optionalStrings,
  input_modalities: optionalStrings,
  output_modalities: optionalStrings,
  max_reference_images: z.number().optional().catch(undefined),
  resolutions: optionalStrings,
})

type PollinationsModel = z.output<typeof PollinationsModel>

function toCapabilities({
  input_modalities: inputs,
  max_reference_images: refs,
  resolutions,
}: PollinationsModel): ImageModelCapabilities {
  const maxReferenceImages = refs && refs > 0 ? refs : undefined

  // A model that takes images but lists no reference count still takes references; one whose
  // inputs could not be read stays unknown.
  let supportsImg2Img: boolean | undefined
  if (maxReferenceImages || inputs?.includes('image')) supportsImg2Img = true
  else if (inputs) supportsImg2Img = false

  const editsOnly = !!inputs?.includes('image') && !inputs.includes('text')

  return {
    supportsImg2Img,
    maxReferenceImages,
    requiresReferenceImage: editsOnly ? true : undefined,
    supportedResolutions: resolutions?.length ? resolutions : undefined,
  }
}

// A community proxy can share its title with the official model, and the picker shows only this.
function modelLabel({ name, title, community }: PollinationsModel): string {
  const label = title || name
  const owner = community ? name.split('/')[1] : undefined
  return owner ? `${label} (Community - ${owner})` : label
}

function toModelInfo(m: PollinationsModel): ImageModelInfo {
  return {
    id: m.name,
    name: modelLabel(m),
    aliases: m.aliases?.length ? m.aliases : undefined,
    description: m.description,
    inputModalities: m.input_modalities,
    outputModalities: m.output_modalities,
    ...toCapabilities(m),
  }
}

export function createPollinationsProvider(config: ImageProviderConfig): ImageProvider {
  // Discovery works without a key; it is sent when set.
  async function listModels(apiKey?: string): Promise<ImageModelInfo[]> {
    const key = apiKey || config.apiKey
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (key) headers['Authorization'] = `Bearer ${key}`

    const response = await imageGetFetch(MODELS_ENDPOINT, headers, {
      serviceId: 'pollinations-image-models',
    })
    return parseModelList(await response.json(), PollinationsModel)
      .filter((model) => model.output_modalities?.includes('image'))
      .map(toModelInfo)
  }

  return {
    id: 'pollinations',
    name: 'Pollinations',

    async generate(options: ImageGenerateOptions): Promise<ImageGenerateResult> {
      const { model, prompt, spec, referenceImages, signal } = options

      if (!config.apiKey) {
        throw new Error('Pollinations API key is required to bypass Turnstile protection.')
      }

      return generateOpenAICompatibleImage({
        baseUrl: GENERATION_BASE_URL,
        apiKey: config.apiKey,
        serviceId: 'pollinations-image',
        model,
        prompt,
        size: formatImageSize(specToPixels(spec)),
        referenceImages,
        extraFields: { safe: false },
        signal,
      })
    },

    listModels,
  }
}
