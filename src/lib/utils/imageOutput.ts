export const IMAGE_OUTPUT_FORMATS = ['png', 'jpeg', 'webp'] as const
export type ImageOutputFormat = (typeof IMAGE_OUTPUT_FORMATS)[number]

/** The formats that take a compression level. */
export const LOSSY_IMAGE_OUTPUT_FORMATS = [
  'jpeg',
  'webp',
] as const satisfies readonly ImageOutputFormat[]

/** An entry of the user's ordered list, and what one request sends. `compression` is 0-100. */
export interface ImageOutputPreference {
  format: ImageOutputFormat
  compression?: number
}

/** The slice of a model's capabilities that decides what a request may send. */
export interface ImageOutputCapabilities {
  outputFormats?: readonly ImageOutputFormat[]
  compressionFormats?: readonly ImageOutputFormat[]
}

const COMPRESSION_MIN = 0
const COMPRESSION_MAX = 100

export const isImageOutputFormat = (value: string): value is ImageOutputFormat =>
  IMAGE_OUTPUT_FORMATS.some((format) => format === value)

export const takesCompression = (format: ImageOutputFormat): boolean =>
  LOSSY_IMAGE_OUTPUT_FORMATS.some((lossy) => lossy === format)

function normalizeCompression(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(COMPRESSION_MAX, Math.max(COMPRESSION_MIN, Math.round(value)))
}

const preference = (
  format: ImageOutputFormat,
  compression: number | undefined,
): ImageOutputPreference =>
  compression === undefined || !takesCompression(format) ? { format } : { format, compression }

/** The stored list as the app reads it: known formats only, the first of a repeat, compression in range. */
export function parseImageOutputPreferences(value: unknown): ImageOutputPreference[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<ImageOutputFormat>()
  const result: ImageOutputPreference[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const format = 'format' in entry ? entry.format : undefined
    if (typeof format !== 'string' || !isImageOutputFormat(format) || seen.has(format)) continue
    seen.add(format)
    result.push(
      preference(
        format,
        'compression' in entry ? normalizeCompression(entry.compression) : undefined,
      ),
    )
  }
  return result
}

/**
 * The first preferred format the model is known to accept. Compression rides along only when
 * the model lists that format as taking it. `undefined` sends nothing.
 */
export function pickImageOutput(
  preferences: readonly ImageOutputPreference[],
  capabilities: ImageOutputCapabilities | undefined,
): ImageOutputPreference | undefined {
  const supported = capabilities?.outputFormats
  if (!supported?.length) return undefined

  const chosen = preferences.find((p) => supported.includes(p.format))
  if (!chosen) return undefined

  const accepted = capabilities?.compressionFormats?.includes(chosen.format) === true
  return preference(chosen.format, accepted ? chosen.compression : undefined)
}

/** The body fields OpenRouter, NanoGPT and OpenAI-compatible hosts share. */
export type ImageOutputWireFields = {
  output_format?: ImageOutputFormat
  output_compression?: number
}

/** Empty when nothing is chosen. */
export const outputWireFields = (
  output: ImageOutputPreference | undefined,
): ImageOutputWireFields =>
  output
    ? {
        output_format: output.format,
        ...(output.compression !== undefined && { output_compression: output.compression }),
      }
    : {}

export const addImageOutput = (
  list: readonly ImageOutputPreference[],
  format: ImageOutputFormat,
): ImageOutputPreference[] =>
  list.some((p) => p.format === format) ? [...list] : [...list, { format }]

export const removeImageOutput = (
  list: readonly ImageOutputPreference[],
  index: number,
): ImageOutputPreference[] => list.toSpliced(index, 1)

/** Swaps an entry with its neighbour; an entry at the edge stays where it is. */
export function moveImageOutput(
  list: readonly ImageOutputPreference[],
  index: number,
  delta: -1 | 1,
): ImageOutputPreference[] {
  const target = index + delta
  const moved = list[index]
  const other = list[target]
  if (!moved || !other) return [...list]
  return list.with(index, other).with(target, moved)
}

/** Sets or clears (`undefined`) an entry's compression; png has none to set. */
export function setImageOutputCompression(
  list: readonly ImageOutputPreference[],
  index: number,
  compression: number | undefined,
): ImageOutputPreference[] {
  const entry = list[index]
  if (!entry || !takesCompression(entry.format)) return [...list]
  return list.with(index, preference(entry.format, normalizeCompression(compression)))
}
