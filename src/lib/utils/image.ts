import type { ImageGenerationMode, StorySettings } from '#lib/types/index.ts'

export function normalizeImageDataUrl(imageData: string | null | undefined): string | null {
  if (!imageData) {
    return null
  }
  if (
    imageData.startsWith('data:image/') ||
    imageData.startsWith('http://') ||
    imageData.startsWith('https://')
  ) {
    return imageData
  }
  // Backward compatibility: stored as raw base64 without a data URL prefix.
  return `data:image/png;base64,${imageData}`
}

/**
 * Image size is stored as an intent — orientation + size tier — not as pixels.
 *
 * The backends disagree on what a size even is: Google takes an aspect ratio from a closed
 * list and has no pixel parameter, OpenRouter takes a ratio + a resolution tier, NanoGPT
 * publishes a per-model list of accepted values, and only ComfyUI/A1111/Pollinations take
 * arbitrary dimensions. There is no pixel size they all accept, so each adapter resolves
 * the intent into whatever its backend takes.
 */

export type ImageOrientation = 'square' | 'landscape' | 'portrait'
export type ImageSizeTier = 'tiny' | 'small' | 'medium' | 'large'

export interface ImageSpec {
  orientation: ImageOrientation
  size: ImageSizeTier
}

export interface ImageResolution {
  width: number
  height: number
}

export const IMAGE_ORIENTATIONS: readonly ImageOrientation[] = ['square', 'landscape', 'portrait']
export const IMAGE_SIZE_TIERS: readonly ImageSizeTier[] = ['tiny', 'small', 'medium', 'large']

/**
 * The single definition of what each orientation means, as `[w, h]`.
 *
 * Pixels and the `w:h` strings sent to ratio-only providers are both derived from this, so
 * "Landscape" is 16:9 everywhere.
 */
const ORIENTATION_RATIO: Record<ImageOrientation, [number, number]> = {
  square: [1, 1],
  landscape: [16, 9],
  portrait: [9, 16],
}

/** Long edge in pixels per tier. The short edge follows from the orientation's ratio. */
const TIER_LONG_EDGE: Record<ImageSizeTier, number> = {
  tiny: 512,
  small: 1024,
  medium: 1536,
  large: 2048,
}

/** Diffusion backends want dimensions on a grid; 16 divides every value this produces. */
const PIXEL_GRID = 16

const DEFAULT_SPEC: ImageSpec = { orientation: 'square', size: 'small' }

/** A fresh default — a shared object would let one caller's mutation move it app-wide. */
export function defaultImageSpec(): ImageSpec {
  return { ...DEFAULT_SPEC }
}

/** Pixels for a spec, for the backends that take real dimensions. */
export function specToPixels(spec: ImageSpec): ImageResolution {
  const [rw, rh] = ORIENTATION_RATIO[spec.orientation]
  const long = TIER_LONG_EDGE[spec.size]
  const short = Math.round((long * Math.min(rw, rh)) / Math.max(rw, rh) / PIXEL_GRID) * PIXEL_GRID
  return rw >= rh ? { width: long, height: short } : { width: short, height: long }
}

/** The dimensions in a `WIDTHxHEIGHT` string. */
export function parseImageSize(size: string | undefined): ImageResolution | undefined {
  const match = /^(\d+)x(\d+)$/.exec(size ?? '')
  return match ? { width: Number(match[1]), height: Number(match[2]) } : undefined
}

/** `WIDTHxHEIGHT`, for the providers whose parameter is a string in that shape. */
export function formatImageSize(res: ImageResolution): `${number}x${number}` {
  return `${res.width}x${res.height}`
}

export type SniffedImageMime =
  | 'image/png'
  | 'image/apng'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'image/avif'
  | 'image/heic'
  | 'image/heic-sequence'
  | 'image/heif'
  | 'image/heif-sequence'

const SNIFF_BYTES = 64 * 1024
// Whole base64 quanta, so the slice decodes. Must reach past a large `iCCP` profile to `acTL`.
const SNIFF_PREFIX_CHARS = Math.ceil(SNIFF_BYTES / 3) * 4

// Ordered: the first brand present anywhere in the `ftyp` box wins.
const ISOBMFF_BRANDS: readonly (readonly [string, SniffedImageMime])[] = [
  ['avif', 'image/avif'],
  ['avis', 'image/avif'],
  ['heic', 'image/heic'],
  ['heix', 'image/heic'],
  ['heim', 'image/heic'],
  ['heis', 'image/heic'],
  ['hevc', 'image/heic-sequence'],
  ['hevx', 'image/heic-sequence'],
  ['hevm', 'image/heic-sequence'],
  ['hevs', 'image/heic-sequence'],
  ['mif1', 'image/heif'],
  ['msf1', 'image/heif-sequence'],
]

const ascii = (bytes: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(start, start + length))

const u32 = (bytes: Uint8Array, pos: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(pos)

/**
 * MIME type of raw base64 image data, from its magic bytes, or `null` when it is not a
 * recognised image. Nothing is assumed to be PNG.
 */
export function sniffImageMime(b64: string): SniffedImageMime | null {
  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(b64.slice(0, SNIFF_PREFIX_CHARS))
  } catch {
    return null
  }

  const head = ascii(bytes, 0, 12)
  if (head.startsWith('\x89PNG\r\n\x1a\n')) return pngMime(bytes)
  if (head.startsWith('\xff\xd8\xff')) return 'image/jpeg'
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif'
  if (head.startsWith('RIFF') && head.slice(8) === 'WEBP') return 'image/webp'
  if (head.slice(4, 8) === 'ftyp') return isobmffMime(bytes)
  return null
}

/** APNG is a PNG with an `acTL` chunk ahead of the first `IDAT`. */
function pngMime(bytes: Uint8Array): SniffedImageMime {
  let pos = 8
  while (pos + 8 <= bytes.length) {
    const type = ascii(bytes, pos + 4, 4)
    if (type === 'acTL') return 'image/apng'
    if (type === 'IDAT') return 'image/png'
    pos += u32(bytes, pos) + 12
  }
  return 'image/png'
}

/** Some encoders write `mif1` as the major brand and list `avif` or `heic` as compatible. */
function isobmffMime(bytes: Uint8Array): SniffedImageMime | null {
  // A box size of 0 means the box runs to the end of the file.
  const size = u32(bytes, 0)
  const end = size === 0 ? bytes.length : Math.min(size, bytes.length)
  const brands = new Set([ascii(bytes, 8, 4)])
  for (let pos = 16; pos + 4 <= end; pos += 4) brands.add(ascii(bytes, pos, 4))
  return ISOBMFF_BRANDS.find(([brand]) => brands.has(brand))?.[1] ?? null
}

const BASE64_CHUNK = 0x8000

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK))
  }
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Dimensions to record against a pending image, before there is an image.
 *
 * The placeholder reserves the right shape of space while the request is out. Ratio-only
 * backends will return something else, so what matters here is the orientation.
 */
export function expectedPixels(size: ImageSpec | string | null | undefined): ImageResolution {
  return specToPixels(parseImageSpec(size))
}

/** The canonical `w:h` for an orientation. */
export function specToRatioString(spec: ImageSpec): string {
  const [w, h] = ORIENTATION_RATIO[spec.orientation]
  return `${w}:${h}`
}

/**
 * The ratio to send to a provider that takes one, given the ratios it accepts.
 *
 * Falls back to the closest by shape rather than to `1:1`, so a landscape request that the
 * provider cannot serve exactly still comes back landscape. Compared in log space: on a
 * linear scale portrait ratios crowd into (0, 1] while landscape ones spread over [1, ∞),
 * which biases every near-miss towards square.
 */
export function specToAspectRatio(spec: ImageSpec, supported: readonly string[]): string {
  const preferred = specToRatioString(spec)
  if (supported.includes(preferred)) return preferred

  const target = ratioValue(preferred)
  // Seeded with `preferred` so a wholly unparseable list yields a well-formed ratio.
  let best = preferred
  let bestDistance = Infinity

  for (const candidate of supported) {
    const value = ratioValue(candidate)
    if (!Number.isFinite(value) || value <= 0) continue
    const distance = Math.abs(Math.log(value / target))
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }

  return best
}

function ratioValue(ratio: string): number {
  const [w, h] = ratio.split(':').map(Number)
  return h > 0 ? w / h : NaN
}

/**
 * Read a stored size into a spec.
 *
 * Settings hold an `ImageSpec`; the `WIDTHxHEIGHT` strings written by older builds are
 * still accepted and read as the intent they were approximating, so there is no migration
 * to run before a profile can be used.
 *
 * Takes `unknown` rather than the union it wants, because the caller is the settings load
 * path and what is on disk is whatever JSON happens to hold — a hand-edited file, a value
 * from a build that stored something else. Anything unrecognised is the default; the one
 * outcome that is not acceptable here is throwing, since this runs before the app has
 * settings at all.
 */
export function parseImageSpec(value: unknown): ImageSpec {
  if (!value) return defaultImageSpec()

  if (typeof value === 'string') {
    return specFromSizeString(value)
  }

  if (typeof value === 'object') {
    const { orientation, size } = value as Partial<ImageSpec>
    return {
      orientation: IMAGE_ORIENTATIONS.includes(orientation as ImageOrientation)
        ? (orientation as ImageOrientation)
        : DEFAULT_SPEC.orientation,
      size: IMAGE_SIZE_TIERS.includes(size as ImageSizeTier)
        ? (size as ImageSizeTier)
        : DEFAULT_SPEC.size,
    }
  }

  // A number, a boolean, a symbol: nothing that was ever written here on purpose.
  return defaultImageSpec()
}

function specFromSizeString(value: string): ImageSpec {
  const text = value.trim().toLowerCase()

  // `×` as well as `x`: it is what the old size badge rendered, so it is what a user
  // retyping what they saw would produce.
  const pixels = /^(\d+)\s*[x×]\s*(\d+)$/.exec(text)
  if (pixels) {
    const width = Number(pixels[1])
    const height = Number(pixels[2])
    if (width > 0 && height > 0) return specFromPixels(width, height)
  }

  return defaultImageSpec()
}

/** Tier boundaries sit midway between the long edges above, so each value lands on its row. */
function tierForLongEdge(longEdge: number): ImageSizeTier {
  const tiers = IMAGE_SIZE_TIERS
  for (let i = 0; i < tiers.length - 1; i++) {
    const midpoint = (TIER_LONG_EDGE[tiers[i]] + TIER_LONG_EDGE[tiers[i + 1]]) / 2
    if (longEdge <= midpoint) return tiers[i]
  }
  return tiers[tiers.length - 1]
}

/**
 * Classify a pixel size into the spec it was approximating.
 *
 * The square band is ±2%: wide enough to absorb rounding, narrow enough that a genuinely
 * wide image is not read as square.
 */
export function specFromPixels(width: number, height: number): ImageSpec {
  const ratio = width / height
  const orientation: ImageOrientation =
    Math.abs(ratio - 1) < 0.02 ? 'square' : ratio > 1 ? 'landscape' : 'portrait'

  return { orientation, size: tierForLongEdge(Math.max(width, height)) }
}

/** Human-readable, for the widget and for logs. */
export function describeImageSpec(spec: ImageSpec): string {
  const { width, height } = specToPixels(spec)
  return `${spec.orientation} ${spec.size} (${width}x${height})`
}

/** The image mode a story generates under: its saved mode, or Text Only when none is chosen. */
export function storyImageMode(settings: StorySettings | null | undefined): ImageGenerationMode {
  return settings?.imageGenerationMode ?? 'none'
}
